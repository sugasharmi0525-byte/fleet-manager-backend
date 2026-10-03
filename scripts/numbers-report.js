/*
 * Phase 12: writes the new app's figures for two months to a Markdown sheet, laid out like the
 * PHP pages, so each number can be ticked off against the old app on the same database.
 * Read-only: nothing is written to the database.
 *
 *   npm run numbers:report -w server                         (last two months with daily logs)
 *   npm run numbers:report -w server -- --months 2026-08,2026-09
 */
const fs = require('fs');
const path = require('path');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');
const env = require('../config/env');
const salaries = require('../services/salary.service');
const reports = require('../services/report.service');
const SQL = require('../queries/dashboard.sql');

if (env.isProd) {
  console.error('Refusing to run against production');
  process.exit(1);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rs = (v) => `₹${inr.format(Number(v) || 0)}`;
const cell = (v) => String(v ?? '').replace(/\|/g, '\\|');
/** Markdown table; each row ends with a ☐ to tick when it matches PHP. */
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${[...r.map(cell), '☐'].join(' | ')} |`)].join('\n');
const tick = (head) => [...head, 'Matches PHP?'];
const bounds = (y, m) => ({ from: `${y}-${String(m).padStart(2, '0')}-01`, to: `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}` });

async function chooseMonths() {
  const arg = process.argv.indexOf('--months');
  if (arg > -1) {
    return process.argv[arg + 1].split(',').map((s) => {
      const [y, m] = s.split('-').map(Number);
      if (!(y > 2000 && m >= 1 && m <= 12)) throw new Error(`Bad month: ${s} (use YYYY-MM)`);
      return { y, m };
    });
  }
  const rows = await sequelize.query("SELECT DISTINCT DATE_FORMAT(date, '%Y-%m') ym FROM daily_logs WHERE date <= CURDATE() ORDER BY ym DESC LIMIT 2", { type: QueryTypes.SELECT });
  return rows.map((r) => ({ y: Number(r.ym.slice(0, 4)), m: Number(r.ym.slice(5)) })).reverse();
}

async function payroll(scope, y, m) {
  const out = await salaries.list(scope, { month: m, year: y, limit: 100, page: 1 });
  let rows = out.rows;
  for (let page = 2; page <= out.pages; page += 1) rows = rows.concat((await salaries.list(scope, { month: m, year: y, limit: 100, page })).rows);
  return rows;
}

async function monthSection(y, m) {
  const label = `${MONTHS[m - 1]} ${y}`;
  const { from, to } = bounds(y, m);
  const lines = [`## ${label}`, ''];

  // Salaries (own and sub-vendor)
  for (const [scope, page] of [['own', 'salaries.php'], ['sv', 'sv_salaries.php']]) {
    const rows = await payroll(scope, y, m);
    const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
    lines.push(`### Salaries — ${scope === 'own' ? 'own fleet' : 'sub-vendor'} (\`${page}?month=${m}&year=${y}&limit=100\`)`, '');
    lines.push(`Cards: total salary **${rs(sum('salary'))}**, paid **${rs(sum('total_paid'))}**, salary balance **${rs(sum('salary_balance'))}**, advance balance **${rs(Math.abs(sum('advance_balance')))}** (PHP rounds the cards to whole rupees)`, '');
    lines.push(table(tick(['Driver', 'Working', 'Absent', 'Total', 'Prev adv', 'New adv', 'Total adv', 'Deduction', 'Salary', 'Paid', 'Salary bal', 'Adv bal']),
      rows.map((r) => [r.name, r.days_present, r.days_absent, r.total_days, rs(r.prev_advance), rs(r.month_advance), rs(r.total_advance), rs(r.total_deduction), rs(r.salary), rs(r.total_paid), rs(r.salary_balance), rs(Math.abs(r.advance_balance))])), '');
  }

  // Financial and monthly reports
  for (const scope of ['own', 'sv']) {
    const fin = await reports.financial(scope, { from_date: from, to_date: to });
    const page = scope === 'own' ? 'reports.php' : 'sv_reports.php';
    lines.push(`### Financial report — ${scope === 'own' ? 'own fleet' : 'sub-vendor'} (\`${page}?from_date=${from}&to_date=${to}\`)`, '');
    lines.push(table(tick(['Vehicle', 'Days', 'KM', 'Income', 'Fuel', 'Salary', 'Maintenance', 'Net profit']),
      [...fin.rows.map((r) => [r.reg_no, r.days, r.kms, rs(r.income), rs(r.fuel), rs(r.salary), rs(r.maint), rs(r.profit)]),
        ['**TOTAL**', '', '', `**${rs(fin.totals.income)}**`, `**${rs(fin.totals.fuel)}**`, `**${rs(fin.totals.salary)}**`, `**${rs(fin.totals.maint)}**`, `**${rs(fin.totals.profit)}**`]]), '');

    const mon = await reports.monthly(scope, { month: m, year: y });
    const mpage = scope === 'own' ? 'monthly_reports.php' : 'sv_monthly_reports.php';
    lines.push(`### Monthly report — ${scope === 'own' ? 'own fleet' : 'sub-vendor'} (\`${mpage}?month=${String(m).padStart(2, '0')}&year=${y}\`)`, '');
    lines.push(table(tick(['Vehicle', 'Days', 'KM', 'Income', 'Fuel', 'Salary', 'Net profit']),
      [...mon.rows.map((r) => [r.reg_no, r.days, r.kms, rs(r.income), rs(r.fuel), rs(r.salary), rs(r.profit)]),
        ['**TOTAL**', '', '', `**${rs(mon.totals.income)}**`, `**${rs(mon.totals.fuel)}**`, `**${rs(mon.totals.salary)}**`, `**${rs(mon.totals.profit)}**`]]), '');
  }

  // Fuel and maintenance reports (own fleet)
  const fuel = await reports.fuel({ from_date: from, to_date: to });
  lines.push(`### Fuel report (\`fuel_report.php?from_date=${from}&to_date=${to}\`)`, '');
  lines.push(table(tick(['Vehicle', 'Fills', 'Liters', 'Amount', 'Distance', 'Avg mileage']),
    fuel.vehicles.map((v) => [v.vehicle.reg_no, v.logs.length, v.summary.liters.toFixed(2), rs(v.summary.amount), v.summary.kms, v.summary.mileage.toFixed(2)])), '');
  lines.push(`Day-by-day list: ${fuel.consolidated.length} fills, total ${rs(fuel.consolidated.reduce((s, c) => s + Number(c.amount), 0))} ☐`, '');

  const maint = await reports.maintenance({ month: m, year: y });
  lines.push(`### Maintenance report (\`maintenance_report.php?month=${String(m).padStart(2, '0')}&year=${y}\`)`, '');
  lines.push(maint.vehicles.length
    ? table(tick(['Vehicle', 'Records', 'Spares', 'Labour', 'Total']), maint.vehicles.map((v) => [v.vehicle.reg_no, v.logs.length, rs(v.summary.spares), rs(v.summary.labour), rs(v.summary.total)]))
    : 'No maintenance records this month ☐', '');

  // Dashboard "Month Profit" (the dashboard shows the current month; this is the same SQL for this month)
  const [p] = await sequelize.query(SQL.MONTH_PROFIT, { replacements: { today: from }, type: QueryTypes.SELECT });
  lines.push(`### Dashboard month profit`, '', `Sum of \`daily_logs.profit\` for ${label}: **${rs(p?.n)}** ☐ (compare with \`dashboard.php\` while that month is the current month, or run the SQL in phpMyAdmin)`, '');
  return lines.join('\n');
}

(async () => {
  try {
    const months = await chooseMonths();
    const stamp = new Date().toISOString().slice(0, 10);
    const [db] = await sequelize.query('SELECT DATABASE() AS db, VERSION() AS v', { type: QueryTypes.SELECT });
    const parts = [
      `# Numbers check — ${months.map(({ y, m }) => `${MONTHS[m - 1]} ${y}`).join(' and ')}`,
      '',
      `Generated ${stamp} from database \`${db.db}\` (MySQL ${db.v}) by \`npm run numbers:report -w server\`.`,
      '',
      'How to use: point the PHP app and the new app at the **same database**, open each PHP page with the filters shown in the heading, and tick each row that matches. Any mismatch: copy the PHP SQL again (Phase 12 rule), do not adjust numbers.',
      '',
      '_Known, expected differences:_ PHP shows the salary cards rounded to whole rupees; money here has 2 decimals. Rows may be in a different order where the PHP query has no ORDER BY.',
      '',
    ];
    for (const { y, m } of months) parts.push(await monthSection(y, m));
    parts.push('---', '', 'Signed off by: ________________________  Date: __________', '');
    const file = path.resolve(__dirname, '../../../docs', `numbers-check-${stamp}.md`);
    fs.writeFileSync(file, parts.join('\n'), 'utf8');
    console.log(`Wrote ${file}`);
  } catch (err) {
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
