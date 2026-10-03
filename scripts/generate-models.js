/*
 * Regenerates server/models from the database in .env (DB_NAME).
 *
 *   npm run db:generate-models -w server
 *
 * The files in models/ (except index.js) are generated: don't edit them by hand.
 * Associations missing from the database and other fixes live in models/index.js.
 */
const path = require('path');
const SequelizeAuto = require('sequelize-auto');
const env = require('../config/env');

const auto = new SequelizeAuto(env.DB_NAME, env.DB_USER, env.DB_PASS, {
  host: env.DB_HOST,
  port: env.DB_PORT,
  dialect: 'mysql',
  directory: path.join(__dirname, '..', 'models'),
  lang: 'js',
  caseModel: 'p', // PascalCase model names, e.g. SubVendorVehicles
  caseProp: 'o', // keep column names as they are (snake_case)
  caseFile: 'o', // file names = table names
  skipTables: ['sessions'], // owned by express-mysql-session
  noIndexes: true, // schema is never synced, so index definitions are not needed
  additional: {
    timestamps: false, // keep created_at as a normal column; tables have no updatedAt
    freezeTableName: true,
  },
  logging: false,
});

auto
  .run()
  .then((data) => {
    console.log(`Generated ${Object.keys(data.tables).length} models in server/models`);
  })
  .catch((err) => {
    console.error(`Failed: ${err.message}`);
    process.exit(1);
  });
