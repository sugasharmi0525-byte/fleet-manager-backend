const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('Routes', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    route_name: {
      type: DataTypes.STRING(100),
      allowNull: false
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
    max_km: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 50
    },
    status: {
      type: DataTypes.ENUM('active','inactive'),
      allowNull: true,
      defaultValue: "active"
    },
    extra_km_rate: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: true,
      defaultValue: 0.00
    }
  }, {
    sequelize,
    tableName: 'routes',
    timestamps: false,
    freezeTableName: true
  });
};
