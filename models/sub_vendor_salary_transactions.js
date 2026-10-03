const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('SubVendorSalaryTransactions', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    driver_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    type: {
      type: DataTypes.ENUM('advance','payment','deduction','carry_forward','monthly_salary','weekly_salary'),
      allowNull: false
    },
    amount: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: false
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    recorded_by: {
      type: DataTypes.STRING(100),
      allowNull: true,
      defaultValue: "Admin"
    },
    payment_date: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    month: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    year: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP')
    }
  }, {
    sequelize,
    tableName: 'sub_vendor_salary_transactions',
    timestamps: false,
    freezeTableName: true
  });
};
