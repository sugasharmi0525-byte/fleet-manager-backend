const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('SalaryTransactions', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    driver_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'drivers',
        key: 'id'
      }
    },
    type: {
      type: DataTypes.ENUM('advance','payment','deduction','carry_forward','monthly_salary','weekly_salary'),
      allowNull: false
    },
    amount: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: false,
      defaultValue: 0.00
    },
    note: {
      type: DataTypes.STRING(255),
      allowNull: true,
      defaultValue: ""
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
      allowNull: true,
      defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP')
    }
  }, {
    sequelize,
    tableName: 'salary_transactions',
    timestamps: false,
    freezeTableName: true
  });
};
