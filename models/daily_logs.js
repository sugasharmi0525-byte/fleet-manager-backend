const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('DailyLogs', {
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
    driver_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'drivers',
        key: 'id'
      }
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    opening_km: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    closing_km: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    total_km: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    diesel_liters: {
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
    income: {
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
    profit: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: true
    }
  }, {
    sequelize,
    tableName: 'daily_logs',
    timestamps: false,
    freezeTableName: true
  });
};
