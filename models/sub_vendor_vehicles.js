const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('SubVendorVehicles', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    reg_no: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    make: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    model_year: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    type: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    fuel_type: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: ""
    },
    deck: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    fc_expiry: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    insurance_expiry: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    pollution_expiry: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    tax_expiry: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    tax_status: {
      type: DataTypes.STRING(100),
      allowNull: true,
      defaultValue: ""
    },
    fine_amount: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: true,
      defaultValue: 0.00
    },
    car_value: {
      type: DataTypes.DECIMAL(15,2),
      allowNull: true,
      defaultValue: 0.00
    },
    max_km_per_day: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0
    },
    fc_pdf: {
      type: DataTypes.STRING(255),
      allowNull: true,
      defaultValue: ""
    },
    ins_pdf: {
      type: DataTypes.STRING(255),
      allowNull: true,
      defaultValue: ""
    },
    pol_pdf: {
      type: DataTypes.STRING(255),
      allowNull: true,
      defaultValue: ""
    },
    petrol_price: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: true,
      defaultValue: 0.00
    },
    diesel_price: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: true,
      defaultValue: 0.00
    },
    cng_price: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: true,
      defaultValue: 0.00
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP')
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: "active"
    },
    current_km: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0
    }
  }, {
    sequelize,
    tableName: 'sub_vendor_vehicles',
    timestamps: false,
    freezeTableName: true
  });
};
