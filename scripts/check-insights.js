/*
 * Gap-review check: the read-only endpoints added after the PDF comparison (search, alerts,
 * vehicle overview, daily-log summary, dashboard periods, fuel summary, extra-km filter,
 * financial by month, attendance tile vehicles). Figures are recalculated from raw rows.
 * Writes nothing.
 *
 *   npm run check:insights -w server
 */
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');
const { tableFor } = require('../services/scope');
const { today } = require('../utils/dates');
const { createHarness } = require('./lib/harness');

const { expect, section, call, run } = createHarness('insights-check');
const q = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const n = (v) => Number(v) || 0;
const near = (a, b) => Math.abs(n(a) - n(b)) < 0.01;

const steps = [
  async () => {
    section('Global search');
    const [v] = await q('SELECT id, reg_no FROM vehicles ORDER BY id LIMIT 1');
    const short = await call('GET', '/api/search?q=a');
    expect(short.status === 200 && short.data.results.length === 0, 'one-letter query returns nothing');
    if (v) {
      const r = await call('GET', `/api/search?q=${encodeURIComponent(v.reg_no)}`);
      expect(r.status === 200 && r.data.results.some((x) => x.type === 'Vehicle' && x.to === `/vehicles/${v.id}`), `finds vehicle ${v.reg_no} with a link to its page`, r.data);
    }
  },
  async () => {
    section('Alerts and badges');
    const r = await call('GET', '/api/alerts');
    expect(r.status === 200 && typeof r.data.badges.vehicles === 'number', 'returns badge counts', r.data);
    const soon = new Date(Date.parse(`${today()}T00:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10);
    const rows = await q("SELECT fc_expiry, insurance_expiry, pollution_expiry, tax_expiry FROM vehicles WHERE status = 'active'");
    const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || ''));
    const isDue = (d) => /^\d{4}-\d{2}-\d{2}$/.test(iso(d)) && iso(d) > '1900-01-01' && iso(d) <= soon;
    const expected = rows.filter((x) => [x.fc_expiry, x.insurance_expiry, x.pollution_expiry, x.tax_expiry].some(isDue)).length;
    expect(r.data.badges.vehicles === expected, `Vehicles badge = ${expected} (documents expired or due in 30 days)`, r.data.badges);
    expect(r.data.items.every((i, k, a) => k === 0 || a[k - 1].days_left <= i.days_left), 'items sorted by days left');
  },
  async () => {
    section('Vehicle overview');
    for (const scope of ['own', 'sv']) {
      const [v] = await q(`SELECT vehicle_id AS id FROM ${tableFor('dailyLogs', scope)} GROUP BY vehicle_id ORDER BY COUNT(*) DESC LIMIT 1`);
      if (!v) continue;
      const exists = await q(`SELECT id FROM ${tableFor('vehicles', scope)} WHERE id = ?`, [v.id]);
      if (!exists.length) continue;
      const r = await call('GET', `/api/${scope}/vehicles/${v.id}/overview`);
      const [all] = await q(`SELECT COUNT(*) AS n FROM ${tableFor('dailyLogs', scope)} WHERE vehicle_id = ?`, [v.id]);
      expect(r.status === 200 && r.data.kpis.totalLogs === n(all.n), `${scope}: vehicle ${v.id} total logs = ${all.n}`, r.data?.kpis);
      expect(r.data.logs.length <= 15 && r.data.activity.length <= 10, `${scope}: recent lists are capped`);
    }
    const missing = await call('GET', '/api/own/vehicles/999999999/overview');
    expect(missing.status === 404, 'unknown vehicle -> 404');
  },
  async () => {
    section('Daily-log summary and extra-km filter');
    for (const scope of ['own', 'sv']) {
      const months = await q(
        `SELECT DATE_FORMAT(date, '%Y-%m') AS ym, COUNT(*) AS n, SUM(closing_km - opening_km) AS km FROM ${tableFor('dailyLogs', scope)} GROUP BY ym ORDER BY ym DESC LIMIT 2`
      );
      for (const m of months) {
        const r = await call('GET', `/api/${scope}/daily-logs/summary?month=${m.ym}`);
        expect(r.data.logs === n(m.n) && r.data.km === n(m.km), `${scope} ${m.ym}: ${m.n} logs, ${n(m.km)} km`, r.data);
      }
      const extra = await call('GET', `/api/${scope}/daily-logs?extra_only=1`);
      expect(extra.data.rows.every((x) => x.extra_km > 0), `${scope}: extra-km filter returns only logs with extra km`);
      if (scope === 'own') {
        const [cnt] = await q('SELECT COUNT(*) AS n FROM daily_logs l JOIN vehicles v ON v.id = l.vehicle_id JOIN drivers d ON d.id = l.driver_id WHERE l.extra_km > 0');
        expect(extra.data.total === n(cnt.n), `own: ${cnt.n} logs with extra km`, extra.data.total);
        const all = await call('GET', '/api/own/daily-logs');
        const [p] = await q('SELECT SUM(l.profit) AS p FROM daily_logs l JOIN vehicles v ON v.id = l.vehicle_id JOIN drivers d ON d.id = l.driver_id');
        expect(near(all.data.totals.profit, p.p), 'own: profit total in the footer', all.data.totals);
      }
    }
  },
  async () => {
    section('Dashboard periods');
    for (const period of ['today', 'month', 'last']) {
      const r = await call('GET', `/api/dashboard?period=${period}`);
      const p = r.data.period;
      const [row] = await q('SELECT SUM(profit) AS profit, COUNT(*) AS logs FROM daily_logs WHERE date BETWEEN ? AND ?', [p.from, p.to]);
      expect(r.status === 200 && near(p.current.profit, row.profit) && p.current.logs === n(row.logs), `${period}: ${p.from}..${p.to} profit and log count`, p.current);
    }
    const r = await call('GET', '/api/dashboard');
    expect(r.data.period.key === 'month' && r.data.trend.length === 6 && 'income' in r.data.trend[0], 'default period is this month; trend has income/expense/profit');
    expect(near(r.data.stats.monthProfit, r.data.period.current.profit), 'this-month profit matches the PHP "Month Profit" card');
  },
  async () => {
    section('Fuel summary and filters');
    const months = await q("SELECT DATE_FORMAT(date, '%Y-%m') AS ym FROM fuel_logs WHERE vehicle_id IN (SELECT vehicle_id FROM routes) GROUP BY ym ORDER BY ym DESC LIMIT 1");
    if (months.length) {
      const { ym } = months[0];
      const r = await call('GET', `/api/own/fuel?month=${ym}`);
      const [sum] = await q("SELECT SUM(amount) AS amount FROM fuel_logs WHERE DATE_FORMAT(date, '%Y-%m') = ? AND vehicle_id IN (SELECT vehicle_id FROM routes)", [ym]);
      expect(near(r.data.summary.current.amount, sum.amount), `${ym}: fuel spend ${n(sum.amount)}`, r.data.summary.current);
      expect(r.data.rows.every((x) => String(x.date).slice(0, 7) === ym), `${ym}: month filter`);
      const d = await call('GET', `/api/own/fuel?month=${ym}&fuel_type=diesel`);
      expect(d.data.rows.every((x) => x.fuel_type === 'Diesel'), 'fuel-type filter');
    }
    const all = await call('GET', '/api/own/fuel');
    const [cnt] = await q('SELECT COUNT(*) AS n FROM fuel_logs fl JOIN vehicles v ON fl.vehicle_id = v.id INNER JOIN routes r ON v.id = r.vehicle_id');
    expect(all.data.rows.length === n(cnt.n), 'unfiltered list unchanged (PHP query)');
  },
  async () => {
    section('Financial report by month');
    const r = await call('GET', '/api/own/reports/financial/by-month');
    expect(r.status === 200 && r.data.months.length === 6, 'six months returned', r.data);
    const last = r.data.months[5];
    const [y, m] = last.month.split('-').map(Number);
    const to = `${last.month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    const one = await call('GET', `/api/own/reports/financial?from_date=${last.month}-01&to_date=${to}`);
    expect(near(one.data.totals.profit, last.profit), `${last.month}: same profit as the financial report`);
    const t = one.data.totals;
    expect(near(t.maint, t.maint_only + t.commitments + t.other), 'expense parts add up to "Maintenance & Others"', t);
  },
  async () => {
    section('Attendance tiles show the route vehicle');
    const r = await call('GET', `/api/own/attendance/day?date=${today()}`);
    const [route] = await q(
      "SELECT r.driver_id, v.reg_no FROM routes r JOIN vehicles v ON v.id = r.vehicle_id JOIN drivers d ON d.id = r.driver_id WHERE r.status = 'active' AND d.status = 'active' ORDER BY r.id LIMIT 1"
    );
    if (route) expect(r.data.drivers.find((d) => d.id === route.driver_id)?.reg_no === route.reg_no, `driver ${route.driver_id} -> ${route.reg_no}`);
  },
];

run({ steps, sequelize, label: 'insights' });
