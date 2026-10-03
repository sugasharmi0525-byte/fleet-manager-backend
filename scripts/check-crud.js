/*
 * Phase 6 check: exercises the CRUD routes end to end against the dev database, without
 * needing the admin password. It mounts the real API routes in a test app with a fake
 * logged-in session (no CSRF), creates records tagged "ZZTEST", and removes them at the end.
 *
 *   npm run check:crud -w server
 */
const express = require('express');
const { models, sequelize } = require('../models');
const env = require('../config/env');
const requestId = require('../middleware/requestId');
const { errorHandler } = require('../middleware/errorHandler');
const apiRoutes = require('../routes');

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
const expect = (cond, msg, detail) => (cond ? ok(msg) : fail(`${msg}${detail ? ` -> ${JSON.stringify(detail)}` : ''}`));

const app = express();
app.use(requestId);
app.use(express.json());
app.use((req, res, next) => {
  req.session = { user: { username: 'crud-check' } };
  next();
});
app.use('/api', apiRoutes);
app.use(errorHandler);

let base;
async function call(method, path, body, { form } = {}) {
  const init = { method, headers: {} };
  if (form) init.body = form;
  else if (body !== undefined) {
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

const created = { vehicles: [], drivers: [], routes: [], maintenance: [], commitments: [], files: [] };

async function checkVehicles() {
  console.log('\nVehicles');
  const form = new FormData();
  const fields = { reg_no: 'ZZTEST 01', make: 'TATA', model_year: '2022', type: 'ACE HT', deck: 'open',
    fc_expiry: '2027-01-31', insurance_expiry: '2027-02-28', pollution_expiry: '2027-03-31',
    tax_status: 'No Tax End', tax_expiry: 'ignored', fine_amount: '', car_value: '450000', petrol_price: '102.5',
    diesel_price: '', cng_price: '0' };
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('fuel_type[]', 'Petrol');
  form.append('fuel_type[]', 'Diesel');
  form.append('fc_pdf', new Blob(['%PDF-1.4\n%test\n'], { type: 'application/pdf' }), 'fc.pdf');

  const res = await call('POST', '/api/own/vehicles', undefined, { form });
  expect(res.status === 201, 'create with PDF upload (multipart) -> 201', res.data);
  if (res.status !== 201) return null;
  const v = res.data;
  created.vehicles.push(v.id);
  if (v.fc_pdf) created.files.push(v.fc_pdf);
  expect(v.fuel_type === 'Petrol,Diesel', `fuel types joined: "${v.fuel_type}"`);
  expect(v.tax_expiry === 'No Tax End' && v.max_km_per_day === 0, 'tax info follows status; max_km_per_day forced to 0');
  expect(Number(v.fine_amount) === 0 && Number(v.diesel_price) === 0, 'empty money fields saved as 0');
  expect(/^uploads\/\d+_fc_pdf_[0-9a-f]+\.pdf$/.test(v.fc_pdf), `server-named upload path: ${v.fc_pdf}`);

  const dup = new FormData();
  for (const [k, val] of Object.entries(fields)) dup.append(k, val);
  const dupRes = await call('POST', '/api/own/vehicles', undefined, { form: dup });
  expect(dupRes.status === 409, 'duplicate reg no -> 409', dupRes.data);

  const fake = new FormData();
  for (const [k, val] of Object.entries({ ...fields, reg_no: 'ZZTEST 02' })) fake.append(k, val);
  fake.append('ins_pdf', new Blob(['<html>not a pdf</html>'], { type: 'application/pdf' }), 'x.pdf');
  const fakeRes = await call('POST', '/api/own/vehicles', undefined, { form: fake });
  expect(fakeRes.status === 400, 'non-PDF content disguised as PDF -> 400', fakeRes.data);

  const upd = new FormData();
  for (const [k, val] of Object.entries({ ...fields, make: 'ASHOK LEYLAND', tax_status: 'Other', tax_expiry: 'Paid till Mar 2027' })) upd.append(k, val);
  const updRes = await call('PUT', `/api/own/vehicles/${v.id}`, undefined, { form: upd });
  expect(updRes.status === 200 && updRes.data.make === 'ASHOK LEYLAND', 'update');
  expect(updRes.data.fc_pdf === v.fc_pdf, 'update without a new file keeps the stored PDF path');
  expect(updRes.data.tax_expiry === 'Paid till Mar 2027', 'tax status Other keeps the typed tax info');

  const bad = await call('POST', '/api/own/vehicles', { reg_no: '', model_year: '22' });
  expect(bad.status === 400 && bad.data.details, 'validation errors -> 400 with field details', bad.data.details);

  const list = await call('GET', '/api/own/vehicles');
  expect(list.status === 200 && list.data.rows[0]?.id === v.id, `list (newest first): ${list.data.total} vehicles`);

  const opts = await call('GET', '/api/own/vehicles/options');
  expect(opts.status === 200 && opts.data.some((o) => o.id === v.id && o.label === 'ZZTEST 01'), `options: ${opts.data.length} active vehicles with labels`);
  return v;
}

async function checkDrivers() {
  console.log('\nDrivers');
  const res = await call('POST', '/api/own/drivers', { name: 'ZZTEST Driver', phone: '9000000000', daily_rate: '700', status: 'active' });
  expect(res.status === 201, 'create -> 201', res.data);
  const d = res.data;
  created.drivers.push(d.id);

  const history = await models.DriverRateHistory.findAll({ where: { driver_id: d.id }, raw: true });
  expect(history.length === 1 && Number(history[0].daily_rate) === 700, 'new driver gets a rate-history row');

  const rev = await call('POST', `/api/own/drivers/${d.id}/rate`, { new_rate: '750', effective_date: '2026-11-01' });
  expect(rev.status === 200 && Number(rev.data.daily_rate) === 750, 'revise rate updates the driver');
  const history2 = await models.DriverRateHistory.count({ where: { driver_id: d.id } });
  expect(history2 === 2, 'revise rate adds a history row');

  const del = await call('DELETE', `/api/own/drivers/${d.id}`);
  const after = await models.Drivers.findByPk(d.id, { raw: true });
  expect(del.status === 200 && after.status === 'deleted', "delete is a soft delete (status 'deleted')");
  const list = await call('GET', '/api/own/drivers');
  expect(!list.data.rows.some((r) => r.id === d.id), 'deleted drivers are hidden from the list');
  const revDeleted = await call('POST', `/api/own/drivers/${d.id}/rate`, { new_rate: '800', effective_date: '2026-12-01' });
  expect(revDeleted.status === 404, 'revising a deleted driver -> 404');

  const live = await call('POST', '/api/own/drivers', { name: 'ZZTEST Driver 2', phone: '9000000001', daily_rate: '600' });
  created.drivers.push(live.data.id);
  return live.data;
}

async function checkRoutes(vehicle, driver) {
  console.log('\nRoutes');
  const res = await call('POST', '/api/own/routes', { route_name: 'ZZTEST Chennai - Madurai', vehicle_id: vehicle.id, driver_id: driver.id, max_km: '', extra_km_rate: '12.5' });
  expect(res.status === 201 && res.data.max_km === 0, 'create (empty max km -> 0)', res.data);
  created.routes.push(res.data.id);

  const search = await call('GET', '/api/own/routes?search=ZZTEST');
  const row = search.data.rows[0];
  expect(search.data.total === 1 && row?.vehicle?.reg_no === 'ZZTEST 01' && row?.driver?.name === 'ZZTEST Driver 2', 'search + vehicle and driver included');
  const filtered = await call('GET', `/api/own/routes?vehicle_id=${vehicle.id}&driver_id=${driver.id}`);
  expect(filtered.data.total === 1, 'vehicle and driver filters');
  const page = await call('GET', '/api/own/routes?page=1');
  expect(page.data.rows.length <= 12 && page.data.pages >= 1, `paginated 12 per page (${page.data.total} routes, ${page.data.pages} pages)`);
  const missing = await call('POST', '/api/own/routes', { route_name: 'x' });
  expect(missing.status === 400, 'vehicle and driver are required -> 400');
}

async function checkMaintenance(vehicle) {
  console.log('\nMaintenance');
  const body = { vehicle_id: vehicle.id, service_date: '2026-10-01', type: 'Engine Oil', description: 'ZZTEST oil change', km_reading: '45210', cost_spares: '1200.50', cost_labour: '300' };
  const res = await call('POST', '/api/own/maintenance', body);
  expect(res.status === 201 && Number(res.data.total_cost) === 1500.5, `create; total = spares + labour (${res.data.total_cost})`, res.data);
  created.maintenance.push(res.data.id);
  const dup = await call('POST', '/api/own/maintenance', body);
  expect(dup.status === 409, 'same vehicle + date on add -> 409');
  const upd = await call('PUT', `/api/own/maintenance/${res.data.id}`, { ...body, cost_labour: '500' });
  expect(upd.status === 200 && Number(upd.data.total_cost) === 1700.5, 'update recalculates total (same date allowed on edit)');
  const list = await call('GET', `/api/own/maintenance?vehicle_id=${vehicle.id}`);
  expect(list.data.total === 1 && list.data.rows[0].vehicle.reg_no === 'ZZTEST 01', 'vehicle filter + vehicle included');
  const badType = await call('POST', '/api/own/maintenance', { ...body, service_date: '2026-10-02', type: 'Car wash' });
  expect(badType.status === 400, 'unknown type -> 400');
}

async function checkCommitments(vehicle) {
  console.log('\nCommitments');
  const res = await call('POST', '/api/own/commitments', { name: 'ZZTEST EMI', amount: '15000', frequency: 'monthly', due_date: '', vehicle_id: '' });
  expect(res.status === 201 && res.data.due_date === null && res.data.vehicle_id === null, 'create with optional fields empty -> null');
  created.commitments.push(res.data.id);
  const upd = await call('PUT', `/api/own/commitments/${res.data.id}`, { name: 'ZZTEST EMI', amount: '15000', frequency: 'yearly', due_date: '2026-12-05', vehicle_id: vehicle.id });
  expect(upd.status === 200 && upd.data.vehicle_id === vehicle.id, 'update links a vehicle');
  const sv = await call('GET', '/api/sv/commitments');
  expect(sv.status === 404, 'commitments are not available for sub-vendors -> 404');
}

async function checkScopesAndSettings() {
  console.log('\nScopes and settings');
  const bad = await call('GET', '/api/xyz/vehicles');
  expect(bad.status === 404, 'unknown scope -> 404');
  const sv = await call('GET', '/api/sv/vehicles');
  expect(sv.status === 200 && sv.data.total >= 1, `sub-vendor vehicles through the same route (${sv.data.total})`);
  const svDrivers = await call('GET', '/api/sv/drivers');
  expect(svDrivers.status === 200 && svDrivers.data.rows.every((r) => r.status !== 'deleted'), 'sub-vendor drivers list hides deleted');

  const before = await call('GET', '/api/settings');
  expect(before.status === 200 && 'global_diesel_price' in before.data, 'GET settings');
  const put = await call('PUT', '/api/settings', { ...before.data, global_cng_price: before.data.global_cng_price });
  expect(put.status === 200, 'PUT settings (same values)');
  const q = await call('GET', '/api/quote-settings');
  expect(q.status === 200 && 'company_name' in q.data, 'GET quote settings');
  const badEmail = await call('PUT', '/api/quote-settings', { ...q.data, email: 'not-an-email' });
  expect(badEmail.status === 400, 'quote settings rejects an invalid email');
}

async function cleanup() {
  const { Op } = require('sequelize');
  await models.Commitments.destroy({ where: { id: { [Op.in]: created.commitments } } });
  await models.Maintenance.destroy({ where: { id: { [Op.in]: created.maintenance } } });
  await models.Routes.destroy({ where: { id: { [Op.in]: created.routes } } });
  await models.DriverRateHistory.destroy({ where: { driver_id: { [Op.in]: created.drivers } } });
  await models.Drivers.destroy({ where: { id: { [Op.in]: created.drivers } } });
  await models.Vehicles.destroy({ where: { [Op.or]: [{ id: { [Op.in]: created.vehicles } }, { reg_no: { [Op.like]: 'ZZTEST%' } }] } });
  const fs = require('fs');
  const path = require('path');
  for (const f of created.files) fs.rmSync(path.join(env.uploadDir, path.basename(f)), { force: true });
  console.log('\nCleaned up test records and files');
}

(async () => {
  const server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    const vehicle = await checkVehicles();
    if (vehicle) {
      const driver = await checkDrivers();
      await checkRoutes(vehicle, driver);
      await checkMaintenance(vehicle);
      await checkCommitments(vehicle);
    }
    await checkScopesAndSettings();
  } catch (err) {
    fail(err.stack);
  } finally {
    await cleanup().catch((err) => fail(`cleanup: ${err.message}`));
    server.close();
    await sequelize.close();
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll CRUD checks passed');
  process.exit(failures ? 1 : 0);
})();
