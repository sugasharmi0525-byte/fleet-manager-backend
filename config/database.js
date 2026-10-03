const fs = require('fs');
const { Sequelize } = require('sequelize');
const env = require('./env');
const { logger } = require('./logger');

// TLS options for a remote MySQL server (DB_SSL=true). Shared with the session store.
function sslOptions() {
  if (!env.DB_SSL) return undefined;
  return env.DB_SSL_CA
    ? { ca: fs.readFileSync(env.DB_SSL_CA, 'utf8'), rejectUnauthorized: true }
    : { rejectUnauthorized: true };
}

const sequelize = new Sequelize(env.DB_NAME, env.DB_USER, env.DB_PASS, {
  host: env.DB_HOST,
  port: env.DB_PORT,
  dialect: 'mysql',
  timezone: '+05:30',
  logging: env.isDev ? (sql) => logger.debug(sql, { source: 'sequelize' }) : false,
  pool: { max: 10, min: 0, acquire: 30000, idle: 10000 },
  dialectOptions: {
    // Keep DATE/DATETIME as plain strings (no timezone shifting) and DECIMAL as numbers.
    dateStrings: true,
    typeCast: true,
    decimalNumbers: true,
    ssl: sslOptions(),
  },
  define: {
    timestamps: false,
    freezeTableName: true,
  },
});

module.exports = { sequelize, sslOptions };
