/*
 * Driver payroll — rules copied from car-v1/salaries.php (sv_salaries.php for 'sv').
 * Salaries are not stored: each month is calculated from attendance, the rate history and
 * salary_transactions (advances, payments, deductions, carry-forwards).
 */
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');
const { modelFor, tableFor } = require('./scope');
const { HttpError } = require('../middleware/errorHandler');
const { z, id, text, parseBody } = require('../utils/validation');
const { today } = require('../utils/dates');
const SQL = require('../queries/salaries.sql');

// 10/20/50 as on every list (gap review); 30 (the PHP default) and 75/100 still accepted.
const PAGE_SIZES = [10, 20, 30, 50, 75, 100];
const ENTRY_TYPES = ['advance', 'payment', 'monthly_salary', 'weekly_salary', 'deduction'];

const tables = (scope) => ({
  drivers: tableFor('drivers', scope),
  rates: tableFor('driverRates', scope),
  attendance: tableFor('attendance', scope),
  trans: tableFor('salaryTransactions', scope),
});

const select = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const num = (v) => Number(v) || 0;
const round2 = (v) => Math.round(v * 100) / 100;

/** ?month & ?year, defaulting to the current month in India time (PHP: date('m'), date('Y')). */
function monthYear(query = {}) {
  const [y, m] = today().split('-').map(Number);
  const month = query.month === undefined || query.month === '' ? m : Number.parseInt(query.month, 10);
  const year = query.year === undefined || query.year === '' ? y : Number.parseInt(query.year, 10);
  if (!(month >= 1 && month <= 12) || !(year >= 2000 && year <= 2100)) throw new HttpError(400, 'Choose a valid month and year');
  return { month, year };
}

/** The 12 payroll columns for one driver, calculated exactly as the PHP table did. */
function payrollRow(r) {
  const daysPresent = num(r.days_present);
  const daysAbsent = num(r.days_absent);
  const dailyRate = num(r.daily_rate);
  const monthAdvance = num(r.month_advance);
  const totalPaid = num(r.total_paid);
  const totalDeduction = num(r.total_deduction);
  const prevCarry = num(r.prev_carry);
  const salary = round2(daysPresent * dailyRate);
  const totalAdvance = round2(monthAdvance + prevCarry);
  return {
    id: r.id,
    name: r.name,
    daily_rate: dailyRate,
    days_present: daysPresent,
    days_absent: daysAbsent,
    total_days: daysPresent + daysAbsent, // leave is in neither column, as in PHP
    prev_advance: prevCarry, // PREV ADV
    month_advance: monthAdvance, // NEW ADV
    advance_dates: r.advance_dates || '',
    total_advance: totalAdvance, // TOTAL ADV
    total_deduction: totalDeduction, // DEDUCTION
    deduction_dates: r.deduction_dates || '',
    salary, // SALARY
    total_paid: totalPaid, // PAID
    salary_balance: round2(salary - totalPaid), // SALARY BAL
    advance_balance: round2(totalAdvance - totalDeduction), // ADV BAL
  };
}

/** GET /:scope/salaries — the payroll table for a month. */
async function list(scope, query) {
  const { month, year } = monthYear(query);
  const limit = PAGE_SIZES.includes(Number(query.limit)) ? Number(query.limit) : 30;
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const offset = (page - 1) * limit;
  const search = String(query.search || '').trim();
  const t = tables(scope);

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const params = [year, month, month, year, month, year, month, year, month, year, month, year, month, year, month, year, prevMonth, prevYear];
  if (search) params.push(`%${search}%`);

  const [[count], rows] = await Promise.all([
    select(SQL.countDrivers(t, Boolean(search)), search ? [`%${search}%`] : []),
    select(SQL.payroll(t, { withSearch: Boolean(search), limit, offset }), params),
  ]);
  const data = rows.map(payrollRow);

  // The PHP summary cards and TOTAL row add up the drivers on the current page only.
  const totals = data.reduce(
    (acc, r) => ({
      salary: round2(acc.salary + r.salary),
      paid: round2(acc.paid + r.total_paid),
      salary_balance: round2(acc.salary_balance + r.salary_balance),
      advance_balance: round2(acc.advance_balance + r.advance_balance),
    }),
    { salary: 0, paid: 0, salary_balance: 0, advance_balance: 0 }
  );

  const total = num(count?.n);
  return { month, year, limit, rows: data, totals, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}

/** GET /:scope/salaries/:driverId/stats — the info panel in the payment modal. */
async function stats(scope, driverId, query) {
  const { month, year } = monthYear(query);
  const t = tables(scope);
  const [[rate], [att], trans] = await Promise.all([
    select(SQL.driverRate(t), [driverId, year, month, driverId]),
    select(SQL.driverAttendance(t), [driverId, month, year]),
    select(SQL.driverMonthTransactions(t), [driverId, month, year]),
  ]);
  const dailyRate = num(rate?.rate);
  const daysPresent = num(att?.days_present);
  const sumOf = (type) => round2(trans.filter((x) => x.type === type).reduce((s, x) => s + num(x.amount), 0));
  return {
    month,
    year,
    daily_rate: dailyRate,
    days_present: daysPresent,
    days_absent: num(att?.days_absent),
    total_salary: round2(daysPresent * dailyRate),
    existing_advances: sumOf('advance'),
    existing_deductions: sumOf('deduction'),
    carry_forward: sumOf('carry_forward'),
  };
}

/** GET /:scope/salaries/:driverId/history — one driver's transactions (a month, or all when no month is given). */
async function history(scope, driverId, query) {
  const withMonth = Boolean(query.month && query.year);
  const replacements = [driverId];
  if (withMonth) {
    const { month, year } = monthYear(query);
    replacements.push(month, year);
  }
  return select(SQL.driverHistory(tables(scope), withMonth), replacements);
}

/** GET /:scope/salary-transactions?month&year — every transaction of the month, newest first. */
async function monthTransactions(scope, query) {
  const { month, year } = monthYear(query);
  return select(SQL.monthTransactions(tables(scope)), [month, year]);
}

const amount = () =>
  z.preprocess((v) => (v === '' || v == null ? 0 : v), z.coerce.number().gt(0, 'Enter an amount above 0').max(99_999_999.99, 'Amount is too large'));

const createSchema = z.object({
  driver_id: id('Driver'),
  amount_type: z.enum(ENTRY_TYPES, { message: 'Choose an amount type' }),
  amount: amount(),
  note: text(255, { optional: true, label: 'Note' }),
  month: z.coerce.number().int().min(1, 'Invalid month').max(12, 'Invalid month'),
  year: z.coerce.number().int().min(2000, 'Invalid year').max(2100, 'Invalid year'),
});

const updateSchema = z.object({
  amount_type: z.enum(ENTRY_TYPES, { message: 'Choose an amount type' }),
  amount: amount(),
  note: text(255, { optional: true, label: 'Note' }),
});

/** POST — records an advance, payment or deduction for the chosen month; payment_date is today. */
async function create(scope, body, recordedBy) {
  const data = parseBody(createSchema, body);
  const driver = await modelFor('drivers', scope).findByPk(data.driver_id, { attributes: ['id'] });
  if (!driver) throw new HttpError(400, 'Driver not found', { driver_id: 'Driver not found' });
  const row = await modelFor('salaryTransactions', scope).create({
    driver_id: data.driver_id,
    type: data.amount_type,
    amount: data.amount,
    note: data.note,
    recorded_by: String(recordedBy || 'Admin').slice(0, 100),
    payment_date: today(),
    month: data.month,
    year: data.year,
  });
  return row.get({ plain: true });
}

async function findEditable(scope, transactionId) {
  const row = await modelFor('salaryTransactions', scope).findByPk(transactionId);
  if (!row) throw new HttpError(404, 'Transaction not found');
  // The PHP page shows no edit/delete buttons for carry-forward rows; the API enforces it.
  if (row.type === 'carry_forward') throw new HttpError(400, 'Carry-forward entries cannot be changed');
  return row;
}

/** PUT — changes type, amount and note only (month, year and dates stay), as in PHP. */
async function update(scope, transactionId, body) {
  const data = parseBody(updateSchema, body);
  const row = await findEditable(scope, transactionId);
  await row.update({ type: data.amount_type, amount: data.amount, note: data.note });
  return row.get({ plain: true });
}

async function remove(scope, transactionId) {
  const row = await findEditable(scope, transactionId);
  await row.destroy();
}

module.exports = { PAGE_SIZES, ENTRY_TYPES, monthYear, payrollRow, list, stats, history, monthTransactions, create, update, remove };
