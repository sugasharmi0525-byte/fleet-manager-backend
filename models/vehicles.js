const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('Vehicles', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    reg_no: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: "reg_no"
    },
    make: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    model_year: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    type: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    deck: {
      type: DataTypes.ENUM('open','closed'),
      allowNull: true,
      defaultValue: "open"
    },
    fc_expiry: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    insurance_expiry: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    pollution_expiry: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    tax_expiry: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    current_km: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0
    },
    oil_change_km: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0
    },
    status: {
      type: DataTypes.ENUM('active','maintenance','inactive'),
      allowNull: true,
      defaultValue: "active"
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP')
    },
    fine_amount: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: true,
      defaultValue: 0.00
    },
    tax_status: {
      type: DataTypes.STRING(100),
      allowNull: true,
      defaultValue: ""
    },
    car_value: {
      type: DataTypes.DECIMAL(15,2),
      allowNull: true,
      defaultValue: 0.00
    },
    max_km_per_day: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 50
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
    fuel_type: {
      type: DataTypes.STRING(50),
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
    }
  }, {
    sequelize,
    tableName: 'vehicles',
    timestamps: false,
    freezeTableName: true
  });
};
