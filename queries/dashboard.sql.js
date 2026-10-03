// SQL copied from car-v1/dashboard.php. Own fleet only.

// Documents expiring between today and 30 days from now (tax_expiry is free text, so only
// date-like values match, exactly as in PHP). `id` added so the dashboard can link to the vehicle.
const EXPIRY_NOTIFICATIONS = `
  SELECT id, reg_no, 'FC' AS type, fc_expiry AS expiry_date FROM vehicles WHERE fc_expiry BETWEEN :today AND :nextMonth
  UNION
  SELECT id, reg_no, 'Insurance' AS type, insurance_expiry AS expiry_date FROM vehicles WHERE insurance_expiry BETWEEN :today AND :nextMonth
  UNION
  SELECT id, reg_no, 'Pollution' AS type, pollution_expiry AS expiry_date FROM vehicles WHERE pollution_expiry BETWEEN :today AND :nextMonth
  UNION
  SELECT id, reg_no, 'Tax' AS type, tax_expiry AS expiry_date FROM vehicles WHERE tax_expiry BETWEEN :today AND :nextMonth
  ORDER BY expiry_date ASC`;

const ACTIVE_DRIVERS = `SELECT COUNT(*) AS n FROM drivers WHERE status = 'active'`;
const TOTAL_VEHICLES = `SELECT COUNT(*) AS n FROM vehicles`;
const MONTH_PROFIT = `SELECT SUM(profit) AS n FROM daily_logs WHERE MONTH(date) = MONTH(:today) AND YEAR(date) = YEAR(:today)`;
const PRESENT_TODAY = `SELECT COUNT(*) AS n FROM attendance WHERE date = :today AND status = 'present'`;
const ABSENT_TODAY = `SELECT COUNT(*) AS n FROM attendance WHERE date = :today AND (status = 'absent' OR status = 'leave')`;

// "Vehicle Performance (Top Profits)": all-time totals, top 5 by profit.
const TOP_VEHICLES = `
  SELECT v.reg_no, SUM(d.income) AS total_income, SUM(d.diesel_cost + d.other_exp) AS total_exp, SUM(d.profit) AS total_profit
    FROM vehicles v
    LEFT JOIN daily_logs d ON v.id = d.vehicle_id
   GROUP BY v.id
   ORDER BY total_profit DESC
   LIMIT 5`;

// ---- Added with the UI redesign (not in dashboard.php); read-only ----------------------

// Profit trend: sum of daily_logs.profit per month (same figure as "Month Profit"), last 6 months.
const PROFIT_TREND = `
  SELECT DATE_FORMAT(date, '%Y-%m') AS ym, SUM(profit) AS n
    FROM daily_logs
   WHERE date BETWEEN :since AND :today
   GROUP BY DATE_FORMAT(date, '%Y-%m')
   ORDER BY ym`;

// Vehicles that ran yesterday (have a log for that date).
const RAN_YESTERDAY = `SELECT COUNT(DISTINCT vehicle_id) AS n FROM daily_logs WHERE date = :yesterday`;

// "Today's gaps": active vehicles with an active route but no log for yesterday ...
const MISSING_LOGS = `
  SELECT v.id, v.reg_no
    FROM vehicles v
   WHERE v.status = 'active'
     AND EXISTS (SELECT 1 FROM routes r WHERE r.vehicle_id = v.id AND r.status = 'active')
     AND NOT EXISTS (SELECT 1 FROM daily_logs d WHERE d.vehicle_id = v.id AND d.date = :yesterday)
   ORDER BY v.reg_no`;

// ... and active drivers with no attendance row for today (they count as absent when the day is saved).
const UNMARKED_DRIVERS = `
  SELECT d.id, d.name
    FROM drivers d
   WHERE d.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.driver_id = d.id AND a.date = :today)
   ORDER BY d.name`;

// Commitments (EMI, LIC ...) with a due date in the next 30 days, for "Needs attention".
const COMMITMENTS_DUE = `
  SELECT c.id, c.name, c.amount, c.due_date, c.vehicle_id, v.reg_no
    FROM commitments c
    LEFT JOIN vehicles v ON v.id = c.vehicle_id
   WHERE c.due_date BETWEEN :today AND :nextMonth
   ORDER BY c.due_date`;

// ---- Added with the gap review (period switch, comparisons, three-series trend) ----------

// Income / expense / profit from daily_logs for a date range (same columns as the PHP figures).
const PERIOD_TOTALS = `
  SELECT SUM(income) AS income, SUM(diesel_cost + other_exp) AS expense, SUM(profit) AS profit,
         COUNT(*) AS logs, SUM(closing_km - opening_km) AS km
    FROM daily_logs
   WHERE date BETWEEN :from AND :to`;

// Per-month income / expense / profit, last 6 months (replaces the profit-only series for the chart).
const MONEY_TREND = `
  SELECT DATE_FORMAT(date, '%Y-%m') AS ym, SUM(income) AS income, SUM(diesel_cost + other_exp) AS expense, SUM(profit) AS profit
    FROM daily_logs
   WHERE date BETWEEN :since AND :today
   GROUP BY DATE_FORMAT(date, '%Y-%m')
   ORDER BY ym`;

// Top 5 vehicles by profit inside the chosen period (the PHP list is all-time; kept as topVehicles).
const TOP_VEHICLES_PERIOD = `
  SELECT v.id, v.reg_no, SUM(d.income) AS total_income, SUM(d.diesel_cost + d.other_exp) AS total_exp,
         SUM(d.profit) AS total_profit, SUM(d.closing_km - d.opening_km) AS km
    FROM daily_logs d
    JOIN vehicles v ON v.id = d.vehicle_id
   WHERE d.date BETWEEN :from AND :to
   GROUP BY v.id, v.reg_no
   ORDER BY total_profit DESC, km DESC
   LIMIT 5`;

// Vehicles with an active route ("on routes" under Total Vehicles).
const ON_ROUTES = `SELECT COUNT(DISTINCT vehicle_id) AS n FROM routes WHERE status = 'active'`;

module.exports = {
  PERIOD_TOTALS,
  MONEY_TREND,
  TOP_VEHICLES_PERIOD,
  ON_ROUTES,
  EXPIRY_NOTIFICATIONS,
  ACTIVE_DRIVERS,
  TOTAL_VEHICLES,
  MONTH_PROFIT,
  PRESENT_TODAY,
  ABSENT_TODAY,
  TOP_VEHICLES,
  PROFIT_TREND,
  RAN_YESTERDAY,
  MISSING_LOGS,
  UNMARKED_DRIVERS,
  COMMITMENTS_DUE,
};
