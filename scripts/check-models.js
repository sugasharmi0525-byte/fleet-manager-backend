/*
 * Phase 3 check: every model reads its table, associations load for both scopes, and the
 * generated columns of daily_logs can't be written. Writes run in a rolled-back transaction.
 *
 *   npm run db:check-models -w server
 */
const { sequelize, models } = require('../models');
const { ENTITIES, modelFor, tableFor } = require('../services/scope');

let failures = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const fail = (msg) => {
  failures += 1;
  console.log(`  FAIL  ${msg}`);
};

async function checkCounts() {
  console.log('\n1. Row counts (model vs raw SQL)');
  for (const [name, model] of Object.entries(models)) {
    const viaModel = await model.count();
    const [[{ n }]] = await sequelize.query(`SELECT COUNT(*) AS n FROM \`${model.getTableName()}\``);
    if (viaModel === Number(n)) ok(`${name.padEnd(30)} ${viaModel}`);
    else fail(`${name}: model ${viaModel} vs raw ${n}`);
  }
}

async function checkFindAll() {
  console.log('\n2. Read one row from every model (catches column mismatches)');
  for (const [name, model] of Object.entries(models)) {
    try {
      await model.findOne();
      ok(name);
    } catch (err) {
      fail(`${name}: ${err.message}`);
    }
  }
}

async function checkScopes() {
  console.log('\n3. Scope map and associations');
  const includeFor = { dailyLogs: ['vehicle', 'driver'], routes: ['vehicle', 'driver'], fuel: ['vehicle'],
    maintenance: ['vehicle'], attendance: ['driver'], salaryTransactions: ['driver'], driverRates: ['driver'],
    charges: ['vehicle'], commitments: ['vehicle'], manualIncomes: ['vehicle'] };

  for (const [entity, def] of Object.entries(ENTITIES)) {
    for (const scope of Object.keys(def)) {
      const model = modelFor(entity, scope);
      const table = tableFor(entity, scope);
      if (model.getTableName() !== table) {
        fail(`${entity}/${scope}: model table ${model.getTableName()} != ${table}`);
        continue;
      }
      const include = includeFor[entity] || [];
      try {
        const row = await model.findOne({ include });
        const loaded = include.filter((as) => row && row[as]).join(', ') || (row ? 'no related rows' : 'table empty');
        ok(`${`${entity}/${scope}`.padEnd(26)} -> ${table.padEnd(32)} include: ${include.join(', ') || '-'} (${loaded})`);
      } catch (err) {
        fail(`${entity}/${scope}: ${err.message}`);
      }
    }
  }
}

async function checkGeneratedColumns() {
  console.log('\n4. daily_logs generated columns are never written');
  const { DailyLogs, Vehicles, Drivers } = models;
  const vehicle = await Vehicles.findOne();
  const driver = await Drivers.findOne();
  const t = await sequelize.transaction();
  try {
    const log = await DailyLogs.create(
      { vehicle_id: vehicle.id, driver_id: driver.id, date: '2099-01-01', opening_km: 1000, closing_km: 1120,
        income: 500, other_exp: 50, total_km: 999, profit: 999 },
      { transaction: t }
    );
    let row = await DailyLogs.findByPk(log.id, { transaction: t });
    if (row.total_km === 120 && Number(row.profit) === 450) ok(`create: total_km=${row.total_km}, profit=${row.profit}`);
    else fail(`create: total_km=${row.total_km}, profit=${row.profit}`);

    row.closing_km = 1150;
    row.total_km = 1;
    await row.save({ transaction: t });
    row = await DailyLogs.findByPk(log.id, { transaction: t });
    if (row.total_km === 150) ok(`instance save: total_km=${row.total_km}`);
    else fail(`instance save: total_km=${row.total_km}`);

    await DailyLogs.update({ income: 1000, profit: 1 }, { where: { id: log.id }, transaction: t });
    row = await DailyLogs.findByPk(log.id, { transaction: t });
    if (Number(row.profit) === 950) ok(`bulk update: profit=${row.profit}`);
    else fail(`bulk update: profit=${row.profit}`);
  } catch (err) {
    fail(`generated columns: ${err.message}`);
  } finally {
    await t.rollback();
  }
}

(async () => {
  try {
    await checkCounts();
    await checkFindAll();
    await checkScopes();
    await checkGeneratedColumns();
  } catch (err) {
    fail(err.stack);
  } finally {
    await sequelize.close();
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
