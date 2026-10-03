/*
 * Creates the development database (DB_NAME in .env) from a phpMyAdmin SQL dump.
 *
 *   npm run db:create-dev -w server                      # default dump, fails if the DB exists
 *   npm run db:create-dev -w server -- --force           # drop and recreate
 *   npm run db:create-dev -w server -- --dump <file.sql> # use another dump
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const env = require('../config/env');

const DEFAULT_DUMP = path.resolve(__dirname, '../../../car-v1/car-v1/car_tracking (1).sql');

function parseArgs(argv) {
  const args = { force: false, dump: DEFAULT_DUMP };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--force') args.force = true;
    else if (argv[i] === '--dump') args.dump = path.resolve(argv[(i += 1)]);
  }
  return args;
}

async function main() {
  const { force, dump } = parseArgs(process.argv.slice(2));
  const dbName = env.DB_NAME;

  if (!/^[A-Za-z0-9_]+$/.test(dbName)) throw new Error(`Unsafe DB_NAME: ${dbName}`);
  if (env.isProd) throw new Error('Refusing to run with NODE_ENV=production');
  if (!fs.existsSync(dump)) throw new Error(`Dump not found: ${dump}`);

  const conn = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASS,
    multipleStatements: true,
  });

  try {
    const [existing] = await conn.query('SHOW DATABASES LIKE ?', [dbName]);
    if (existing.length && !force) {
      console.log(`Database ${dbName} already exists. Re-run with --force to drop and recreate it.`);
      return;
    }

    console.log(`Creating ${dbName} from ${path.basename(dump)} ...`);
    await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await conn.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.changeUser({ database: dbName });

    const sql = fs.readFileSync(dump, 'utf8');
    await conn.query(sql);

    const [tables] = await conn.query(
      `SELECT table_name AS name, table_rows AS approxRows
         FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name`,
      [dbName]
    );
    console.log(`Imported ${tables.length} tables:`);
    for (const t of tables) console.log(`  ${t.name.padEnd(34)} ~${t.approxRows} rows`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(`Failed: ${err.message}`);
  process.exit(1);
});
