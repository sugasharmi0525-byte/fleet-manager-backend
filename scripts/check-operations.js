/*
 * Phase 7 check: daily logs, fuel, attendance and dashboard, end to end against the dev
 * database with a test login (no admin password needed). Also recalculates existing PHP
 * data with the new rules and reports differences. Test records are removed at the end.
 *
 *   npm run check:operations -w server
 */
const express = require('express');
const { Op, QueryTypes } = require('sequelize');
const { models, sequelize } = require('../models');
const env = require('../config/env');
const requestId = require('../middleware/requestId');
const { errorHandler } = require('../middleware/errorHandler');
const apiRoutes = require('../routes');
const fuelService = require('../services/fuel.service');
const dailyLogService = require('../services/dailyLog.service');

if (env.isProd) {
  console.error('Refusing to run against production');
  process.exit(1);
}

let failures = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const fail = (msg) => {
  failures += 1;
  console.log(`  FAIL  ${msg}`);
};
const expect = (cond, msg, detail) => (cond ? ok(msg) : fail(`${msg}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ''}`));

const app = express();
app.use(requestId);
app.use(express.json());
app.use((req, res, next) => {
  req.session = { user: { username: 'operations-check' } };
  next();
});
app.use('/api', apiRoutes);
app.use(errorHandler);

let base;
async function call(method, path, body) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const TEST_DATE_1 = '2099-01-10';
const TEST_DATE_2 = '2099-01-11';
const created = { vehicles: [], drivers: [], routes: [] };

async function setup() {
  const vehicle = await models.Vehicles.create({ reg_no: 'ZZTEST OPS', make: 'TEST', model_year: 2024, type: 'TEST', fuel_type: 'Diesel,Petrol',
    fc_expiry: '2099-01-01', insurance_expiry: '2099-01-01', pollution_expiry: '2099-01-01', current_km: 5000, diesel_price: 90 });
  // max_km_per_day 0, as every vehicle saved through the app gets (the column's DB default is 50)
  const noRouteVehicle = await models.Vehicles.create({ reg_no: 'ZZTEST NOROUTE', make: 'TEST', model_year: 2024, type: 'TEST', fuel_type: 'CNG',
    fc_expiry: '2099-01-01', insurance_expiry: '2099-01-01', pollution_expiry: '2099-01-01', current_km: 777, max_km_per_day: 0 });
  const driver = await models.Drivers.create({ name: 'ZZTEST Ops Driver', phone: '9', daily_rate: 500, status: 'active' });
  const route = await models.Routes.create({ route_name: 'ZZTEST route', vehicle_id: vehicle.id, driver_id: driver.id, max_km: 100, extra_km_rate: 12.5 });
  created.vehicles.push(vehicle.id, noRouteVehicle.id);
  created.drivers.push(driver.id);
  created.routes.push(route.id);
  return { vehicle, noRouteVehicle, driver };
}

async function checkDailyLogs({ vehicle, noRouteVehicle, driver }) {
  console.log('\nDaily logs');
  const lk = await call('GET', `/api/own/daily-logs/last-km?vehicle_id=${vehicle.id}`);
  expect(lk.data.closing_km === 5000 && lk.data.max_km === 100 && lk.data.driver_id === driver.id, 'last km falls back to current_km; route limit and driver returned', lk.data);
  const lkNoRoute = await call('GET', `/api/own/daily-logs/last-km?vehicle_id=${noRouteVehicle.id}`);
  expect(lkNoRoute.data.closing_km === 777 && lkNoRoute.data.max_km === 0, 'vehicle without a route: max km 0 (unlimited)', lkNoRoute.data);

  const body = { vehicle_id: vehicle.id, driver_id: driver.id, date: TEST_DATE_1, opening_km: 5000, closing_km: 5130 };
  const res = await call('POST', '/api/own/daily-logs', body);
  const log = res.data;
  expect(res.status === 201, 'create -> 201', res.data);
  expect(log.total_km === 130 && log.extra_km === 30 && Number(log.extra_km_cost) === 375, `130 km on a 100 km route at ₹12.50: extra ${log.extra_km} km, ₹${log.extra_km_cost}`);
  expect(Number(log.profit) === -375 && Number(log.income) === 0, `profit computed by MySQL: ${log.profit}`);
  let v = await models.Vehicles.findByPk(vehicle.id, { raw: true });
  expect(v.current_km === 5130, `vehicle current_km follows the latest log (${v.current_km})`);

  const dup = await call('POST', '/api/own/daily-logs', body);
  expect(dup.status === 409, 'same vehicle + date on add -> 409');

  const second = await call('POST', '/api/own/daily-logs', { ...body, date: TEST_DATE_2, opening_km: 5130, closing_km: 5200 });
  expect(second.data.extra_km === 0 && Number(second.data.extra_km_cost) === 0, '70 km under the limit: no extra km');
  v = await models.Vehicles.findByPk(vehicle.id, { raw: true });
  expect(v.current_km === 5200, 'current_km moves to the newest log');

  const upd = await call('PUT', `/api/own/daily-logs/${log.id}`, { ...body, closing_km: 5100 });
  expect(upd.status === 200 && upd.data.extra_km === 0, 'edit recalculates extra km');
  v = await models.Vehicles.findByPk(vehicle.id, { raw: true });
  expect(v.current_km === 5200, 'editing an older log keeps current_km at the newest log');

  const noLimit = await call('POST', '/api/own/daily-logs', { vehicle_id: noRouteVehicle.id, driver_id: driver.id, date: TEST_DATE_1, opening_km: 777, closing_km: 1500 });
  expect(noLimit.data.extra_km === 0, 'no route and max_km_per_day 0: unlimited, no extra km', noLimit.data);
  await models.Vehicles.update({ max_km_per_day: 50 }, { where: { id: noRouteVehicle.id } });
  const fallback = await call('PUT', `/api/own/daily-logs/${noLimit.data.id}`, { vehicle_id: noRouteVehicle.id, driver_id: driver.id, date: TEST_DATE_1, opening_km: 777, closing_km: 900 });
  expect(fallback.data.extra_km === 73 && Number(fallback.data.extra_km_cost) === 0, 'no route: limit falls back to max_km_per_day (50), rate 0', fallback.data);

  const list = await call('GET', `/api/own/daily-logs?vehicle_id=${vehicle.id}`);
  expect(list.data.total === 2 && list.data.rows[0].date === TEST_DATE_2 && list.data.rows[0].route_max_km === 100 && list.data.rows[0].vehicle.reg_no === 'ZZTEST OPS',
    'list: vehicle filter, newest first, route limit and names included');
  const search = await call('GET', '/api/own/daily-logs?search=ZZTEST Ops Driver');
  expect(search.data.total === 3, `search by driver name (${search.data.total})`);
  const range = await call('GET', `/api/own/daily-logs?from_date=${TEST_DATE_2}&to_date=${TEST_DATE_2}&vehicle_id=${vehicle.id}`);
  expect(range.data.total === 1, 'date range filter');
  const page = await call('GET', '/api/own/daily-logs');
  expect(page.data.rows.length === Math.min(10, page.data.total) && page.data.pages === Math.max(1, Math.ceil(page.data.total / 10)), `10 per page by default (${page.data.total} logs, ${page.data.pages} pages)`);
  const p50 = await call('GET', '/api/own/daily-logs?limit=50&page=2');
  expect(p50.data.rows.length === 50 && p50.data.limit === 50 && p50.data.page === 2, '?limit=50 gives 50 rows per page');
  const p33 = await call('GET', '/api/own/daily-logs?limit=33');
  expect(p33.data.limit === 10, 'other page sizes fall back to 10', p33.data.limit);

  const maps = await call('GET', '/api/own/daily-logs/route-mappings');
  expect(maps.data[vehicle.id] === driver.id, 'route mappings: vehicle -> driver');
  const bad = await call('POST', '/api/own/daily-logs', { vehicle_id: vehicle.id });
  expect(bad.status === 400, 'missing fields -> 400');
}

async function checkFuel({ vehicle }) {
  console.log('\nFuel');
  const first = await call('POST', '/api/own/fuel', { vehicle_id: vehicle.id, fuel_type: 'Diesel', date: TEST_DATE_1, km_reading: 5000, liters: 40, amount: 3600 });
  expect(first.status === 201 && first.data.km_run === 0 && Number(first.data.mileage) === 0, 'first diesel fill: no previous reading, no mileage', first.data);
  const second = await call('POST', '/api/own/fuel', { vehicle_id: vehicle.id, fuel_type: 'Diesel', date: TEST_DATE_2, km_reading: 5400, liters: 32, amount: 2880 });
  expect(second.data.km_run === 400 && Number(second.data.mileage) === 12.5, `second fill: ${second.data.km_run} km run, ${second.data.mileage} km/L`);
  const petrol = await call('POST', '/api/own/fuel', { vehicle_id: vehicle.id, fuel_type: 'Petrol', date: TEST_DATE_2, km_reading: '', liters: 5, amount: 500 });
  expect(petrol.data.km_reading === 0 && petrol.data.km_run === 0 && Number(petrol.data.mileage) === 0, 'petrol on a dual-fuel vehicle: optional km, no mileage');
  const edit = await call('PUT', `/api/own/fuel/${second.data.id}`, { vehicle_id: vehicle.id, fuel_type: 'Diesel', date: TEST_DATE_2, km_reading: 5480, liters: 32, amount: 2880 });
  expect(edit.data.km_run === 480 && Number(edit.data.mileage) === 15, 'edit recalculates against the previous reading (excluding itself)');

  const list = await call('GET', `/api/own/fuel?vehicle_id=${vehicle.id}`);
  expect(list.data.total === 3 && list.data.rows[0].reg_no === 'ZZTEST OPS' && Number(list.data.rows[0].diesel_price) === 90, 'list with vehicle filter, reg no and prices');
  const all = await call('GET', '/api/own/fuel');
  const [{ n }] = await sequelize.query('SELECT COUNT(*) AS n FROM fuel_logs fl JOIN vehicles v ON fl.vehicle_id = v.id INNER JOIN routes r ON v.id = r.vehicle_id', { type: QueryTypes.SELECT });
  expect(all.data.total === Number(n), `unfiltered list matches the PHP query row count (${n})`);
  const opts = await call('GET', '/api/own/fuel/vehicles');
  expect(opts.data.vehicles.some((x) => x.id === vehicle.id) && 'global_diesel_price' in opts.data.globals, 'fuel vehicles (with a route) + global prices');
  const badType = await call('POST', '/api/own/fuel', { vehicle_id: vehicle.id, fuel_type: 'Kerosene', date: TEST_DATE_1, liters: 1, amount: 1 });
  expect(badType.status === 400, 'unknown fuel type -> 400');
}

async function checkAttendance({ driver }) {
  console.log('\nAttendance');
  const day = await call('GET', `/api/own/attendance/day?date=${TEST_DATE_1}`);
  const me = day.data.drivers.find((d) => d.id === driver.id);
  expect(day.data.alreadyMarked === false && me?.status === 'absent', 'unmarked date: every active driver defaults to absent');

  const statuses = Object.fromEntries(day.data.drivers.map((d) => [d.id, d.id === driver.id ? 'present' : 'leave']));
  const save = await call('PUT', `/api/own/attendance/day/${TEST_DATE_1}`, { statuses });
  expect(save.status === 200 && save.data.saved === day.data.drivers.length, `save day: ${save.data.saved} rows`);
  const again = await call('GET', `/api/own/attendance/day?date=${TEST_DATE_1}`);
  expect(again.data.alreadyMarked && again.data.drivers.find((d) => d.id === driver.id).status === 'present', 'marked day reads back');
  const resave = await call('PUT', `/api/own/attendance/day/${TEST_DATE_1}`, { statuses });
  const [{ n }] = await sequelize.query('SELECT COUNT(*) AS n FROM attendance WHERE date = ?', { replacements: [TEST_DATE_1], type: QueryTypes.SELECT });
  expect(resave.status === 200 && Number(n) === day.data.drivers.length, 'saving again replaces the day (no duplicates)');

  const hist = await call('GET', `/api/own/attendance/history?driver_id=${driver.id}&month=1&year=2099`);
  expect(hist.data.total === 1 && hist.data.rows[0].driver.name === 'ZZTEST Ops Driver' && hist.data.summary.present === 1, 'history: driver/month/year filter and totals');
  const edit = await call('PATCH', `/api/own/attendance/${hist.data.rows[0].id}`, { status: 'leave' });
  expect(edit.status === 200 && edit.data.status === 'leave', 'edit one record');

  const grid = await call('GET', '/api/own/attendance/monthly?month=1&year=2099');
  const row = grid.data.drivers.find((d) => d.id === driver.id);
  expect(grid.data.days === 31 && row.statuses[10] === 'leave' && row.totals.leave === 1, 'monthly grid: 31 days, status on day 10, driver totals');
  expect(grid.data.dayTotals[9].leave === day.data.drivers.length, 'monthly grid: daily totals');

  const feb = await call('GET', '/api/own/attendance/monthly?month=2&year=2028');
  expect(feb.data.days === 29, 'leap year February has 29 days');
  const del = await call('DELETE', `/api/own/attendance/${hist.data.rows[0].id}`);
  expect(del.status === 200, 'delete one record');
  const badStatus = await call('PUT', `/api/own/attendance/day/${TEST_DATE_2}`, { statuses: { [driver.id]: 'holiday' } });
  expect(badStatus.status === 400, 'unknown status -> 400');

  // Real data: a recent month matches a direct count.
  const [{ month, year, total }] = await sequelize.query(
    "SELECT MONTH(date) AS month, YEAR(date) AS year, COUNT(*) AS total FROM attendance WHERE date < '2099-01-01' GROUP BY YEAR(date), MONTH(date) ORDER BY YEAR(date) DESC, MONTH(date) DESC LIMIT 1",
    { type: QueryTypes.SELECT }
  );
  const real = await call('GET', `/api/own/attendance/history?month=${month}&year=${year}`);
  expect(real.data.total === Number(total), `history for ${month}/${year} matches a direct count (${total} rows)`);
}

async function checkDashboard() {
  console.log('\nDashboard');
  const res = await call('GET', '/api/dashboard');
  const s = res.data.stats;
  expect(res.status === 200, 'dashboard responds');
  const [{ n: drivers }] = await sequelize.query("SELECT COUNT(*) AS n FROM drivers WHERE status = 'active'", { type: QueryTypes.SELECT });
  expect(s.activeDrivers === Number(drivers), `active drivers ${s.activeDrivers}`);
  expect(res.data.topVehicles.length === 5, `top 5 vehicles by profit (first: ${res.data.topVehicles[0]?.reg_no})`);
  console.log(`        today ${res.data.today}: ${s.presentToday} present, ${s.absentToday} absent, ${s.totalVehicles} vehicles, month profit ${s.monthProfit}, ${s.alerts} alerts`);
}

// Recalculates PHP-saved values with the new code. Differences are reported, not failed:
// they can come from data changed after saving (e.g. a route's limit edited later).
async function parity() {
  console.log('\nParity with data saved by the PHP app (informational)');
  const fuelRows = await models.FuelLogs.findAll({ where: { date: { [Op.lt]: '2099-01-01' } }, raw: true });
  let fuelSame = 0;
  const fuelDiffs = [];
  for (const r of fuelRows) {
    const calc = await fuelService.mileage('own', { vehicle_id: r.vehicle_id, fuel_type: r.fuel_type, date: r.date, km_reading: r.km_reading, liters: Number(r.liters) }, r.id);
    if (calc.km_run === r.km_run && Math.abs(calc.mileage - Number(r.mileage)) < 0.011) fuelSame += 1;
    else fuelDiffs.push({ id: r.id, saved: [r.km_run, Number(r.mileage)], now: [calc.km_run, calc.mileage] });
  }
  console.log(`        fuel mileage: ${fuelSame}/${fuelRows.length} match${fuelDiffs.length ? `; first differences: ${JSON.stringify(fuelDiffs.slice(0, 3))}` : ''}`);

  const logs = await models.DailyLogs.findAll({ where: { date: { [Op.lt]: '2099-01-01' } }, raw: true });
  let logSame = 0;
  const logDiffs = [];
  for (const l of logs) {
    const calc = await dailyLogService.extraKm('own', l.vehicle_id, l.opening_km, l.closing_km);
    if (calc.extra_km === l.extra_km && Math.abs(calc.extra_km_cost - Number(l.extra_km_cost)) < 0.011) logSame += 1;
    else logDiffs.push({ id: l.id, saved: [l.extra_km, Number(l.extra_km_cost)], now: [calc.extra_km, calc.extra_km_cost] });
  }
  console.log(`        daily log extra km: ${logSame}/${logs.length} match${logDiffs.length ? `; first differences: ${JSON.stringify(logDiffs.slice(0, 3))}` : ''}`);
}

async function cleanup() {
  await models.Attendance.destroy({ where: { date: { [Op.in]: [TEST_DATE_1, TEST_DATE_2] } } });
  await models.FuelLogs.destroy({ where: { vehicle_id: created.vehicles } });
  await models.DailyLogs.destroy({ where: { vehicle_id: created.vehicles } });
  await models.Routes.destroy({ where: { id: created.routes } });
  await models.DriverRateHistory.destroy({ where: { driver_id: created.drivers } });
  await models.Drivers.destroy({ where: { id: created.drivers } });
  await models.Vehicles.destroy({ where: { id: created.vehicles } });
  console.log('\nCleaned up test records');
}

(async () => {
  const server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ctx = await setup();
    await checkDailyLogs(ctx);
    await checkFuel(ctx);
    await checkAttendance(ctx);
    await checkDashboard();
    await parity();
  } catch (err) {
    fail(err.stack);
  } finally {
    await cleanup().catch((err) => fail(`cleanup: ${err.message}`));
    server.close();
    await sequelize.close();
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll operations checks passed');
  process.exit(failures ? 1 : 0);
})();
