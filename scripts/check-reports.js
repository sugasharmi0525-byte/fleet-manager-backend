/*
 * Phase 9 check: financial, monthly, fuel and maintenance reports, end to end against the dev
 * database. Every figure is recalculated in JavaScript from the raw table rows (not with the
 * copied PHP SQL) for every month that has data, plus custom ranges and filters. Then manual
 * income add / edit / delete. Test records are removed at the end.
 *
 *   npm run check:reports -w server
 */
const { QueryTypes } = require('sequelize');
const { models, sequelize } = require('../models');
const { tableFor } = require('../services/scope');
const { createHarness } = require('./lib/harness');

const { expect, section, call, run } = createHarness('reports-check');
const q = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const n = (v) => Number(v) || 0;
const near = (a, b) => Math.abs(n(a) - n(b)) < 0.01;
const between = (d, from, to) => d >= from && d <= to;
const monthBounds = (y, m) => ({ from: `${y}-${String(m).padStart(2, '0')}-01`, to: `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}` });
const created = { incomes: [] };

let data;
async function load(scope) {
  const t = (e) => tableFor(e, scope);
  const [vehicles, drivers, logs, fuel, maint, commitments, incomes, charges] = await Promise.all([
    q(`SELECT id, reg_no, status FROM ${t('vehicles')}`),
    q(`SELECT id, daily_rate FROM ${t('drivers')}`),
    q(`SELECT vehicle_id, driver_id, date, opening_km, closing_km, other_exp, extra_km_cost, income FROM ${t('dailyLogs')}`),
    q(`SELECT vehicle_id, date, liters, amount, km_run FROM ${t('fuel')}`),
    q(`SELECT vehicle_id, service_date, cost_spares, cost_labour, total_cost FROM ${t('maintenance')}`),
    q('SELECT vehicle_id, amount, frequency, due_date FROM commitments'),
    q('SELECT id, vehicle_id, date, amount FROM manual_incomes ORDER BY id'),
    scope === 'sv' ? q('SELECT vehicle_id, date, loading_charge FROM sub_vendor_charges') : [],
  ]);
  const rate = Object.fromEntries(drivers.map((d) => [d.id, n(d.daily_rate)]));
  return { scope, vehicles, rate, logs, fuel, maint, commitments, incomes, charges };
}

/** Expected per-vehicle figures, from raw rows. */
function expected(d, vehicleId, from, to, driverId, { firstIncomeOnly, withMaintenance }) {
  const logs = d.logs.filter((l) => l.vehicle_id === vehicleId && between(l.date, from, to) && (!driverId || l.driver_id === driverId));
  const sum = (rows, f) => rows.reduce((s, r) => s + f(r), 0);
  const fuel = sum(d.fuel.filter((f) => f.vehicle_id === vehicleId && between(f.date, from, to)), (f) => n(f.amount));
  const maint = sum(d.maint.filter((m) => m.vehicle_id === vehicleId && between(m.service_date, from, to)), (m) => n(m.total_cost));
  const salary = sum(logs.filter((l) => l.driver_id in d.rate), (l) => d.rate[l.driver_id]);
  const comm = sum(d.commitments.filter((c) => c.vehicle_id === vehicleId && (c.frequency === 'monthly' || (c.due_date && between(c.due_date, from, to)))), (c) => n(c.amount));
  const inc = d.incomes.filter((i) => i.vehicle_id === vehicleId && between(i.date, from, to));
  const manual = firstIncomeOnly ? n(inc[0]?.amount) : sum(inc, (i) => n(i.amount));
  const charges = sum(d.charges.filter((c) => c.vehicle_id === vehicleId && between(c.date, from, to)), (c) => n(c.loading_charge));
  const other = sum(logs, (l) => n(l.other_exp) + n(l.extra_km_cost));
  const income = sum(logs, (l) => n(l.income)) + manual + charges;
  const expense = fuel + (withMaintenance ? maint : 0) + other + comm + salary;
  return {
    days: new Set(logs.map((l) => l.date)).size,
    kms: sum(logs, (l) => n(l.closing_km) - n(l.opening_km)),
    income,
    fuel,
    salary,
    expense,
    profit: income - expense,
    ...(withMaintenance ? { maint: maint + other + comm } : {}),
  };
}

function compare(label, rows, wantFor) {
  let bad = 0;
  for (const row of rows) {
    const want = wantFor(row.id);
    const diffs = Object.keys(want).filter((k) => !near(row[k], want[k]));
    if (diffs.length) {
      bad += 1;
      if (bad <= 5) console.log(`        ${row.reg_no}: ${diffs.map((k) => `${k} ${row[k]} != ${want[k]}`).join(', ')}`);
    }
  }
  expect(bad === 0, `${label}: every column matches for ${rows.length} vehicles`, { mismatches: bad });
}

const reportStatuses = (scope) => ['active', scope === 'sv' ? 'sub_vendor_maintenance' : 'maintenance'];

async function financialAndMonthly(scope) {
  const d = await load(scope);
  const months = [...new Set(d.logs.map((l) => l.date.slice(0, 7)))].sort();
  const statusIds = d.vehicles.filter((v) => reportStatuses(scope).includes(v.status)).map((v) => v.id).sort((a, b) => a - b);

  for (const ym of months) {
    const [y, m] = ym.split('-').map(Number);
    const { from, to } = monthBounds(y, m);
    section(`${scope} ${ym}`);
    const fin = (await call('GET', `/api/${scope}/reports/financial?from_date=${from}&to_date=${to}`)).data;
    expect(JSON.stringify(fin.rows.map((r) => r.id).sort((a, b) => a - b)) === JSON.stringify(statusIds), `financial lists the ${statusIds.length} active/maintenance vehicles`);
    compare('financial', fin.rows, (vid) => expected(d, vid, from, to, null, { firstIncomeOnly: false, withMaintenance: true }));
    expect(near(fin.totals.profit, fin.rows.reduce((s, r) => s + r.profit, 0)), 'financial totals add up');

    const mon = (await call('GET', `/api/${scope}/reports/monthly?month=${m}&year=${y}`)).data;
    compare('monthly', mon.rows, (vid) => expected(d, vid, from, to, null, { firstIncomeOnly: true, withMaintenance: false }));
    const kmOk = mon.rows.every((r) => near(r.daily_logs.reduce((s, l) => s + l.total_km, 0), r.kms) || r.daily_logs.length !== r.days);
    expect(kmOk, 'monthly "View KM" day lists add up to the vehicle km');
    console.log(`        financial profit ₹${fin.totals.profit}, monthly profit ₹${mon.totals.profit}`);
  }

  if (!months.length) return;
  section(`${scope} filters`);
  const { from } = monthBounds(...months[0].split('-').map(Number));
  const { to } = monthBounds(...months.at(-1).split('-').map(Number));
  const busiest = Object.entries(d.logs.reduce((acc, l) => ({ ...acc, [l.vehicle_id]: (acc[l.vehicle_id] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const v1 = Number(busiest[0][0]);
  const two = statusIds.slice(0, 2);

  const range = (await call('GET', `/api/${scope}/reports/financial?from_date=${from}&to_date=${to}`)).data;
  compare(`financial ${from} to ${to} (whole range)`, range.rows, (vid) => expected(d, vid, from, to, null, { firstIncomeOnly: false, withMaintenance: true }));
  const single = (await call('GET', `/api/${scope}/reports/financial?from_date=${from}&to_date=${to}&vehicle_id=${v1}`)).data;
  expect(single.rows.length === 1 && single.single?.id === v1, 'one vehicle chosen -> single-vehicle summary', single.single?.reg_no);
  const pair = (await call('GET', `/api/${scope}/reports/financial?from_date=${from}&to_date=${to}&vehicle_id=${two.join(',')}`)).data;
  expect(pair.rows.length === two.length && pair.single === null, 'two vehicles chosen -> no single summary');

  const [y, m] = months.at(-1).split('-').map(Number);
  const bounds = monthBounds(y, m);
  const driverLog = d.logs.find((l) => l.date.startsWith(months.at(-1)) && l.driver_id);
  if (driverLog) {
    const byDriver = (await call('GET', `/api/${scope}/reports/monthly?month=${m}&year=${y}&driver_id=${driverLog.driver_id}`)).data;
    const drove = new Set(d.logs.filter((l) => l.driver_id === driverLog.driver_id && between(l.date, bounds.from, bounds.to)).map((l) => l.vehicle_id));
    expect(byDriver.rows.every((r) => drove.has(r.id)) && byDriver.rows.length === [...drove].filter((id) => d.vehicles.some((v) => v.id === id && reportStatuses(scope).includes(v.status))).length,
      'monthly with a driver lists only the vehicles that driver drove');
    compare('monthly with driver filter', byDriver.rows, (vid) => expected(d, vid, bounds.from, bounds.to, driverLog.driver_id, { firstIncomeOnly: true, withMaintenance: false }));
  }
  const opts = (await call('GET', `/api/${scope}/reports/options/monthly`)).data;
  expect(opts.vehicles.length === statusIds.length && Array.isArray(opts.drivers), 'monthly filter options');
}

async function fuelAndMaintenance() {
  const d = await load('own');
  section('Fuel report');
  for (const ym of [...new Set(d.fuel.map((f) => f.date.slice(0, 7)))].sort()) {
    const { from, to } = monthBounds(...ym.split('-').map(Number));
    const rep = (await call('GET', `/api/own/reports/fuel?from_date=${from}&to_date=${to}`)).data;
    const inRange = d.fuel.filter((f) => between(f.date, from, to) && d.vehicles.some((v) => v.id === f.vehicle_id));
    const vids = [...new Set(inRange.map((f) => f.vehicle_id))];
    let bad = 0;
    for (const vid of vids) {
      const logs = inRange.filter((f) => f.vehicle_id === vid);
      const liters = logs.reduce((s, f) => s + n(f.liters), 0);
      const kms = logs.reduce((s, f) => s + n(f.km_run), 0);
      const b = rep.vehicles.find((x) => x.vehicle.id === vid);
      if (!b || b.logs.length !== logs.length || !near(b.summary.liters, liters) || !near(b.summary.amount, logs.reduce((s, f) => s + n(f.amount), 0)) || !near(b.summary.kms, kms) || !near(b.summary.mileage, liters ? kms / liters : 0)) bad += 1;
    }
    const consolidatedOk = rep.consolidated.length === inRange.length && near(rep.consolidated.reduce((s, c) => s + n(c.amount), 0), inRange.reduce((s, f) => s + n(f.amount), 0));
    expect(bad === 0 && rep.vehicles.length === vids.length && consolidatedOk, `${ym}: ${vids.length} vehicles, ${inRange.length} fills, totals and day-by-day list match`, { bad });
  }

  section('Maintenance report');
  for (const ym of [...new Set(d.maint.map((m) => m.service_date.slice(0, 7)))].sort()) {
    const [y, m] = ym.split('-').map(Number);
    const { from, to } = monthBounds(y, m);
    const rep = (await call('GET', `/api/own/reports/maintenance?month=${m}&year=${y}`)).data;
    const inRange = d.maint.filter((x) => between(x.service_date, from, to) && d.vehicles.some((v) => v.id === x.vehicle_id));
    const vids = [...new Set(inRange.map((x) => x.vehicle_id))];
    const ok = vids.every((vid) => {
      const rows = inRange.filter((x) => x.vehicle_id === vid);
      const b = rep.vehicles.find((x) => x.vehicle.id === vid);
      const s = (k) => rows.reduce((acc, r) => acc + n(r[k]), 0);
      return b && b.logs.length === rows.length && near(b.summary.spares, s('cost_spares')) && near(b.summary.labour, s('cost_labour')) && near(b.summary.total, s('total_cost'));
    });
    expect(ok && rep.vehicles.length === vids.length, `${ym}: ${vids.length} vehicles, ${inRange.length} records, spares / labour / total match`);
  }
  const sv = await call('GET', '/api/sv/reports/fuel');
  expect(sv.status === 404, 'fuel report is own-fleet only (sv -> 404)', sv.status);
}

async function manualIncome() {
  section('Manual income');
  const [v] = await q("SELECT id, reg_no FROM vehicles WHERE status IN ('active','maintenance') ORDER BY id LIMIT 1");
  const month = { m: 1, y: 2099 };
  const row = async () => (await call('GET', `/api/own/reports/monthly?month=${month.m}&year=${month.y}&vehicle_id=${v.id}`)).data.rows[0];
  const fin = async () => (await call('GET', `/api/own/reports/financial?from_date=2099-01-01&to_date=2099-01-31&vehicle_id=${v.id}`)).data.rows[0];

  let r = await call('POST', '/api/own/manual-incomes', { vehicle_id: v.id, date: '2099-01-05', amount: 1500, description: 'test bonus' });
  expect(r.status === 201, 'add ₹1,500', r.data);
  created.incomes.push(r.data.id);
  const first = r.data.id;
  r = await call('POST', '/api/own/manual-incomes', { vehicle_id: v.id, date: '2099-01-20', amount: 700, description: 'second' });
  created.incomes.push(r.data.id);
  let x = await row();
  expect(x.manual_entry?.id === first && near(x.income, 1500), 'monthly report uses only the first income of the month (₹1,500)', x.income);
  expect(near((await fin()).income, 2200), 'financial report adds both (₹2,200)');

  r = await call('PUT', `/api/own/manual-incomes/${first}`, { vehicle_id: v.id, date: '2099-01-05', amount: 1800, description: 'edited' });
  expect(r.status === 200 && near(r.data.amount, 1800), 'edit to ₹1,800', r.data);
  x = await row();
  expect(near(x.income, 1800) && near(x.profit, x.income - x.expense), 'monthly report shows the edited amount');

  r = await call('POST', '/api/own/manual-incomes', { vehicle_id: v.id, date: 'bad', amount: 10 });
  expect(r.status === 400 && r.data.details?.date, 'invalid date is rejected', r.data);
  r = await call('POST', '/api/own/manual-incomes', { vehicle_id: 99999999, date: '2099-01-05', amount: 10 });
  expect(r.status === 400, 'unknown vehicle is rejected', r.data);
  r = await call('POST', '/api/own/manual-incomes', { vehicle_id: v.id, date: '2099-01-05', amount: '' });
  expect(r.status === 400 && r.data.details?.amount, 'amount is required', r.data);

  r = await call('DELETE', `/api/own/manual-incomes/${first}`);
  expect(r.status === 200, 'delete', r.data);
  x = await row();
  expect(near(x.income, 700), 'after delete the next income becomes the month entry (₹700)', x.income);
  r = await call('DELETE', `/api/own/manual-incomes/${first}`);
  expect(r.status === 404, 'deleting again -> 404');

  const bad = await call('GET', '/api/own/reports/financial?from_date=2026-13-45x');
  expect(bad.status === 400, 'invalid dates -> 400');
}

async function cleanup() {
  await models.ManualIncomes.destroy({ where: { id: created.incomes } });
  console.log('\nCleaned up test records');
}

run({
  label: 'report',
  sequelize,
  cleanup,
  steps: [() => financialAndMonthly('own'), () => financialAndMonthly('sv'), fuelAndMaintenance, manualIncome],
});
