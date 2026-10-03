/*
 * Fuel logs — rules copied from car-v1/fuel.php (sv_fuel.php for the 'sv' scope).
 */
const { QueryTypes } = require('sequelize');
const { sequelize, models } = require('../models');
const { modelFor, tableFor } = require('./scope');
const { HttpError } = require('../middleware/errorHandler');
const { z, id, date, parseBody } = require('../utils/validation');
const { today } = require('../utils/dates');

const round2 = (n) => Math.round(n * 100) / 100;

const schema = z.object({
  vehicle_id: id('Vehicle'),
  fuel_type: z.enum(['Diesel', 'Petrol', 'CNG'], { message: 'Choose a fuel type' }),
  date: date('Date'),
  // Optional for petrol on dual-fuel vehicles; PHP saved an empty reading as 0.
  km_reading: z.preprocess((v) => (v === '' || v == null ? 0 : v), z.coerce.number().int('KM reading must be a whole number').min(0)),
  liters: z.coerce.number({ message: 'Liters is required' }).positive('Liters must be more than 0'),
  amount: z.coerce.number({ message: 'Amount is required' }).min(0),
});

/**
 * km run and mileage against the previous reading of the same vehicle and fuel type
 * (on or before this date, excluding this entry). Petrol on a multi-fuel vehicle gets none.
 */
async function mileage(scope, data, entryId, transaction) {
  const vehicle = await modelFor('vehicles', scope).findByPk(data.vehicle_id, { attributes: ['fuel_type'], raw: true, transaction });
  if (!vehicle) throw new HttpError(400, 'Vehicle not found');
  const fuels = String(vehicle.fuel_type || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (fuels.length > 1 && data.fuel_type.toLowerCase() === 'petrol') return { km_run: 0, mileage: 0 };

  const table = tableFor('fuel', scope);
  const [prev] = await sequelize.query(
    `SELECT km_reading FROM \`${table}\`
      WHERE vehicle_id = ? AND date <= ? AND fuel_type = ? AND id != ?
      ORDER BY date DESC, km_reading DESC LIMIT 1`,
    { replacements: [data.vehicle_id, data.date, data.fuel_type, entryId || 0], type: QueryTypes.SELECT, transaction }
  );
  if (!prev) return { km_run: 0, mileage: 0 };
  const kmRun = data.km_reading - Number(prev.km_reading);
  return { km_run: kmRun, mileage: data.liters > 0 ? round2(kmRun / data.liters) : 0 };
}

/**
 * Fuel list. Copies the PHP query exactly, including INNER JOIN routes: vehicles without a
 * route are hidden and a vehicle with two routes shows each entry twice (known quirk).
 * Gap review additions: optional fuel_type and month (YYYY-MM) filters, a summary for the month
 * (vs the month before) and each vehicle's average mileage for the "below average" pill.
 */
async function list(scope, query) {
  const fuel = tableFor('fuel', scope);
  const vehicles = tableFor('vehicles', scope);
  const routes = tableFor('routes', scope);
  const raw = query.vehicle_id ?? query['vehicle_id[]'];
  const ids = (Array.isArray(raw) ? raw : String(raw || '').split(',')).map((v) => Number.parseInt(v, 10)).filter((n) => n > 0);
  const fuelType = FUEL_TYPES.find((t) => t.toLowerCase() === String(query.fuel_type || '').toLowerCase()) || null;
  const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : null;

  const conds = [];
  const replacements = [];
  if (ids.length) {
    conds.push(`fl.vehicle_id IN (${ids.map(() => '?').join(',')})`);
    replacements.push(...ids);
  }
  if (fuelType) {
    conds.push('fl.fuel_type = ?');
    replacements.push(fuelType);
  }
  if (month) {
    conds.push("DATE_FORMAT(fl.date, '%Y-%m') = ?");
    replacements.push(month);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = await sequelize.query(
    `SELECT fl.*, v.reg_no, v.petrol_price, v.diesel_price, v.cng_price
       FROM \`${fuel}\` fl
       JOIN \`${vehicles}\` v ON fl.vehicle_id = v.id
       INNER JOIN \`${routes}\` r ON v.id = r.vehicle_id
       ${where}
      ORDER BY fl.date DESC, fl.km_reading DESC`,
    { replacements, type: QueryTypes.SELECT }
  );
  const [summary, averages] = await Promise.all([fuelSummary(scope, { ids, month }), vehicleAverages(scope)]);
  return { rows, total: rows.length, page: 1, pages: 1, summary, averages };
}

const FUEL_TYPES = ['Diesel', 'Petrol', 'CNG'];
const prevMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
};

/** Spend, litres per fuel type and average mileage for a month and the month before (vehicles with a route, no duplicates). */
async function fuelSummary(scope, { ids, month }) {
  const fuel = tableFor('fuel', scope);
  const routes = tableFor('routes', scope);
  const ym = month || today().slice(0, 7);
  const one = async (m) => {
    const replacements = [m, ...ids];
    const rows = await sequelize.query(
      `SELECT fuel_type, SUM(amount) AS amount, SUM(liters) AS liters, COUNT(*) AS fills,
              SUM(CASE WHEN mileage > 0 THEN mileage ELSE 0 END) AS mileage_sum, SUM(mileage > 0) AS mileage_n
         FROM \`${fuel}\`
        WHERE DATE_FORMAT(date, '%Y-%m') = ? ${ids.length ? `AND vehicle_id IN (${ids.map(() => '?').join(',')})` : ''}
          AND vehicle_id IN (SELECT vehicle_id FROM \`${routes}\`)
        GROUP BY fuel_type`,
      { replacements, type: QueryTypes.SELECT }
    );
    const byType = Object.fromEntries(rows.map((r) => [r.fuel_type || 'Diesel', { amount: Number(r.amount) || 0, liters: Number(r.liters) || 0, fills: Number(r.fills) || 0 }]));
    const mSum = rows.reduce((t, r) => t + (Number(r.mileage_sum) || 0), 0);
    const mN = rows.reduce((t, r) => t + (Number(r.mileage_n) || 0), 0);
    return {
      month: m,
      amount: round2(rows.reduce((t, r) => t + (Number(r.amount) || 0), 0)),
      liters: round2(rows.reduce((t, r) => t + (Number(r.liters) || 0), 0)),
      fills: rows.reduce((t, r) => t + (Number(r.fills) || 0), 0),
      mileage: mN ? round2(mSum / mN) : 0,
      byType,
    };
  };
  const [current, previous] = await Promise.all([one(ym), one(prevMonth(ym))]);
  return { current, previous };
}

/** "vehicle_id|fuel_type" -> average of that vehicle's non-zero mileage readings. */
async function vehicleAverages(scope) {
  const rows = await sequelize.query(
    `SELECT vehicle_id, fuel_type, AVG(mileage) AS avg_mileage FROM \`${tableFor('fuel', scope)}\` WHERE mileage > 0 GROUP BY vehicle_id, fuel_type`,
    { type: QueryTypes.SELECT }
  );
  return Object.fromEntries(rows.map((r) => [`${r.vehicle_id}|${r.fuel_type}`, round2(Number(r.avg_mileage) || 0)]));
}

/** Vehicles that have a route (the PHP fuel page only offers these), with fuel types and prices. */
async function vehicleOptions(scope) {
  const vehicles = tableFor('vehicles', scope);
  const routes = tableFor('routes', scope);
  const rows = await sequelize.query(
    `SELECT id, reg_no, fuel_type, petrol_price, diesel_price, cng_price
       FROM \`${vehicles}\` WHERE id IN (SELECT vehicle_id FROM \`${routes}\`) ORDER BY reg_no`,
    { type: QueryTypes.SELECT }
  );
  const settings = (await models.AppSettings.findOne({ order: [['id', 'ASC']], raw: true })) || {};
  return {
    vehicles: rows.map((r) => ({ ...r, label: r.reg_no })),
    globals: {
      global_petrol_price: Number(settings.global_petrol_price) || 0,
      global_diesel_price: Number(settings.global_diesel_price) || 0,
      global_cng_price: Number(settings.global_cng_price) || 0,
    },
  };
}

async function save(scope, entryId, body) {
  const data = parseBody(schema, body);
  const Fuel = modelFor('fuel', scope);
  return sequelize.transaction(async (transaction) => {
    const calc = await mileage(scope, data, entryId, transaction);
    if (!entryId) return Fuel.create({ ...data, ...calc }, { transaction });
    const record = await Fuel.findByPk(entryId, { transaction });
    if (!record) throw new HttpError(404, 'Fuel entry not found');
    return record.update({ ...data, ...calc }, { transaction });
  });
}

async function remove(scope, entryId) {
  const deleted = await modelFor('fuel', scope).destroy({ where: { id: entryId } });
  if (!deleted) throw new HttpError(404, 'Fuel entry not found');
}

module.exports = { list, save, remove, vehicleOptions, mileage };
