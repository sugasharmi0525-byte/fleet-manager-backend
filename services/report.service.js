/*
 * Reports â€” rules copied from car-v1/reports.php (financial), monthly_reports.php (+ save_income.php),
 * fuel_report.php and maintenance_report.php. Financial and monthly reports also serve sub-vendors
 * (sv_reports.php, sv_monthly_reports.php: income includes loading charges).
 */
const { QueryTypes } = require('sequelize');
const { sequelize, models } = require('../models');
const { tableFor } = require('./scope');
const { HttpError } = require('../middleware/errorHandler');
const { z, id, date, text, parseBody } = require('../utils/validation');
const { today } = require('../utils/dates');
const SQL = require('../queries/reports.sql');

const select = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const scalar = async (sql, replacements) => Number((await select(sql, replacements))[0]?.n) || 0;
const num = (v) => Number(v) || 0;
const round2 = (v) => Math.round(v * 100) / 100;

const tables = (scope) => ({
  vehicles: tableFor('vehicles', scope),
  drivers: tableFor('drivers', scope),
  dailyLogs: tableFor('dailyLogs', scope),
  fuel: tableFor('fuel', scope),
  maintenance: tableFor('maintenance', scope),
  maintenanceStatus: scope === 'sv' ? 'sub_vendor_maintenance' : 'maintenance',
});

// ---- Query-string helpers
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** ?vehicle_id=1,2,3 (or repeated) -> [1, 2, 3] */
function vehicleIds(query) {
  const raw = [].concat(query.vehicle_id ?? []).flatMap((v) => String(v).split(','));
  const ids = [...new Set(raw.map((v) => Number.parseInt(v, 10)).filter((n) => n > 0))];
  if (ids.length > 200) throw new HttpError(400, 'Too many vehicles selected');
  return ids;
}

function monthBounds(year, month) {
  const last = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, '0')}` };
}

/** ?from_date & ?to_date, defaulting to the current month (PHP: date('Y-m-01'), date('Y-m-t')). */
function dateRange(query) {
  const [y, m] = today().split('-').map(Number);
  const def = monthBounds(y, m);
  const from = query.from_date || def.from;
  const to = query.to_date || def.to;
  if (!ISO.test(from) || !ISO.test(to)) throw new HttpError(400, 'Choose valid dates');
  return { from, to };
}

/** ?month & ?year, defaulting to the current month. */
function monthRange(query) {
  const [y, m] = today().split('-').map(Number);
  const month = query.month ? Number.parseInt(query.month, 10) : m;
  const year = query.year ? Number.parseInt(query.year, 10) : y;
  if (!(month >= 1 && month <= 12) || !(year >= 2000 && year <= 2100)) throw new HttpError(400, 'Choose a valid month and year');
  return { month, year, ...monthBounds(year, month) };
}

// ---------------------------------------------------------------- Financial report
/** Per-vehicle figures shared by the financial and monthly reports. */
async function vehicleFigures(scope, t, vehicleId, from, to, driverId) {
  const logArgs = driverId ? [vehicleId, from, to, driverId] : [vehicleId, from, to];
  const base = [vehicleId, from, to];
  const [[stats], fuel, maint, salary, commitments, charges] = await Promise.all([
    select(SQL.logStats(t, Boolean(driverId)), logArgs),
    scalar(SQL.fuelCost(t), base),
    scalar(SQL.maintenanceCost(t), base),
    scalar(SQL.driverSalary(t, Boolean(driverId)), logArgs),
    scalar(SQL.commitmentCost(), base),
    scope === 'sv' ? scalar(SQL.loadingCharges(), base) : Promise.resolve(0),
  ]);
  return {
    days: num(stats?.days),
    kms: num(stats?.kms),
    logIncome: num(stats?.db_income),
    otherExpenses: num(stats?.other) + num(stats?.extra),
    fuel,
    maint,
    salary,
    commitments,
    charges,
  };
}

/** GET /:scope/reports/financial?vehicle_id&from_date&to_date */
async function financial(scope, query) {
  const t = tables(scope);
  const ids = vehicleIds(query);
  const { from, to } = dateRange(query);
  const vehicles = ids.length ? await select(SQL.vehiclesById(t, ids.length), ids) : await select(SQL.reportVehicles(t));

  const rows = await Promise.all(
    vehicles.map(async (v) => {
      const f = await vehicleFigures(scope, t, v.id, from, to);
      const manual = await scalar(SQL.manualIncomeSum(), [v.id, from, to]);
      const income = round2(f.logIncome + manual + f.charges);
      const maintOthers = round2(f.maint + f.otherExpenses + f.commitments); // "Maintenance & Others"
      const expense = round2(f.fuel + maintOthers + f.salary);
      return {
        id: v.id,
        reg_no: v.reg_no,
        days: f.days,
        kms: f.kms,
        income,
        loading_charges: f.charges,
        expense,
        profit: round2(income - expense),
        fuel: f.fuel,
        maint: maintOthers,
        salary: f.salary,
        // parts of "Maintenance & Others", for the expense-split chart (gap review); maint is unchanged
        maint_only: f.maint,
        commitments: f.commitments,
        other: f.otherExpenses,
      };
    })
  );
  const sum = (k) => round2(rows.reduce((s, r) => s + r[k], 0));
  return {
    from_date: from,
    to_date: to,
    rows,
    totals: {
      income: sum('income'),
      fuel: sum('fuel'),
      salary: sum('salary'),
      maint: sum('maint'),
      profit: sum('profit'),
      maint_only: sum('maint_only'),
      commitments: sum('commitments'),
      other: sum('other'),
    },
    // PHP shows the 3 summary boxes only when exactly one vehicle is chosen.
    single: ids.length === 1 ? rows[0] || null : null,
  };
}

/**
 * GET /:scope/reports/financial/by-month?vehicle_id&to_date — the financial report run once per
 * month for the 6 months ending with to_date's month (same calculation), for the profit-by-month chart.
 */
async function financialByMonth(scope, query) {
  const { to } = dateRange(query);
  const [y, m] = to.split('-').map(Number);
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 6 + i, 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  });
  const vehicle_id = vehicleIds(query).join(',');
  const out = [];
  for (const { year, month } of months) {
    const b = monthBounds(year, month);
    // eslint-disable-next-line no-await-in-loop -- one month at a time keeps the connection pool free
    const r = await financial(scope, { vehicle_id, from_date: b.from, to_date: b.to });
    out.push({ month: `${year}-${String(month).padStart(2, '0')}`, income: r.totals.income, expense: round2(r.totals.fuel + r.totals.salary + r.totals.maint), profit: r.totals.profit });
  }
  return { months: out };
}

// ---------------------------------------------------------------- Monthly report
/** GET /:scope/reports/monthly?month&year&vehicle_id&driver_id */
async function monthly(scope, query) {
  const t = tables(scope);
  const ids = vehicleIds(query);
  const driverId = Number.parseInt(query.driver_id, 10) || null;
  const { month, year, from, to } = monthRange(query);
  const vehicles = ids.length ? await select(SQL.reportVehiclesById(t, ids.length), ids) : await select(SQL.reportVehicles(t));

  const rows = [];
  for (const v of vehicles) {
    const f = await vehicleFigures(scope, t, v.id, from, to, driverId);
    if (!f.days && driverId) continue; // no logs for this driver on this vehicle
    const [[manualEntry], dailyLogs] = await Promise.all([
      select(SQL.manualIncomeFirst(), [v.id, from, to]),
      select(SQL.kmBreakdown(t), [v.id, from, to]),
    ]);
    const income = round2(f.logIncome + num(manualEntry?.amount) + f.charges);
    // The monthly report leaves maintenance out of expenses (the financial report includes it).
    const expense = round2(f.fuel + f.otherExpenses + f.commitments + f.salary);
    rows.push({
      id: v.id,
      reg_no: v.reg_no,
      days: f.days,
      kms: f.kms,
      income,
      loading_charges: f.charges,
      fuel: f.fuel,
      salary: f.salary,
      expense,
      operating: round2(expense - f.fuel - f.salary), // "Operating Expenses"
      profit: round2(income - expense),
      manual_entry: manualEntry || null,
      daily_logs: dailyLogs.map((l) => ({ ...l, total_km: num(l.total_km) })),
    });
  }
  const sum = (k) => round2(rows.reduce((s, r) => s + r[k], 0));
  return { month, year, from_date: from, to_date: to, rows, totals: { income: sum('income'), fuel: sum('fuel'), salary: sum('salary'), profit: sum('profit') } };
}

// ---------------------------------------------------------------- Fuel report (own fleet)
/** GET /own/reports/fuel?from_date&to_date&vehicle_id */
async function fuel(query) {
  const ids = vehicleIds(query);
  const { from, to } = dateRange(query);
  const vehicles = ids.length ? await select(SQL.fuelVehiclesById(ids.length), ids) : await select(SQL.fuelVehiclesAll());

  const blocks = [];
  for (const v of vehicles) {
    const logs = await select(SQL.fuelLogs(), [v.id, from, to]);
    if (!logs.length) continue;
    const liters = round2(logs.reduce((s, l) => s + num(l.liters), 0));
    const amount = round2(logs.reduce((s, l) => s + num(l.amount), 0));
    const kms = logs.reduce((s, l) => s + num(l.km_run), 0);
    blocks.push({ vehicle: v, logs, summary: { liters, amount, kms, mileage: liters > 0 ? kms / liters : 0 } });
  }
  const consolidated = blocks.length ? await select(SQL.fuelConsolidated(ids.length), [from, to, ...ids]) : [];
  return { from_date: from, to_date: to, vehicles: blocks, consolidated };
}

// ---------------------------------------------------------------- Maintenance report (own fleet)
/** GET /own/reports/maintenance?month&year&vehicle_id */
async function maintenance(query) {
  const ids = vehicleIds(query);
  const { month, year, from, to } = monthRange(query);
  const vehicles = ids.length ? await select(SQL.vehiclesById(tables('own'), ids.length), ids) : await select(SQL.maintenanceVehiclesInPeriod(), [from, to]);

  const blocks = [];
  for (const v of vehicles) {
    const logs = await select(SQL.maintenanceLogs(), [v.id, from, to]);
    if (!logs.length) continue;
    const add = (k) => round2(logs.reduce((s, l) => s + num(l[k]), 0));
    blocks.push({ vehicle: v, logs, summary: { spares: add('cost_spares'), labour: add('cost_labour'), total: add('total_cost') } });
  }
  return { month, year, from_date: from, to_date: to, vehicles: blocks };
}

// ---------------------------------------------------------------- Filter options
/** Vehicle (and driver) lists for each report's filters, as each PHP page built them. */
async function options(scope, report) {
  const t = tables(scope);
  switch (report) {
    case 'financial':
      return { vehicles: await select(SQL.activeVehicles(t)) };
    case 'monthly': {
      const [vehicles, drivers] = await Promise.all([select(SQL.reportVehicles(t)), select(SQL.activeDrivers(t))]);
      return { vehicles, drivers };
    }
    case 'fuel':
      if (scope !== 'own') break;
      return { vehicles: await select(SQL.fuelVehicleOptions()) };
    case 'maintenance':
      if (scope !== 'own') break;
      return { vehicles: await select(SQL.activeVehicles(t)) };
    default:
  }
  throw new HttpError(404, 'Unknown report');
}

// ---------------------------------------------------------------- Manual income (save_income.php)
const incomeSchema = z.object({
  vehicle_id: id('Vehicle'),
  date: date('Date'),
  amount: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number({ message: 'Amount is required' }).min(-99_999_999.99).max(99_999_999.99)),
  description: text(5000, { optional: true, label: 'Description' }),
});

async function saveManualIncome(incomeId, body) {
  const data = parseBody(incomeSchema, body);
  const vehicle = await models.Vehicles.findByPk(data.vehicle_id, { attributes: ['id'] });
  if (!vehicle) throw new HttpError(400, 'Vehicle not found', { vehicle_id: 'Vehicle not found' });
  if (incomeId) {
    const row = await models.ManualIncomes.findByPk(incomeId);
    if (!row) throw new HttpError(404, 'Income entry not found');
    await row.update(data);
    return row.get({ plain: true });
  }
  const row = await models.ManualIncomes.create(data);
  return row.get({ plain: true });
}

async function removeManualIncome(incomeId) {
  const deleted = await models.ManualIncomes.destroy({ where: { id: incomeId } });
  if (!deleted) throw new HttpError(404, 'Income entry not found');
}

module.exports = { vehicleIds, financial, financialByMonth, monthly, fuel, maintenance, options, saveManualIncome, removeManualIncome };
