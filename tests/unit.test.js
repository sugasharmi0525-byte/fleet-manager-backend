/*
 * Server unit tests: pure business rules and helpers, no database queries.
 * Uses Node's built-in test runner.
 *
 *   npm test -w server
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { pageParams, pageResult, PAGE_SIZES, DEFAULT_PAGE_SIZE } = require('../utils/pagination');
const { z, money, int, id, optionalId, date, optionalDate, text, parseBody } = require('../utils/validation');
const { today } = require('../utils/dates');
const { HttpError, notFound, errorHandler } = require('../middleware/errorHandler');
const requireAuth = require('../middleware/requireAuth');
const validateScope = require('../middleware/validateScope');
const { SCOPES, modelFor, tableFor, hasEntity } = require('../services/scope');
const { payrollRow } = require('../services/salary.service');
const { periodRange } = require('../services/dashboard.service');
const { monthRange, addDays } = require('../services/insights.service');
const { vehicleIds } = require('../services/report.service');
const { cleanHtml } = require('../services/quotation.service');
const { ENTITY_CONFIGS, MAINTENANCE_TYPES } = require('../crud/entities');
const { toId } = require('../crud/crudRouter');

const throwsHttp = (fn, status) =>
  assert.throws(fn, (err) => {
    assert.ok(err instanceof HttpError, `expected HttpError, got ${err?.name}`);
    assert.equal(err.status, status);
    return true;
  });

// ---------------------------------------------------------------- pagination
describe('pagination', () => {
  test('default page size is 10 and choices are 10/20/50', () => {
    assert.equal(DEFAULT_PAGE_SIZE, 10);
    assert.deepEqual(PAGE_SIZES, [10, 20, 50]);
    assert.deepEqual(pageParams({}), { page: 1, limit: 10, offset: 0 });
  });
  test('?limit accepts 10/20/50 only', () => {
    assert.equal(pageParams({ limit: '50', page: '3' }).offset, 100);
    assert.equal(pageParams({ limit: '33' }).limit, 10);
    assert.equal(pageParams({ limit: '1000' }, 15).limit, 15);
  });
  test('bad page numbers become page 1', () => {
    for (const page of ['0', '-4', 'abc', undefined]) assert.equal(pageParams({ page }).page, 1);
  });
  test('pageResult works out the page count', () => {
    assert.deepEqual(pageResult([], 0, 1, 10), { rows: [], total: 0, page: 1, pages: 1, limit: 10 });
    assert.equal(pageResult([], 101, 1, 10).pages, 11);
    assert.equal(pageResult([], 5, 1, null).pages, 1);
  });
});

// ---------------------------------------------------------------- validation
describe('validation helpers', () => {
  const schema = z.object({
    amount: money(),
    count: int(),
    vehicle_id: id('Vehicle'),
    other_id: optionalId(),
    on: date('Date'),
    maybe: optionalDate(),
    name: text(5, { label: 'Name' }),
    note: text(10, { optional: true }),
  });
  const ok = { amount: '', count: '', vehicle_id: '3', other_id: '', on: '2026-10-03', maybe: '', name: '  Ravi ', note: undefined };

  test('blank numbers become 0, blank ids/dates become null, text is trimmed', () => {
    assert.deepEqual(parseBody(schema, ok), { amount: 0, count: 0, vehicle_id: 3, other_id: null, on: '2026-10-03', maybe: null, name: 'Ravi', note: '' });
  });
  test('errors are a 400 with a message per field', () => {
    try {
      parseBody(schema, { ...ok, vehicle_id: '', on: '03-10-2026', name: 'Too long name', amount: '-5' });
      assert.fail('should throw');
    } catch (err) {
      assert.equal(err.status, 400);
      assert.equal(err.details.vehicle_id, 'Vehicle is required');
      assert.equal(err.details.on, 'Date must be a valid date');
      assert.equal(err.details.name, 'Name is too long');
      assert.equal(err.details.amount, 'Must be 0 or more');
    }
  });
  test('required text cannot be blank; whole numbers only for int()', () => {
    throwsHttp(() => parseBody(schema, { ...ok, name: '   ' }), 400);
    throwsHttp(() => parseBody(schema, { ...ok, count: '2.5' }), 400);
  });
  test('missing body is treated as empty', () => throwsHttp(() => parseBody(schema, undefined), 400));
});

describe('dates', () => {
  test('today() is India date YYYY-MM-DD', () => {
    assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
    const ist = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    assert.equal(today(), ist);
  });
  test('addDays crosses months and years', () => {
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-01-01', -1), '2025-12-31');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  });
  test('monthRange gives the first and last day', () => {
    assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
    assert.deepEqual(monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
    assert.deepEqual(monthRange('2026-12'), { from: '2026-12-01', to: '2026-12-31' });
  });
});

// ---------------------------------------------------------------- middleware
describe('middleware', () => {
  const run = (mw, req) => {
    let passed;
    mw(req, {}, (err) => {
      passed = err ?? null;
    });
    return passed;
  };
  test('requireAuth: 401 without a session user', () => {
    assert.equal(run(requireAuth, { session: {} }).status, 401);
    assert.equal(run(requireAuth, {}).status, 401);
    assert.equal(run(requireAuth, { session: { user: { username: 'admin' } } }), null);
  });
  test('validateScope: only own and sv', () => {
    assert.deepEqual(SCOPES, ['own', 'sv']);
    assert.equal(run(validateScope, { params: { scope: 'own' } }), null);
    assert.equal(run(validateScope, { params: { scope: 'sv' } }), null);
    assert.equal(run(validateScope, { params: { scope: 'xyz' }, method: 'GET', originalUrl: '/api/xyz/vehicles' }).status, 404);
  });
  test('notFound passes a 404', () => assert.equal(run(notFound, { method: 'GET', originalUrl: '/x' }).status, 404));

  const respond = (err, extra = {}) => {
    const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; } };
    const log = { warn() {}, error() {} };
    errorHandler(err, { method: 'GET', originalUrl: '/t', id: 'req-1', log, ...extra }, res, () => {});
    return res;
  };
  test('errorHandler maps errors to status codes', () => {
    assert.equal(respond(new HttpError(409, 'Duplicate', { date: 'x' })).code, 409);
    assert.deepEqual(respond(new HttpError(400, 'Bad', { a: 'b' })).body, { error: 'Bad', requestId: 'req-1', details: { a: 'b' } });
    assert.equal(respond(Object.assign(new Error('x'), { type: 'entity.parse.failed' })).code, 400);
    assert.equal(respond(Object.assign(new Error('x'), { type: 'entity.too.large' })).code, 413);
    assert.equal(respond(Object.assign(new Error('x'), { name: 'SequelizeUniqueConstraintError' })).code, 409);
    assert.equal(respond(Object.assign(new Error('x'), { code: 'EBADCSRFTOKEN' })).code, 403);
    assert.equal(respond(Object.assign(new Error('big'), { name: 'MulterError', code: 'LIMIT_FILE_SIZE' })).body.error, 'File is too large (maximum 5 MB)');
    const crash = respond(new Error('boom'));
    assert.equal(crash.code, 500);
    assert.equal(crash.body.details, undefined);
  });
  test('toId accepts positive whole numbers only', () => {
    assert.equal(toId('12'), 12);
    for (const bad of ['0', '-1', 'abc', '']) throwsHttp(() => toId(bad), 400);
  });
});

// ---------------------------------------------------------------- scope
describe('scope (own / sub-vendor tables)', () => {
  test('maps entities to tables per scope', () => {
    assert.equal(tableFor('dailyLogs', 'own'), 'daily_logs');
    assert.equal(tableFor('dailyLogs', 'sv'), 'sub_vendor_daily_logs');
    assert.equal(tableFor('fuel', 'sv'), 'sub_vendor_fuel_logs');
    assert.equal(modelFor('vehicles', 'sv').name, 'SubVendorVehicles');
  });
  test('entities missing from a scope are a 404', () => {
    assert.equal(hasEntity('charges', 'own'), false);
    assert.equal(hasEntity('commitments', 'sv'), false);
    throwsHttp(() => tableFor('commitments', 'sv'), 404);
    throwsHttp(() => tableFor('vehicles', 'other'), 404);
    assert.throws(() => tableFor('nothing', 'own'), /Unknown entity/);
  });
});

// ---------------------------------------------------------------- CRUD entity rules
describe('CRUD entity rules (copied from the PHP pages)', () => {
  const def = (entity) => ENTITY_CONFIGS.find((d) => d.entity === entity);

  test('vehicle: fuel types stored as "Petrol,Diesel", no duplicates', () => {
    const v = def('vehicles');
    const body = v.fromBody({ 'fuel_type[]': ['Petrol', 'Diesel', 'Petrol'], reg_no: 'TN 01 A 1', make: 'TATA', model_year: '2022', type: 'ACE', fc_expiry: '2027-01-01', insurance_expiry: '2027-01-01', pollution_expiry: '2027-01-01' });
    assert.equal(parseBody(v.schema, body).fuel_type, 'Petrol,Diesel');
  });
  test('vehicle: tax info follows the status; max_km_per_day always 0', async () => {
    const v = def('vehicles');
    assert.equal((await v.prepare({ tax_status: '', tax_expiry: 'x', max_km_per_day: 9 })).tax_expiry, '');
    assert.equal((await v.prepare({ tax_status: 'No Tax End', tax_expiry: '' })).tax_expiry, 'No Tax End');
    assert.equal((await v.prepare({ tax_status: 'Other', tax_expiry: 'Paid' })).max_km_per_day, 0);
    await assert.rejects(async () => v.prepare({ tax_status: 'Other', tax_expiry: '' }), (e) => e.status === 400);
  });
  test('vehicle: year must be 4 digits', () => {
    const v = def('vehicles');
    throwsHttp(() => parseBody(v.schema, v.fromBody({ reg_no: 'A', make: 'B', model_year: '22', type: 'C', fc_expiry: '2027-01-01', insurance_expiry: '2027-01-01', pollution_expiry: '2027-01-01' })), 400);
  });
  test('maintenance: total = spares + labour, rounded', async () => {
    assert.equal((await def('maintenance').prepare({ cost_spares: 100.105, cost_labour: 200.2 })).total_cost, 300.31);
    assert.deepEqual(MAINTENANCE_TYPES, ['Engine Oil', 'General Service', 'FC Renewal', 'Insurance', 'Pollution', 'Tires', 'Repairs']);
  });
  test('drivers: soft delete, deleted drivers hidden from the list', () => {
    const d = def('drivers');
    assert.deepEqual(d.softDelete, { status: 'deleted' });
    assert.ok(d.list.where());
  });
  test('commitments: frequency choices and optional vehicle', () => {
    const c = def('commitments');
    const out = parseBody(c.schema, { name: 'EMI', amount: '1000', due_date: '', vehicle_id: '' });
    assert.deepEqual(out, { name: 'EMI', amount: 1000, frequency: 'monthly', due_date: null, vehicle_id: null });
    throwsHttp(() => parseBody(c.schema, { name: 'EMI', amount: '1', frequency: 'weekly' }), 400);
  });
  test('paged lists default to 10 rows', () => {
    for (const d of ENTITY_CONFIGS.filter((x) => x.list.pageSize)) assert.equal(d.list.pageSize, 10, d.entity);
  });
});

// ---------------------------------------------------------------- salaries
describe('salary row (salaries.php columns)', () => {
  const row = payrollRow({ id: 1, name: 'A', days_present: '24', days_absent: '3', daily_rate: '750', month_advance: '2000', total_paid: '10000', total_deduction: '500', prev_carry: '1500' });
  test('salary = days present × daily rate', () => assert.equal(row.salary, 18000));
  test('balances', () => {
    assert.equal(row.salary_balance, 8000);
    assert.equal(row.total_advance, 3500);
    assert.equal(row.advance_balance, 3000);
    assert.equal(row.total_days, 27);
  });
  test('empty figures are 0', () => {
    const empty = payrollRow({ id: 2, name: 'B' });
    assert.equal(empty.salary, 0);
    assert.equal(empty.advance_balance, 0);
    assert.equal(empty.advance_dates, '');
  });
});

// ---------------------------------------------------------------- dashboard periods
describe('dashboard period ranges', () => {
  test('this month vs last month', () => {
    const r = periodRange('month', '2026-10-03');
    assert.deepEqual([r.from, r.to, r.prevFrom, r.prevTo], ['2026-10-01', '2026-10-03', '2026-09-01', '2026-09-30']);
    assert.equal(r.label, 'Oct');
    assert.equal(r.prevLabel, 'Sep');
  });
  test('last month vs the month before', () => {
    const r = periodRange('last', '2026-03-15');
    assert.deepEqual([r.from, r.to, r.prevFrom, r.prevTo], ['2026-02-01', '2026-02-28', '2026-01-01', '2026-01-31']);
  });
  test('today vs yesterday, across a year end', () => {
    const r = periodRange('today', '2026-01-01');
    assert.deepEqual([r.from, r.to, r.prevFrom, r.prevTo], ['2026-01-01', '2026-01-01', '2025-12-31', '2025-12-31']);
  });
});

// ---------------------------------------------------------------- reports
describe('report helpers', () => {
  test('vehicle ids from ?vehicle_id (comma list or repeated), no duplicates', () => {
    assert.deepEqual(vehicleIds({ vehicle_id: '1,2,2,x,-3' }), [1, 2]);
    assert.deepEqual(vehicleIds({ vehicle_id: ['4', '5,6'] }), [4, 5, 6]);
    assert.deepEqual(vehicleIds({}), []);
    throwsHttp(() => vehicleIds({ vehicle_id: Array.from({ length: 201 }, (_, i) => i + 1).join(',') }), 400);
  });
});

// ---------------------------------------------------------------- quotations
describe('quotation HTML cleaning', () => {
  test('keeps formatting, removes scripts and event handlers', () => {
    const out = cleanHtml('<p onclick="x()">Hi <strong>there</strong><script>alert(1)</script><img src=x onerror=alert(1)></p>');
    assert.match(out, /<strong>there<\/strong>/);
    assert.doesNotMatch(out, /script|onclick|onerror/i);
  });
  test('javascript: links are removed', () => assert.doesNotMatch(cleanHtml('<a href="javascript:alert(1)">x</a>'), /javascript:/i));
  test('empty input', () => assert.equal(cleanHtml(null), ''));
});

