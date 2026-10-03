/*
 * Small, re-runnable schema changes agreed during the rebuild. Each migration checks
 * whether it is already applied, so running this twice (or on production) is safe.
 *
 *   npm run db:migrate -w server
 *
 * After a migration that changes columns, run `npm run db:generate-models -w server`.
 */
const { sequelize } = require('../config/database');
const env = require('../config/env');

const columnType = async (table, column) => {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [env.DB_NAME, table, column] }
  );
  return rows[0]?.type || null;
};

const MIGRATIONS = [
  {
    id: '001-drivers-status-deleted',
    description: "Allow drivers.status = 'deleted' so the driver soft delete can be saved (Phase 6 decision)",
    isApplied: async () => (await columnType('drivers', 'status'))?.includes("'deleted'"),
    up: () =>
      sequelize.query(
        "ALTER TABLE `drivers` MODIFY `status` ENUM('active','inactive','deleted') DEFAULT 'active'"
      ),
  },
  {
    // salaries.php / sv_salaries.php ran this UPDATE on every page load; the new app runs it once.
    // Data only (no schema change); re-running is harmless. Run it again at switch-over, since the
    // PHP app keeps writing until then.
    id: '002-salary-carry-forward-type',
    description: "Advance rows whose note contains 'carry-forward' become type 'carry_forward' (own and sub-vendor)",
    isApplied: async () => {
      const [[own], [sv]] = await Promise.all(
        ['salary_transactions', 'sub_vendor_salary_transactions'].map((t) =>
          sequelize.query(`SELECT COUNT(*) AS n FROM \`${t}\` WHERE type = 'advance' AND note LIKE '%carry-forward%'`)
        )
      ).then((r) => r.map(([rows]) => rows));
      return Number(own.n) === 0 && Number(sv.n) === 0;
    },
    up: async () => {
      for (const t of ['salary_transactions', 'sub_vendor_salary_transactions']) {
        await sequelize.query(`UPDATE \`${t}\` SET type = 'carry_forward' WHERE type = 'advance' AND note LIKE '%carry-forward%'`);
      }
    },
  },
];

(async () => {
  let failed = false;
  try {
    for (const m of MIGRATIONS) {
      if (await m.isApplied()) {
        console.log(`  skip  ${m.id} (already applied)`);
        continue;
      }
      await m.up();
      console.log(`  done  ${m.id}: ${m.description}`);
    }
  } catch (err) {
    failed = true;
    console.error(`Migration failed: ${err.message}`);
  } finally {
    await sequelize.close();
  }
  process.exit(failed ? 1 : 0);
})();
