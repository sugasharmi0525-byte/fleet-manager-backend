/*
 * Phase 8 check: payroll and salary transactions, end to end against the dev database.
 *  1. Parity: every column for every active driver, for every month that has transactions,
 *     recalculated independently (simple per-driver queries, not the copied PHP SQL).
 *  2. A test driver in 2099 with a known rate history, attendance and transactions.
 * Test records are removed at the end.
 *
 *   npm run check:salaries -w server
 */
const { QueryTypes } = require('sequelize');
const { models, sequelize } = require('../models');
const { tableFor } = require('../services/scope');
const { today } = require('../utils/dates');
const { createHarness } = require('./lib/harness');

const USER = 'salary-check';
const { expect, section, call, run } = createHarness(USER);
const created = { own: [], sv: [] };
const q = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

// ---------------------------------------------------------------- 1. Parity with existing data
async function expectedRow(scope, driver, month, year) {
  const t = (e) => tableFor(e, scope);
  const lastDay = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`;
  const [hist] = await q(`SELECT daily_rate FROM ${t('driverRates')} WHERE driver_id = ? AND effective_date <= ? ORDER BY effective_date DESC LIMIT 1`, [driver.id, lastDay]);
  const rate = Number(hist ? hist.daily_rate : driver.daily_rate) || 0;
  const att = await q(`SELECT status, COUNT(*) n FROM ${t('attendance')} WHERE driver_id = ? AND date BETWEEN ? AND ? GROUP BY status`, [driver.id, `${lastDay.slice(0, 8)}01`, lastDay]);
  const count = (s) => Number(att.find((a) => a.status === s)?.n) || 0;
  const sums = async (m, y) => {
    const rows = await q(`SELECT type, SUM(amount) s FROM ${t('salaryTransactions')} WHERE driver_id = ? AND month = ? AND year = ? GROUP BY type`, [driver.id, m, y]);
    return (type) => Number(rows.find((r) => r.type === type)?.s) || 0;
  };
  const cur = await sums(month, year);
  const prev = await sums(month === 1 ? 12 : month - 1, month === 1 ? year - 1 : year);
  const present = count('present');
  const salary = present * rate;
  const paid = cur('payment') + cur('monthly_salary') + cur('weekly_salary');
  const prevAdv = prev('advance') + prev('carry_forward') - prev('deduction');
  const totalAdv = cur('advance') + prevAdv;
  return {
    daily_rate: rate,
    days_present: present,
    days_absent: count('absent'),
    prev_advance: prevAdv,
    month_advance: cur('advance'),
    total_advance: totalAdv,
    total_deduction: cur('deduction'),
    salary,
    total_paid: paid,
    salary_balance: salary - paid,
    advance_balance: totalAdv - cur('deduction'),
  };
}

async function allRows(scope, month, year) {
  const rows = [];
  for (let page = 1; ; page += 1) {
    const { data } = await call('GET', `/api/${scope}/salaries?month=${month}&year=${year}&limit=100&page=${page}`);
    rows.push(...data.rows);
    if (page >= data.pages) return { rows, total: data.total };
  }
}

async function parity() {
  for (const scope of ['own', 'sv']) {
    const months = await q(`SELECT DISTINCT year, month FROM ${tableFor('salaryTransactions', scope)} WHERE year < 2099 ORDER BY year, month`);
    const driverRows = await q(`SELECT id, name, daily_rate FROM ${tableFor('drivers', scope)} WHERE status = 'active' AND name NOT LIKE 'ZZTEST%'`);
    for (const { month, year } of months) {
      section(`Parity ${scope} ${year}-${String(month).padStart(2, '0')}`);
      const { rows } = await allRows(scope, month, year);
      const real = rows.filter((r) => !r.name.startsWith('ZZTEST'));
      expect(real.length === driverRows.length, `${real.length} active drivers listed`, driverRows.length);
      let mismatches = 0;
      for (const driver of driverRows) {
        const got = real.find((r) => r.id === driver.id);
        const want = await expectedRow(scope, driver, month, year);
        const bad = Object.keys(want).filter((k) => !got || !near(got[k], want[k]));
        if (bad.length) {
          mismatches += 1;
          console.log(`        ${driver.name}: ${bad.map((k) => `${k} ${got?.[k]} != ${want[k]}`).join(', ')}`);
        }
      }
      expect(mismatches === 0, `all 11 calculated columns match for ${driverRows.length} drivers`, { mismatches });
      const sum = (k) => real.reduce((s, r) => s + r[k], 0);
      console.log(`        salary ₹${sum('salary')}, paid ₹${sum('total_paid')}, salary bal ₹${sum('salary_balance')}, adv bal ₹${sum('advance_balance')}`);
    }
  }
}

// ---------------------------------------------------------------- 2. Known test data
async function setup() {
  const d = await models.Drivers.create({ name: 'ZZTEST Salary Driver', phone: '9', daily_rate: 500, status: 'active' });
  created.own.push(d.id);
  await models.DriverRateHistory.bulkCreate([
    { driver_id: d.id, daily_rate: 600, effective_date: '2099-01-01' },
    { driver_id: d.id, daily_rate: 700, effective_date: '2099-02-15' },
    { driver_id: d.id, daily_rate: 800, effective_date: '2099-03-01' },
  ]);
  await models.Attendance.bulkCreate([
    { driver_id: d.id, date: '2099-02-01', status: 'present' },
    { driver_id: d.id, date: '2099-02-02', status: 'present' },
    { driver_id: d.id, date: '2099-02-03', status: 'present' },
    { driver_id: d.id, date: '2099-02-04', status: 'absent' },
    { driver_id: d.id, date: '2099-02-05', status: 'leave' },
  ]);
  // January: advance 1000 + carry-forward 200 - deduction 300 => February PREV ADV 900
  await models.SalaryTransactions.bulkCreate([
    { driver_id: d.id, type: 'advance', amount: 1000, month: 1, year: 2099, payment_date: '2099-01-05' },
    { driver_id: d.id, type: 'carry_forward', amount: 200, month: 1, year: 2099, payment_date: '2099-01-06' },
    { driver_id: d.id, type: 'deduction', amount: 300, month: 1, year: 2099, payment_date: '2099-01-07' },
  ]);
  // An explicit id: the old car_tracking dump lacks AUTO_INCREMENT on sub_vendor_drivers.id (production has it).
  const svId = (Number(await models.SubVendorDrivers.max('id')) || 0) + 1000;
  const sv = await models.SubVendorDrivers.create({ id: svId, name: 'ZZTEST SV Salary Driver', daily_rate: 400, status: 'active' });
  created.sv.push(sv.id);
  // sub_vendor_attendance.id has no key or AUTO_INCREMENT in any dump (see Phase 10 notes).
  const attId = (Number(await models.SubVendorAttendance.max('id')) || 0) + 1000;
  await models.SubVendorAttendance.bulkCreate([
    { id: attId, driver_id: sv.id, date: '2099-02-01', status: 'present' },
    { id: attId + 1, driver_id: sv.id, date: '2099-02-02', status: 'present' },
  ]);
  return { driverId: d.id, svDriverId: sv.id };
}

async function knownData({ driverId, svDriverId }) {
  section('Transactions');
  const post = (body, scope = 'own') => call('POST', `/api/${scope}/salary-transactions`, { month: 2, year: 2099, ...body });
  const ids = {};
  for (const [type, amount] of [['advance', 500], ['monthly_salary', 1000], ['weekly_salary', 200], ['payment', 100], ['deduction', 400]]) {
    const r = await post({ driver_id: driverId, amount_type: type, amount, note: `test ${type}` });
    expect(r.status === 201, `add ${type} ₹${amount}`, r.data);
    ids[type] = r.data.id;
  }
  const one = await models.SalaryTransactions.findByPk(ids.advance, { raw: true });
  expect(one.recorded_by === USER && one.payment_date === today() && one.month === 2 && one.year === 2099, 'recorded_by = session user, payment_date = today, month/year from the form', one);

  let r = await post({ driver_id: driverId, amount_type: 'advance', amount: 0 });
  expect(r.status === 400 && r.data.details?.amount, 'amount 0 is rejected', r.data);
  r = await post({ driver_id: driverId, amount_type: 'carry_forward', amount: 10 });
  expect(r.status === 400 && r.data.details?.amount_type, 'carry_forward cannot be added by hand', r.data);
  r = await post({ driver_id: 99999999, amount_type: 'advance', amount: 10 });
  expect(r.status === 400, 'unknown driver is rejected', r.data);
  r = await post({ driver_id: driverId, amount_type: 'advance', amount: 10, month: 13 });
  expect(r.status === 400, 'month 13 is rejected', r.data);
  r = await post({ driver_id: svDriverId, amount_type: 'advance', amount: 10 }, 'own');
  expect(r.status === 400, 'a sub-vendor driver id is not accepted in the own scope', r.data);

  const cf = await models.SalaryTransactions.findOne({ where: { driver_id: driverId, type: 'carry_forward' } });
  r = await call('PUT', `/api/own/salary-transactions/${cf.id}`, { amount_type: 'advance', amount: 5 });
  expect(r.status === 400, 'carry-forward row cannot be edited', r.data);
  r = await call('DELETE', `/api/own/salary-transactions/${cf.id}`);
  expect(r.status === 400, 'carry-forward row cannot be deleted', r.data);
  r = await call('DELETE', '/api/own/salary-transactions/99999999');
  expect(r.status === 404, 'unknown transaction -> 404', r.data);

  section('Payroll row (February 2099)');
  const row = async () => (await call('GET', '/api/own/salaries?month=2&year=2099&search=ZZTEST Salary')).data;
  let list = await row();
  let x = list.rows[0];
  expect(list.total === 1 && list.rows.length === 1, 'search finds the test driver only', list.total);
  expect(x.daily_rate === 700, 'rate = latest history entry by month end (700, not 800 from March)', x.daily_rate);
  expect(x.days_present === 3 && x.days_absent === 1 && x.total_days === 4, 'working 3, absent 1, total 4 (leave counted in neither)', x);
  expect(x.prev_advance === 900, 'PREV ADV = Jan advance 1000 + carry-forward 200 - deduction 300 = 900', x.prev_advance);
  expect(x.month_advance === 500 && x.total_advance === 1400, 'NEW ADV 500, TOTAL ADV 1400', x);
  expect(x.total_deduction === 400 && x.advance_balance === 1000, 'DEDUCTION 400, ADV BAL 1000', x);
  expect(x.salary === 2100 && x.total_paid === 1300 && x.salary_balance === 800, 'SALARY 2100, PAID 1300 (payment + monthly + weekly), SALARY BAL 800', x);
  expect(/^\d{2} \w{3}$/.test(x.advance_dates) && /^\d{2} \w{3}$/.test(x.deduction_dates), 'advance and deduction dates shown as "dd Mon"', [x.advance_dates, x.deduction_dates]);
  expect(list.totals.salary === 2100 && list.totals.advance_balance === 1000, 'totals add up the listed rows', list.totals);

  const jan = (await call('GET', '/api/own/salaries?month=1&year=2099&search=ZZTEST Salary')).data.rows[0];
  expect(jan.daily_rate === 600 && jan.prev_advance === 0 && jan.advance_balance === 700, 'January: rate 600, no PREV ADV, ADV BAL 1000 - 300 = 700', jan);
  const mar = (await call('GET', '/api/own/salaries?month=3&year=2099&search=ZZTEST Salary')).data.rows[0];
  expect(mar.daily_rate === 800 && mar.prev_advance === 100, 'March: rate 800, PREV ADV = Feb 500 - 400 = 100', mar);

  section('Payment modal');
  const stats = (await call('GET', `/api/own/salaries/${driverId}/stats?month=2&year=2099`)).data;
  expect(stats.daily_rate === 700 && stats.days_present === 3 && stats.days_absent === 2 && stats.total_salary === 2100, 'stats: rate 700, 3 present, 2 not present (leave included), salary 2100', stats);
  expect(stats.existing_advances === 500 && stats.existing_deductions === 400 && stats.carry_forward === 0, 'stats: advances 500, deductions 400, carry-forward 0', stats);
  const histMonth = (await call('GET', `/api/own/salaries/${driverId}/history?month=2&year=2099`)).data;
  const histAll = (await call('GET', `/api/own/salaries/${driverId}/history`)).data;
  expect(histMonth.length === 5 && histAll.length === 8, 'history: 5 for February, 8 in all', [histMonth.length, histAll.length]);
  const monthList = (await call('GET', '/api/own/salary-transactions?month=2&year=2099')).data;
  expect(monthList.filter((t) => t.driver_id === driverId).length === 5 && monthList[0].driver_name, 'month transaction list includes driver names', monthList.length);

  section('Edit and delete');
  r = await call('PUT', `/api/own/salary-transactions/${ids.monthly_salary}`, { amount_type: 'advance', amount: 1000, note: 'moved' });
  expect(r.status === 200 && r.data.type === 'advance' && r.data.month === 2, 'edit changes type, amount and note only', r.data);
  x = (await row()).rows[0];
  expect(x.month_advance === 1500 && x.total_paid === 300 && x.salary_balance === 1800, 'after edit: NEW ADV 1500, PAID 300, SALARY BAL 1800', x);
  r = await call('DELETE', `/api/own/salary-transactions/${ids.monthly_salary}`);
  expect(r.status === 200, 'delete', r.data);
  x = (await row()).rows[0];
  expect(x.month_advance === 500 && x.total_paid === 300, 'after delete: NEW ADV 500, PAID 300', x);

  section('Paging and sub-vendor scope');
  const p31 = (await call('GET', '/api/own/salaries?month=2&year=2099&limit=31')).data;
  expect(p31.limit === 30, 'page size other than 30/50/75/100 falls back to 30', p31.limit);
  const bad = await call('GET', '/api/own/salaries?month=0&year=2099');
  expect(bad.status === 400, 'month 0 -> 400', bad.data);
  r = await post({ driver_id: svDriverId, amount_type: 'weekly_salary', amount: 250 }, 'sv');
  expect(r.status === 201, 'sub-vendor transaction added', r.data);
  const sv = (await call('GET', '/api/sv/salaries?month=2&year=2099&search=ZZTEST SV')).data.rows[0];
  expect(sv && sv.daily_rate === 400 && sv.days_present === 2 && sv.salary === 800 && sv.total_paid === 250, 'sub-vendor row: rate 400, 2 present, salary 800, paid 250', sv);
  const ownSearch = (await call('GET', '/api/own/salaries?month=2&year=2099&search=ZZTEST SV')).data;
  expect(ownSearch.total === 0, 'sub-vendor driver does not appear in the own payroll', ownSearch.total);
}

async function cleanup() {
  await models.SalaryTransactions.destroy({ where: { driver_id: created.own } });
  await models.Attendance.destroy({ where: { driver_id: created.own } });
  await models.DriverRateHistory.destroy({ where: { driver_id: created.own } });
  await models.Drivers.destroy({ where: { id: created.own } });
  await models.SubVendorSalaryTransactions.destroy({ where: { driver_id: created.sv } });
  await models.SubVendorAttendance.destroy({ where: { driver_id: created.sv } });
  await models.SubVendorDrivers.destroy({ where: { id: created.sv } });
  console.log('\nCleaned up test records');
}

let ctx;
run({
  label: 'salary',
  sequelize,
  cleanup,
  steps: [parity, async () => (ctx = await setup()), () => knownData(ctx)],
});
