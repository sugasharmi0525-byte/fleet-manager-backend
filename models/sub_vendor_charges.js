const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('SubVendorCharges', {
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
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    awb_number: {
      type: DataTypes.STRING(100),
      allowNull: true,
      defaultValue: ""
    },
    mbox_number: {
      type: DataTypes.STRING(100),
      allowNull: true,
      defaultValue: ""
    },
    loading_charge: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: false,
      defaultValue: 0.00
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP')
    }
  }, {
    sequelize,
    tableName: 'sub_vendor_charges',
    timestamps: false,
    freezeTableName: true
  });
};
