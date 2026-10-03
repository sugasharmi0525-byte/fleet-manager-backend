const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('FuelLogs', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    vehicle_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'vehicles',
        key: 'id'
      }
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    km_reading: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    liters: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: false
    },
    amount: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: false
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
    fuel_type: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: "Diesel"
    }
  }, {
    sequelize,
    tableName: 'fuel_logs',
    timestamps: false,
    freezeTableName: true
  });
};
