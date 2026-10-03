// SQL copied from car-v1/reports.php, monthly_reports.php, fuel_report.php and maintenance_report.php
// (sv_reports.php / sv_monthly_reports.php only swap table names and add loading charges).
// `t` holds the scope's table names; `inList(n)` is "?, ?, ..." for an IN (...) list.

const inList = (n) => Array(n).fill('?').join(',');

// ---- Vehicle lists
/** Filter options on the financial and maintenance reports: active vehicles. */
const activeVehicles = (t) => `SELECT id, reg_no FROM ${t.vehicles} WHERE status = 'active'`;
/** Monthly report options, and the vehicles both reports process when none is chosen. */
const reportVehicles = (t) => `SELECT id, reg_no FROM ${t.vehicles} WHERE status IN ('active', '${t.maintenanceStatus}')`;
const vehiclesById = (t, n) => `SELECT id, reg_no FROM ${t.vehicles} WHERE id IN (${inList(n)})`;
/** Monthly report: the processed list is filtered by status even when vehicles are chosen. */
const reportVehiclesById = (t, n) => `${reportVehicles(t)} AND id IN (${inList(n)})`;
const activeDrivers = (t) => `SELECT id, name FROM ${t.drivers} WHERE status = 'active'`;

// ---- Financial and monthly report, per vehicle (vehicle_id, from, to [, driver_id])
const logStats = (t, withDriver) =>
  `SELECT COUNT(DISTINCT date) as days, SUM(closing_km - opening_km) as kms, SUM(other_exp) as other, SUM(extra_km_cost) as extra, SUM(income) as db_income FROM ${t.dailyLogs} WHERE vehicle_id = ? AND date BETWEEN ? AND ? ${withDriver ? 'AND driver_id = ?' : ''}`;
const fuelCost = (t) => `SELECT SUM(amount) AS n FROM ${t.fuel} WHERE vehicle_id = ? AND date BETWEEN ? AND ?`;
const maintenanceCost = (t) => `SELECT SUM(total_cost) AS n FROM ${t.maintenance} WHERE vehicle_id = ? AND service_date BETWEEN ? AND ?`;
/** Driver salary = current daily rate of whoever drove, once per log (not the rate history). */
const driverSalary = (t, withDriver) => `
        SELECT SUM(dr.daily_rate) AS n
        FROM ${t.dailyLogs} dl
        JOIN ${t.drivers} dr ON dl.driver_id = dr.id
        WHERE dl.vehicle_id = ? AND dl.date BETWEEN ? AND ? ${withDriver ? 'AND dl.driver_id = ?' : ''}`;
// Commitments and manual incomes are own-fleet tables; the sub-vendor reports read them too, by vehicle id.
const commitmentCost = () => `SELECT SUM(amount) AS n FROM commitments WHERE vehicle_id = ? AND (frequency = 'monthly' OR (due_date BETWEEN ? AND ?))`;
const manualIncomeSum = () => `SELECT SUM(amount) AS n FROM manual_incomes WHERE vehicle_id = ? AND date BETWEEN ? AND ?`;
/** Monthly report: only the first manual income of the month is used. */
const manualIncomeFirst = () => `SELECT * FROM manual_incomes WHERE vehicle_id = ? AND date BETWEEN ? AND ? LIMIT 1`;
const loadingCharges = () => `SELECT COALESCE(SUM(loading_charge), 0) AS n FROM sub_vendor_charges WHERE vehicle_id = ? AND date BETWEEN ? AND ?`;
/** Monthly report "View KM" day list. */
const kmBreakdown = (t) =>
  `SELECT date, opening_km, closing_km, (closing_km - opening_km) as total_km FROM ${t.dailyLogs} WHERE vehicle_id = ? AND date BETWEEN ? AND ? ORDER BY date ASC`;

// ---- Fuel report (own fleet)
const fuelVehicleOptions = () => `SELECT id, reg_no FROM vehicles WHERE id IN (SELECT vehicle_id FROM fuel_logs)`;
const fuelVehiclesById = (n) => `SELECT id, reg_no, fuel_type FROM vehicles WHERE id IN (${inList(n)})`;
const fuelVehiclesAll = () => `SELECT id, reg_no, fuel_type FROM vehicles WHERE id IN (SELECT vehicle_id FROM fuel_logs)`;
const fuelLogs = () => `SELECT * FROM fuel_logs WHERE vehicle_id = ? AND date BETWEEN ? AND ? ORDER BY date ASC, km_reading ASC`;
const fuelConsolidated = (n) => `
        SELECT fl.date, v.reg_no, fl.amount
        FROM fuel_logs fl
        JOIN vehicles v ON fl.vehicle_id = v.id
        WHERE fl.date BETWEEN ? AND ? ${n ? `AND fl.vehicle_id IN (${inList(n)})` : ''}
        ORDER BY fl.date ASC, v.reg_no ASC`;

// ---- Maintenance report (own fleet)
const maintenanceVehiclesInPeriod = () =>
  `SELECT DISTINCT v.id, v.reg_no FROM vehicles v JOIN maintenance m ON v.id = m.vehicle_id WHERE m.service_date BETWEEN ? AND ?`;
const maintenanceLogs = () => `SELECT * FROM maintenance WHERE vehicle_id = ? AND service_date BETWEEN ? AND ? ORDER BY service_date ASC`;

module.exports = {
  activeVehicles,
  reportVehicles,
  vehiclesById,
  reportVehiclesById,
  activeDrivers,
  logStats,
  fuelCost,
  maintenanceCost,
  driverSalary,
  commitmentCost,
  manualIncomeSum,
  manualIncomeFirst,
  loadingCharges,
  kmBreakdown,
  fuelVehicleOptions,
  fuelVehiclesById,
  fuelVehiclesAll,
  fuelLogs,
  fuelConsolidated,
  maintenanceVehiclesInPeriod,
  maintenanceLogs,
};
