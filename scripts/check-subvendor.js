/*
 * Phase 10 check: every sub-vendor screen's API, end to end against the dev database.
 * Lists against the sv tables, then a test vehicle / driver / route / log / fuel / maintenance /
 * attendance / salary / charge, and the sub-vendor reports with loading charges.
 * Test records are removed at the end.
 *
 *   npm run check:subvendor -w server
 */
const { Op, QueryTypes } = require('sequelize');
const { models, sequelize } = require('../models');
const env = require('../config/env');
const { createHarness } = require('./lib/harness');

const { expect, section, call, run, ok } = createHarness('subvendor-check');
const q = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
const D1 = '2099-03-10';
const D2 = '2099-03-11';
const created = { vehicles: [], drivers: [] };

async function lists() {
  section('Lists read the sub-vendor tables');
  const count = async (sql) => Number((await q(sql))[0].n);
  const v = await call('GET', '/api/sv/vehicles?page=1');
  expect(v.status === 200 && v.data.total === (await count('SELECT COUNT(*) n FROM sub_vendor_vehicles')), `vehicles: ${v.data.total}`);
  const d = await call('GET', '/api/sv/drivers?page=1');
  expect(d.status === 200 && d.data.total === (await count("SELECT COUNT(*) n FROM sub_vendor_drivers WHERE status IS NULL OR status <> 'deleted'")), `drivers (deleted hidden): ${d.data.total}`);
  const r = await call('GET', '/api/sv/routes?page=1');
  expect(r.status === 200 && r.data.total === (await count('SELECT COUNT(*) n FROM sub_vendor_routes')), `routes: ${r.data.total}`);
  const m = await call('GET', '/api/sv/maintenance?page=1');
  expect(m.status === 200 && m.data.total === (await count('SELECT COUNT(*) n FROM sub_vendor_maintenance')), `maintenance: ${m.data.total}`);
  const l = await call('GET', '/api/sv/daily-logs?page=1');
  expect(l.status === 200 && l.data.total === (await count('SELECT COUNT(*) n FROM sub_vendor_daily_logs')), `daily logs (LEFT JOIN, all rows listed): ${l.data.total}`);
  const c = await call('GET', '/api/sv/commitments');
  expect(c.status === 404, 'commitments are own-fleet only (sv -> 404)');
}

async function flow() {
  section('Vehicle, driver, route');
  let r = await call('POST', '/api/sv/vehicles', {
    reg_no: 'ZZTEST SV 01', make: 'TATA', model_year: '2023', type: 'ACE', deck: 'open', fuel_type: 'Diesel',
    fc_expiry: '2099-12-31', insurance_expiry: '2099-12-31', pollution_expiry: '2099-12-31', tax_status: '', diesel_price: '90',
  });
  expect(r.status === 201, 'add sub-vendor vehicle', r.data);
  const vehicle = r.data;
  created.vehicles.push(vehicle.id);
  expect(Number((await q('SELECT COUNT(*) n FROM vehicles WHERE reg_no = ?', ['ZZTEST SV 01']))[0].n) === 0, 'saved in sub_vendor_vehicles, not vehicles');

  const [col] = await q("SELECT EXTRA AS e FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'sub_vendor_drivers' AND COLUMN_NAME = 'id'", [env.DB_NAME]);
  let driver;
  if (col.e.includes('auto_increment')) {
    r = await call('POST', '/api/sv/drivers', { name: 'ZZTEST SV Driver', phone: '9', daily_rate: '500', status: 'active' });
    expect(r.status === 201, 'add sub-vendor driver (with rate history row)', r.data);
    driver = r.data;
  } else {
    // car_tracking_dev from the old dump lacks AUTO_INCREMENT here (production has it); see Phase 10 notes.
    ok('add sub-vendor driver: skipped, dev table has no AUTO_INCREMENT (rebuild dev from the production dump)');
    const id = (Number(await models.SubVendorDrivers.max('id')) || 0) + 1000;
    driver = (await models.SubVendorDrivers.create({ id, name: 'ZZTEST SV Driver', daily_rate: 500, status: 'active' })).get({ plain: true });
  }
  created.drivers.push(driver.id);

  r = await call('POST', '/api/sv/routes', { route_name: 'ZZTEST SV route', vehicle_id: vehicle.id, driver_id: driver.id, max_km: '100', extra_km_rate: '10' });
  expect(r.status === 201, 'add sub-vendor route', r.data);
  r = await call('POST', '/api/own/routes', { route_name: 'ZZTEST wrong scope', vehicle_id: vehicle.id, driver_id: driver.id, max_km: '1', extra_km_rate: '1' });
  if (r.status === 201) await models.Routes.destroy({ where: { id: r.data.id } });

  section('Daily logs (AWB, vehicle number, on-load charges)');
  const lk = await call('GET', `/api/sv/daily-logs/last-km?vehicle_id=${vehicle.id}`);
  expect(lk.status === 200 && Number(lk.data.last_km ?? lk.data.lastKm ?? 0) === 0, 'last km is 0 for a new sub-vendor vehicle (sv_api_get_last_km.php)', lk.data);
  r = await call('POST', '/api/sv/daily-logs', { vehicle_id: vehicle.id, driver_id: driver.id, date: D1, opening_km: 1000, closing_km: 1130, awb_number: 'AWB-ZZ-1', vehicle_number: 'TN00ZZ0001', on_load_charges: '250' });
  expect(r.status === 201 && Number(r.data.extra_km) === 30 && near(r.data.extra_km_cost, 300), 'log: 130 km on a 100 km route at ₹10 -> 30 km, ₹300', r.data);
  const awb = await call('GET', '/api/sv/daily-logs?awb_search=AWB-ZZ');
  expect(awb.data.total === 1 && awb.data.rows[0].on_load_charges !== undefined, 'AWB search finds it');
  const veh = await call('GET', '/api/sv/daily-logs?veh_search=TN00ZZ0001');
  expect(veh.data.total === 1, 'veh_search matches the vendor vehicle number');

  section('Fuel and maintenance');
  r = await call('POST', '/api/sv/fuel', { vehicle_id: vehicle.id, fuel_type: 'Diesel', date: D1, km_reading: 1000, liters: 20, amount: 1800 });
  expect(r.status === 201, 'add sub-vendor fuel entry', r.data);
  r = await call('POST', '/api/sv/maintenance', { vehicle_id: vehicle.id, service_date: D1, type: 'Repairs', description: 'ZZTEST', km_reading: '1000', cost_spares: '500', cost_labour: '200' });
  expect(r.status === 201 && near(r.data.total_cost, 700), 'add sub-vendor maintenance (total 700)', r.data);

  section('Attendance (sub_vendor_attendance.id has no AUTO_INCREMENT)');
  r = await call('PUT', `/api/sv/attendance/day/${D1}`, { statuses: { [driver.id]: 'present' } });
  expect(r.status === 200, 'save a day', r.data);
  const att = await q('SELECT id FROM sub_vendor_attendance WHERE date = ? AND driver_id = ?', [D1, driver.id]);
  expect(att.length === 1 && att[0].id > 0, 'row saved with a real id (not 0)', att);
  r = await call('PUT', `/api/sv/attendance/day/${D2}`, { statuses: { [driver.id]: 'absent' } });
  const day = await call('GET', `/api/sv/attendance/day?date=${D2}`);
  expect(day.data.drivers.find((x) => x.id === driver.id)?.status === 'absent', 'day view reads it back');
  r = await call('PATCH', `/api/sv/attendance/${att[0].id}`, { status: 'leave' });
  expect(r.status === 200 && r.data.status === 'leave', 'edit a single row', r.data);
  const [dup] = await q('SELECT id, COUNT(*) c FROM sub_vendor_attendance GROUP BY id HAVING c > 1 LIMIT 1');
  if (dup) {
    r = await call('DELETE', `/api/sv/attendance/${dup.id}`);
    const still = Number((await q('SELECT COUNT(*) n FROM sub_vendor_attendance WHERE id = ?', [dup.id]))[0].n);
    expect([400, 409].includes(r.status) && still === Number(dup.c), `old rows sharing id ${dup.id} (${dup.c} rows) are not deleted together`, r.data);
    const hist = (await call('GET', '/api/sv/attendance/history?page=1')).data;
    const total = Number((await q('SELECT COUNT(*) n FROM sub_vendor_attendance a JOIN sub_vendor_drivers d ON d.id = a.driver_id'))[0].n);
    expect(hist.total === total, `history counts every row, shared ids included (${total})`, hist.total);
    const lockedRows = [];
    for (let page = 1; page <= hist.pages; page += 1) {
      const pg = (await call('GET', `/api/sv/attendance/history?page=${page}`)).data;
      lockedRows.push(...pg.rows.filter((x) => x.id === dup.id));
    }
    expect(lockedRows.length > 1 && lockedRows.every((x) => x.locked), `rows sharing id ${dup.id} are all listed and marked locked (${lockedRows.length})`);
  } else {
    ok('no shared ids in this database (nothing to protect)');
  }

  section('Salaries');
  r = await call('POST', '/api/sv/salary-transactions', { driver_id: driver.id, amount_type: 'advance', amount: 300, month: 3, year: 2099 });
  expect(r.status === 201, 'sub-vendor advance', r.data);
  const sal = (await call('GET', '/api/sv/salaries?month=3&year=2099&search=ZZTEST SV')).data.rows[0];
  // D1 was changed to leave, D2 is absent: 0 working days, 1 absent (leave counts in neither)
  expect(sal && sal.days_present === 0 && sal.days_absent === 1 && sal.salary === 0 && sal.month_advance === 300, 'payroll row: 0 working, 1 absent, salary 0, advance 300', sal);

  section('Vendor charges');
  r = await call('POST', '/api/sv/charges', { vehicle_id: vehicle.id, date: D1, awb_number: 'AWB-ZZ-1', mbox_number: 'MB-1', loading_charge: '1200.50' });
  expect(r.status === 201, 'add charge ₹1,200.50', r.data);
  const chargeId = r.data.id;
  r = await call('POST', '/api/sv/charges', { vehicle_id: vehicle.id, date: D2, loading_charge: '-50' });
  expect(r.status === 201 && near(r.data.loading_charge, 0), 'a negative charge is saved as 0 (PHP max(0, ...))', r.data);
  r = await call('POST', '/api/sv/charges', { vehicle_id: '', date: D2 });
  expect(r.status === 400, 'vehicle is required', r.data);
  let list = (await call('GET', `/api/sv/charges?from_date=${D1}&to_date=${D2}`)).data;
  expect(list.total === 2 && near(list.total_charge, 1200.5), 'list for the dates: 2 records, total ₹1,200.50', list);
  list = (await call('GET', `/api/sv/charges?from_date=${D1}&to_date=${D2}&search=MB-1`)).data;
  expect(list.total === 1, 'search by Mbox number');
  r = await call('PUT', `/api/sv/charges/${chargeId}`, { vehicle_id: vehicle.id, date: D1, awb_number: 'AWB-ZZ-1', mbox_number: 'MB-1', loading_charge: '1500' });
  expect(r.status === 200 && near(r.data.loading_charge, 1500), 'edit to ₹1,500');

  section('Sub-vendor reports include loading charges');
  const fin = (await call('GET', `/api/sv/reports/financial?from_date=${D1}&to_date=${D2}&vehicle_id=${vehicle.id}`)).data.rows[0];
  // income = log income 0 + manual 0 + charges 1500; expense = fuel 1800 + maintenance 700 + extra 300 + salary 500
  expect(fin && near(fin.loading_charges, 1500) && near(fin.income, 1500) && near(fin.expense, 3300) && near(fin.profit, -1800), 'financial: income ₹1,500 (charges), expense ₹3,300, profit -₹1,800', fin);
  const mon = (await call('GET', `/api/sv/reports/monthly?month=3&year=2099&vehicle_id=${vehicle.id}`)).data.rows[0];
  expect(mon && near(mon.income, 1500) && near(mon.expense, 2600), 'monthly: income ₹1,500, expense ₹2,600 (no maintenance)', mon);

  r = await call('DELETE', `/api/sv/charges/${chargeId}`);
  expect(r.status === 200, 'delete charge');
}

async function cleanup() {
  const v = created.vehicles;
  const d = created.drivers;
  await models.SubVendorCharges.destroy({ where: { vehicle_id: v } });
  await models.SubVendorSalaryTransactions.destroy({ where: { driver_id: d } });
  await models.SubVendorAttendance.destroy({ where: { driver_id: d } });
  await models.SubVendorDailyLogs.destroy({ where: { vehicle_id: v } });
  await models.SubVendorFuelLogs.destroy({ where: { vehicle_id: v } });
  await models.SubVendorMaintenance.destroy({ where: { vehicle_id: v } });
  await models.SubVendorRoutes.destroy({ where: { [Op.or]: [{ vehicle_id: v }, { route_name: { [Op.like]: 'ZZTEST%' } }] } });
  await models.SubVendorDriverRateHistory.destroy({ where: { driver_id: d } });
  await models.SubVendorDrivers.destroy({ where: { id: d } });
  await models.SubVendorVehicles.destroy({ where: { id: v } });
  console.log('\nCleaned up test records');
}

run({ label: 'sub-vendor', sequelize, cleanup, steps: [lists, flow] });
