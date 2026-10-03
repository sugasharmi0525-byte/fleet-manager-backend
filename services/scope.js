/*
 * Own fleet and sub-vendors use parallel tables. Every service asks this module for the
 * model (Sequelize) or table name (raw SQL) of an entity in a scope, so one code path
 * serves both /api/own/... and /api/sv/...
 */
const { models } = require('../models');
const { HttpError } = require('../middleware/errorHandler');

const SCOPES = ['own', 'sv'];

// entity -> { own: [modelName, tableName], sv: [modelName, tableName] }
const ENTITIES = {
  vehicles: { own: ['Vehicles', 'vehicles'], sv: ['SubVendorVehicles', 'sub_vendor_vehicles'] },
  drivers: { own: ['Drivers', 'drivers'], sv: ['SubVendorDrivers', 'sub_vendor_drivers'] },
  driverRates: {
    own: ['DriverRateHistory', 'driver_rate_history'],
    sv: ['SubVendorDriverRateHistory', 'sub_vendor_driver_rate_history'],
  },
  attendance: { own: ['Attendance', 'attendance'], sv: ['SubVendorAttendance', 'sub_vendor_attendance'] },
  routes: { own: ['Routes', 'routes'], sv: ['SubVendorRoutes', 'sub_vendor_routes'] },
  dailyLogs: { own: ['DailyLogs', 'daily_logs'], sv: ['SubVendorDailyLogs', 'sub_vendor_daily_logs'] },
  fuel: { own: ['FuelLogs', 'fuel_logs'], sv: ['SubVendorFuelLogs', 'sub_vendor_fuel_logs'] },
  maintenance: { own: ['Maintenance', 'maintenance'], sv: ['SubVendorMaintenance', 'sub_vendor_maintenance'] },
  salaryTransactions: {
    own: ['SalaryTransactions', 'salary_transactions'],
    sv: ['SubVendorSalaryTransactions', 'sub_vendor_salary_transactions'],
  },
  charges: { sv: ['SubVendorCharges', 'sub_vendor_charges'] },
  commitments: { own: ['Commitments', 'commitments'] },
  manualIncomes: { own: ['ManualIncomes', 'manual_incomes'] },
};

function entry(entity, scope) {
  if (!SCOPES.includes(scope)) throw new HttpError(404, `Unknown scope: ${scope}`);
  const def = ENTITIES[entity];
  if (!def) throw new Error(`Unknown entity: ${entity}`);
  const pair = def[scope];
  if (!pair) throw new HttpError(404, `${entity} is not available for scope "${scope}"`);
  return pair;
}

/** Sequelize model for an entity in a scope, e.g. modelFor('vehicles', 'sv'). */
function modelFor(entity, scope) {
  return models[entry(entity, scope)[0]];
}

/** Table name for raw SQL, e.g. tableFor('dailyLogs', 'own') -> 'daily_logs'. */
function tableFor(entity, scope) {
  return entry(entity, scope)[1];
}

/** True when the entity exists in the scope (e.g. charges only in 'sv'). */
function hasEntity(entity, scope) {
  return Boolean(ENTITIES[entity]?.[scope]);
}

module.exports = { SCOPES, ENTITIES, modelFor, tableFor, hasEntity };
