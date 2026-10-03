const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('SubVendorDailyLogs', {
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
    driver_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    opening_km: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0
    },
    closing_km: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0
    },
    income: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: true,
      defaultValue: 0.00
    },
    diesel_cost: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: true,
      defaultValue: 0.00
    },
    other_exp: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: true,
      defaultValue: 0.00
    },
    extra_km: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0
    },
    extra_km_cost: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: true,
      defaultValue: 0.00
    },
    awb_number: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    vehicle_number: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    on_load_charges: {
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
    tableName: 'sub_vendor_daily_logs',
    timestamps: false,
    freezeTableName: true
  });
};
