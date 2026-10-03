/*
 * Daily trip logs — rules copied from car-v1/daily_logs.php and api_get_last_km.php
 * (sv_daily_logs.php / sv_api_get_last_km.php for the 'sv' scope).
 */
const { Op } = require('sequelize');
const { sequelize } = require('../models');
const { modelFor } = require('./scope');
const { HttpError } = require('../middleware/errorHandler');
const { z, money, id, date, text, parseBody } = require('../utils/validation');
const { pageParams, pageResult } = require('../utils/pagination');

const PAGE_SIZE = 10;
const round2 = (n) => Math.round(n * 100) / 100;

const baseSchema = {
  vehicle_id: id('Vehicle'),
  driver_id: id('Driver'),
  date: date('Date'),
  opening_km: z.coerce.number({ message: 'Opening KM is required' }).int('Opening KM must be a whole number').min(0),
  closing_km: z.coerce.number({ message: 'Closing KM is required' }).int('Closing KM must be a whole number').min(0),
  // Not on the PHP form: always saved as 0 there (also on edit), so the same here unless sent.
  income: money(),
  other_exp: money(),
};
const schemas = {
  own: z.object(baseSchema),
  sv: z.object({
    ...baseSchema,
    awb_number: text(100, { optional: true }),
    vehicle_number: text(100, { optional: true }),
    on_load_charges: money(),
  }),
};

/** The vehicle's active route ("LIMIT 1" in PHP; lowest id first so the choice is stable). */
async function activeRoute(scope, vehicleId, transaction) {
  return modelFor('routes', scope).findOne({
    where: { vehicle_id: vehicleId, status: 'active' },
    order: [['id', 'ASC']],
    attributes: ['max_km', 'extra_km_rate', 'driver_id'],
    raw: true,
    transaction,
  });
}

/**
 * Extra km and its cost. Limit and rate come from the active route; with no route the limit
 * is vehicles.max_km_per_day and the rate is 0. A limit of 0 means unlimited.
 */
async function extraKm(scope, vehicleId, openingKm, closingKm, transaction) {
  const route = await activeRoute(scope, vehicleId, transaction);
  let limit = 0;
  let rate = 0;
  if (route) {
    limit = Number(route.max_km) || 0;
    rate = Number(route.extra_km_rate) || 0;
  } else {
    const vehicle = await modelFor('vehicles', scope).findByPk(vehicleId, { attributes: ['max_km_per_day'], raw: true, transaction });
    limit = Number(vehicle?.max_km_per_day) || 0;
  }
  const totalKm = closingKm - openingKm;
  const extra = limit === 0 ? 0 : Math.max(0, totalKm - limit);
  return { extra_km: extra, extra_km_cost: round2(extra * rate) };
}

/** Latest closing km for a vehicle (opening km of the next log) + its route limit. */
async function lastKm(scope, vehicleId) {
  const last = await modelFor('dailyLogs', scope).findOne({
    where: { vehicle_id: vehicleId },
    order: [['date', 'DESC'], ['id', 'DESC']],
    attributes: ['closing_km', 'date'],
    raw: true,
  });
  const route = await activeRoute(scope, vehicleId);
  let closingKm = last?.closing_km;
  if (closingKm == null) {
    // own: fall back to the vehicle's current_km; sv_api_get_last_km.php returned 0
    const vehicle = scope === 'own' ? await modelFor('vehicles', scope).findByPk(vehicleId, { attributes: ['current_km'], raw: true }) : null;
    closingKm = vehicle?.current_km ?? 0;
  }
  return {
    closing_km: Number(closingKm) || 0,
    last_date: last?.date || null, // "Last log dd-mm-yyyy" hint under Opening km
    max_km: route ? Number(route.max_km) || 0 : 0,
    extra_km_rate: route ? Number(route.extra_km_rate) || 0 : 0, // for the form's live cost preview
    driver_id: route?.driver_id ?? null,
  };
}

/** vehicle_id -> driver_id of active routes (auto-fills the driver in the form). */
async function routeMappings(scope) {
  const rows = await modelFor('routes', scope).findAll({ where: { status: 'active' }, attributes: ['vehicle_id', 'driver_id'], raw: true });
  const map = {};
  for (const r of rows) if (r.vehicle_id) map[r.vehicle_id] = r.driver_id;
  return map;
}

async function list(scope, query) {
  const Logs = modelFor('dailyLogs', scope);
  const where = {};

  const search = String(query.search || '').trim().slice(0, 100);
  if (search) where[Op.or] = [{ '$vehicle.reg_no$': { [Op.like]: `%${search}%` } }, { '$driver.name$': { [Op.like]: `%${search}%` } }];
  if (query.vehicle_id) where.vehicle_id = Number(query.vehicle_id) || 0;
  if (query.driver_id) where.driver_id = Number(query.driver_id) || 0;
  const dateRange = {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.from_date || '')) dateRange[Op.gte] = query.from_date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.to_date || '')) dateRange[Op.lte] = query.to_date;
  if (Object.getOwnPropertySymbols(dateRange).length) where.date = dateRange;
  // "Extra km only" filter (gap review)
  if (query.extra_only === '1') where.extra_km = { [Op.gt]: 0 };
  if (scope === 'sv' && query.awb_search) where.awb_number = { [Op.like]: `%${String(query.awb_search).slice(0, 100)}%` };
  // sv_daily_logs.php also accepted ?veh_search (reg no or the vendor's vehicle number); its form never sent it.
  if (scope === 'sv' && query.veh_search) {
    const term = `%${String(query.veh_search).slice(0, 100)}%`;
    where[Op.and] = [{ [Op.or]: [{ '$vehicle.reg_no$': { [Op.like]: term } }, { vehicle_number: { [Op.like]: term } }] }];
  }

  const { page, limit, offset } = pageParams(query, PAGE_SIZE);
  // daily_logs.php uses INNER JOINs (logs whose vehicle or driver is gone are hidden);
  // sv_daily_logs.php uses LEFT JOINs (they are listed with "-").
  const required = scope !== 'sv';
  const { rows, count } = await Logs.findAndCountAll({
    where,
    include: [
      { association: 'vehicle', attributes: ['id', 'reg_no'], required },
      { association: 'driver', attributes: ['id', 'name'], required },
    ],
    order: [['date', 'DESC'], ['id', 'DESC']],
    limit,
    offset,
    subQuery: false,
  });

  // "Max Limit" column: each vehicle's current active route limit (0 = unlimited), as PHP showed.
  const vehicleIds = [...new Set(rows.map((r) => r.vehicle_id))];
  const routes = vehicleIds.length
    ? await modelFor('routes', scope).findAll({ where: { vehicle_id: vehicleIds, status: 'active' }, attributes: ['vehicle_id', 'max_km'], order: [['id', 'ASC']], raw: true })
    : [];
  const limits = {};
  for (const r of routes) if (!(r.vehicle_id in limits)) limits[r.vehicle_id] = Number(r.max_km) || 0;

  // Totals footer (UI redesign): km, extra km and extra cost for every log matching the filters.
  const t = (c) => sequelize.col(`${Logs.name}.${c}`);
  const [sums] = await Logs.findAll({
    where,
    include: [
      { association: 'vehicle', attributes: [], required },
      { association: 'driver', attributes: [], required },
    ],
    attributes: [
      [sequelize.literal(`SUM(\`${Logs.name}\`.\`closing_km\` - \`${Logs.name}\`.\`opening_km\`)`), 'km'],
      [sequelize.fn('SUM', t('extra_km')), 'extra_km'],
      [sequelize.fn('SUM', t('extra_km_cost')), 'extra_km_cost'],
      [sequelize.fn('SUM', t('income')), 'income'],
      ...(scope === 'own' ? [[sequelize.fn('SUM', t('profit')), 'profit']] : []),
    ],
    raw: true,
  });
  const totals = {
    km: Number(sums?.km) || 0,
    extra_km: Number(sums?.extra_km) || 0,
    extra_km_cost: Number(sums?.extra_km_cost) || 0,
    income: Number(sums?.income) || 0,
    profit: scope === 'own' ? Number(sums?.profit) || 0 : null, // sub_vendor_daily_logs has no profit column
  };

  const out = rows.map((r) => ({ ...r.toJSON(), route_max_km: limits[r.vehicle_id] ?? 0 }));
  return { ...pageResult(out, count, page, limit), totals };
}

async function save(scope, idParam, body) {
  const data = parseBody(schemas[scope], body);
  const Logs = modelFor('dailyLogs', scope);
  const Vehicles = modelFor('vehicles', scope);

  return sequelize.transaction(async (transaction) => {
    const extras = await extraKm(scope, data.vehicle_id, data.opening_km, data.closing_km, transaction);
    let record;

    if (!idParam) {
      // One log per vehicle per date, checked on add only (as in PHP).
      const exists = await Logs.findOne({ where: { vehicle_id: data.vehicle_id, date: data.date }, attributes: ['id'], transaction });
      if (exists) throw new HttpError(409, 'A log already exists for this vehicle on this date. Edit the existing row instead.');
      record = await Logs.create({ ...data, ...extras, diesel_cost: 0 }, { transaction });
    } else {
      record = await Logs.findByPk(idParam, { transaction });
      if (!record) throw new HttpError(404, 'Log not found');
      await record.update({ ...data, ...extras }, { transaction });
    }

    // The vehicle's current_km follows its latest log.
    const latest = await Logs.findOne({ where: { vehicle_id: data.vehicle_id }, order: [['date', 'DESC'], ['id', 'DESC']], attributes: ['closing_km'], raw: true, transaction });
    if (latest) await Vehicles.update({ current_km: latest.closing_km }, { where: { id: data.vehicle_id }, transaction });

    return Logs.findByPk(record.id, { transaction });
  });
}

async function remove(scope, idParam) {
  const deleted = await modelFor('dailyLogs', scope).destroy({ where: { id: idParam } });
  if (!deleted) throw new HttpError(404, 'Log not found');
}

module.exports = { list, save, remove, lastKm, routeMappings, extraKm };
