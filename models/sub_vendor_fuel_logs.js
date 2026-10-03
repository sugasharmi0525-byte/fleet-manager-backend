const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('SubVendorFuelLogs', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    vehicle_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    fuel_type: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    km_reading: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0
    },
    liters: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: true,
      defaultValue: 0.00
    },
    amount: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: true,
      defaultValue: 0.00
    },
    km_run: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0
    },
    mileage: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: true,
      defaultValue: 0.00
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP')
    }
  }, {
    sequelize,
    tableName: 'sub_vendor_fuel_logs',
    timestamps: false,
    freezeTableName: true
  });
};
