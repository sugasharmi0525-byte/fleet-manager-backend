// SQL copied from car-v1/salaries.php (sv_salaries.php only swaps the table names).
// `t` holds the scope's table names: { drivers, rates, attendance, trans }.

/** Active drivers matching the search, for paging (PHP `$count_stmt`). */
const countDrivers = (t, withSearch) => `SELECT COUNT(*) AS n FROM ${t.drivers} d WHERE d.status = 'active' ${withSearch ? 'AND d.name LIKE ?' : ''}`;

/**
 * Main payroll query with its 18 placeholders, in this order:
 *   year, month (rate history) · month, year ×7 (present, absent, advance sum, advance dates,
 *   paid, deduction sum, deduction dates) · prev_month, prev_year (PREV ADV) · [search]
 * `limit` and `offset` are validated integers, interpolated as in PHP.
 */
const payroll = (t, { withSearch, limit, offset }) => `
    SELECT d.id, d.name,
           COALESCE((SELECT daily_rate FROM ${t.rates} WHERE driver_id = d.id AND effective_date <= LAST_DAY(STR_TO_DATE(CONCAT(?, '-', LPAD(?, 2, '0'), '-01'), '%Y-%m-%d')) ORDER BY effective_date DESC LIMIT 1), d.daily_rate) as daily_rate,
           (SELECT COUNT(*) FROM ${t.attendance} a WHERE a.driver_id = d.id AND MONTH(a.date) = ? AND YEAR(a.date) = ? AND a.status = 'present') as days_present,
           (SELECT COUNT(*) FROM ${t.attendance} a WHERE a.driver_id = d.id AND MONTH(a.date) = ? AND YEAR(a.date) = ? AND a.status = 'absent') as days_absent,
           (SELECT COALESCE(SUM(t.amount),0) FROM ${t.trans} t WHERE t.driver_id = d.id AND t.month = ? AND t.year = ? AND t.type = 'advance') as month_advance,
           (SELECT GROUP_CONCAT(DISTINCT DATE_FORMAT(COALESCE(t.payment_date, t.created_at), '%d %b') ORDER BY COALESCE(t.payment_date, t.created_at) ASC SEPARATOR ', ') FROM ${t.trans} t WHERE t.driver_id = d.id AND t.month = ? AND t.year = ? AND t.type = 'advance') as advance_dates,
           (SELECT COALESCE(SUM(t.amount),0) FROM ${t.trans} t WHERE t.driver_id = d.id AND t.month = ? AND t.year = ? AND t.type IN ('payment', 'monthly_salary', 'weekly_salary')) as total_paid,
           (SELECT COALESCE(SUM(t.amount),0) FROM ${t.trans} t WHERE t.driver_id = d.id AND t.month = ? AND t.year = ? AND t.type = 'deduction') as total_deduction,
           (SELECT GROUP_CONCAT(DISTINCT DATE_FORMAT(COALESCE(t.payment_date, t.created_at), '%d %b') ORDER BY COALESCE(t.payment_date, t.created_at) ASC SEPARATOR ', ') FROM ${t.trans} t WHERE t.driver_id = d.id AND t.month = ? AND t.year = ? AND t.type = 'deduction') as deduction_dates,
           (SELECT COALESCE(SUM(CASE WHEN t2.type = 'advance' THEN t2.amount ELSE 0 END),0)
                   + COALESCE(SUM(CASE WHEN t2.type = 'carry_forward' THEN t2.amount ELSE 0 END),0)
                   - COALESCE(SUM(CASE WHEN t2.type = 'deduction' THEN t2.amount ELSE 0 END),0)
            FROM ${t.trans} t2 WHERE t2.driver_id = d.id AND t2.month = ? AND t2.year = ?) as prev_carry
    FROM ${t.drivers} d
    WHERE d.status = 'active' ${withSearch ? 'AND d.name LIKE ?' : ''}
    ORDER BY d.name ASC
    LIMIT ${limit} OFFSET ${offset}`;

/** Payment modal stats (PHP `get_driver_stats`). Note: days_absent here counts every non-present status, leave included. */
const driverRate = (t) =>
  `SELECT COALESCE((SELECT daily_rate FROM ${t.rates} WHERE driver_id = ? AND effective_date <= LAST_DAY(STR_TO_DATE(CONCAT(?, '-', LPAD(?, 2, '0'), '-01'), '%Y-%m-%d')) ORDER BY effective_date DESC LIMIT 1), (SELECT daily_rate FROM ${t.drivers} WHERE id = ?)) AS rate`;

const driverAttendance = (t) => `SELECT
        SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as days_present,
        SUM(CASE WHEN status != 'present' THEN 1 ELSE 0 END) as days_absent
        FROM ${t.attendance} WHERE driver_id = ? AND MONTH(date) = ? AND YEAR(date) = ?`;

const driverMonthTransactions = (t) => `SELECT type, amount FROM ${t.trans} WHERE driver_id = ? AND month = ? AND year = ?`;

/** Payment modal history (PHP `get_history`), with or without a month. */
const driverHistory = (t, withMonth) =>
  `SELECT id, driver_id, type, amount, note, payment_date, created_at, recorded_by, month, year FROM ${t.trans} WHERE driver_id = ? ${withMonth ? 'AND month = ? AND year = ?' : ''} ORDER BY created_at DESC`;

/** "Transaction History for <Month Year>" below the payroll table. */
const monthTransactions = (t) =>
  `SELECT t.*, d.name as driver_name FROM ${t.trans} t JOIN ${t.drivers} d ON t.driver_id=d.id WHERE t.month = ? AND t.year = ? ORDER BY t.created_at DESC`;

module.exports = { countDrivers, payroll, driverRate, driverAttendance, driverMonthTransactions, driverHistory, monthTransactions };
