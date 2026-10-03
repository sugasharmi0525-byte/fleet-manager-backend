const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('Commitments', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    amount: {
      type: DataTypes.DECIMAL(10,2),
      allowNull: false
    },
    frequency: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: "monthly"
    },
    due_date: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    vehicle_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'vehicles',
        key: 'id'
      }
    }
  }, {
    sequelize,
    tableName: 'commitments',
    timestamps: false,
    freezeTableName: true
  });
};
