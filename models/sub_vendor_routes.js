const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('SubVendorRoutes', {
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
      allowNull: true
    },
    driver_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    max_km: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0
    },
    extra_km_rate: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: true,
      defaultValue: 0.00
    },
    status: {
      type: DataTypes.ENUM('active','inactive'),
      allowNull: true,
      defaultValue: "active"
    }
  }, {
    sequelize,
    tableName: 'sub_vendor_routes',
    timestamps: false,
    freezeTableName: true
  });
};
