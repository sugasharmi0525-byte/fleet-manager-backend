var DataTypes = require("sequelize").DataTypes;
var _AppSettings = require("./app_settings");
var _Attendance = require("./attendance");
var _Commitments = require("./commitments");
var _DailyLogs = require("./daily_logs");
var _DriverRateHistory = require("./driver_rate_history");
var _Drivers = require("./drivers");
var _FuelLogs = require("./fuel_logs");
var _Maintenance = require("./maintenance");
var _ManualIncomes = require("./manual_incomes");
var _QuoteData = require("./quote_data");
var _QuoteSettings = require("./quote_settings");
var _Routes = require("./routes");
var _Salaries = require("./salaries");
var _SalaryTransactions = require("./salary_transactions");
var _SubVendorAttendance = require("./sub_vendor_attendance");
var _SubVendorCharges = require("./sub_vendor_charges");
var _SubVendorDailyLogs = require("./sub_vendor_daily_logs");
var _SubVendorDriverRateHistory = require("./sub_vendor_driver_rate_history");
var _SubVendorDrivers = require("./sub_vendor_drivers");
var _SubVendorFuelLogs = require("./sub_vendor_fuel_logs");
var _SubVendorMaintenance = require("./sub_vendor_maintenance");
var _SubVendorRoutes = require("./sub_vendor_routes");
var _SubVendorSalaryTransactions = require("./sub_vendor_salary_transactions");
var _SubVendorVehicles = require("./sub_vendor_vehicles");
var _Vehicles = require("./vehicles");

function initModels(sequelize) {
  var AppSettings = _AppSettings(sequelize, DataTypes);
  var Attendance = _Attendance(sequelize, DataTypes);
  var Commitments = _Commitments(sequelize, DataTypes);
  var DailyLogs = _DailyLogs(sequelize, DataTypes);
  var DriverRateHistory = _DriverRateHistory(sequelize, DataTypes);
  var Drivers = _Drivers(sequelize, DataTypes);
  var FuelLogs = _FuelLogs(sequelize, DataTypes);
  var Maintenance = _Maintenance(sequelize, DataTypes);
  var ManualIncomes = _ManualIncomes(sequelize, DataTypes);
  var QuoteData = _QuoteData(sequelize, DataTypes);
  var QuoteSettings = _QuoteSettings(sequelize, DataTypes);
  var Routes = _Routes(sequelize, DataTypes);
  var Salaries = _Salaries(sequelize, DataTypes);
  var SalaryTransactions = _SalaryTransactions(sequelize, DataTypes);
  var SubVendorAttendance = _SubVendorAttendance(sequelize, DataTypes);
  var SubVendorCharges = _SubVendorCharges(sequelize, DataTypes);
  var SubVendorDailyLogs = _SubVendorDailyLogs(sequelize, DataTypes);
  var SubVendorDriverRateHistory = _SubVendorDriverRateHistory(sequelize, DataTypes);
  var SubVendorDrivers = _SubVendorDrivers(sequelize, DataTypes);
  var SubVendorFuelLogs = _SubVendorFuelLogs(sequelize, DataTypes);
  var SubVendorMaintenance = _SubVendorMaintenance(sequelize, DataTypes);
  var SubVendorRoutes = _SubVendorRoutes(sequelize, DataTypes);
  var SubVendorSalaryTransactions = _SubVendorSalaryTransactions(sequelize, DataTypes);
  var SubVendorVehicles = _SubVendorVehicles(sequelize, DataTypes);
  var Vehicles = _Vehicles(sequelize, DataTypes);

  Attendance.belongsTo(Drivers, { as: "driver", foreignKey: "driver_id"});
  Drivers.hasMany(Attendance, { as: "attendances", foreignKey: "driver_id"});
  DailyLogs.belongsTo(Drivers, { as: "driver", foreignKey: "driver_id"});
  Drivers.hasMany(DailyLogs, { as: "daily_logs", foreignKey: "driver_id"});
  Routes.belongsTo(Drivers, { as: "driver", foreignKey: "driver_id"});
  Drivers.hasMany(Routes, { as: "routes", foreignKey: "driver_id"});
  Salaries.belongsTo(Drivers, { as: "driver", foreignKey: "driver_id"});
  Drivers.hasMany(Salaries, { as: "salaries", foreignKey: "driver_id"});
  SalaryTransactions.belongsTo(Drivers, { as: "driver", foreignKey: "driver_id"});
  Drivers.hasMany(SalaryTransactions, { as: "salary_transactions", foreignKey: "driver_id"});
  Commitments.belongsTo(Vehicles, { as: "vehicle", foreignKey: "vehicle_id"});
  Vehicles.hasMany(Commitments, { as: "commitments", foreignKey: "vehicle_id"});
  DailyLogs.belongsTo(Vehicles, { as: "vehicle", foreignKey: "vehicle_id"});
  Vehicles.hasMany(DailyLogs, { as: "daily_logs", foreignKey: "vehicle_id"});
  FuelLogs.belongsTo(Vehicles, { as: "vehicle", foreignKey: "vehicle_id"});
  Vehicles.hasMany(FuelLogs, { as: "fuel_logs", foreignKey: "vehicle_id"});
  Maintenance.belongsTo(Vehicles, { as: "vehicle", foreignKey: "vehicle_id"});
  Vehicles.hasMany(Maintenance, { as: "maintenances", foreignKey: "vehicle_id"});
  ManualIncomes.belongsTo(Vehicles, { as: "vehicle", foreignKey: "vehicle_id"});
  Vehicles.hasMany(ManualIncomes, { as: "manual_incomes", foreignKey: "vehicle_id"});
  Routes.belongsTo(Vehicles, { as: "vehicle", foreignKey: "vehicle_id"});
  Vehicles.hasMany(Routes, { as: "routes", foreignKey: "vehicle_id"});

  return {
    AppSettings,
    Attendance,
    Commitments,
    DailyLogs,
    DriverRateHistory,
    Drivers,
    FuelLogs,
    Maintenance,
    ManualIncomes,
    QuoteData,
    QuoteSettings,
    Routes,
    Salaries,
    SalaryTransactions,
    SubVendorAttendance,
    SubVendorCharges,
    SubVendorDailyLogs,
    SubVendorDriverRateHistory,
    SubVendorDrivers,
    SubVendorFuelLogs,
    SubVendorMaintenance,
    SubVendorRoutes,
    SubVendorSalaryTransactions,
    SubVendorVehicles,
    Vehicles,
  };
}
module.exports = initModels;
module.exports.initModels = initModels;
module.exports.default = initModels;
