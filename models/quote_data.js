const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('QuoteData', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    quote_number: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    quote_date: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    effective_date: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    to_name: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    to_address: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    to_gst: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    to_phone: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP')
    }
  }, {
    sequelize,
    tableName: 'quote_data',
    timestamps: false,
    freezeTableName: true
  });
};
