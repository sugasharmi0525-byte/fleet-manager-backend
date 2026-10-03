const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');
const SQL = require('../queries/dashboard.sql');
const { today: todayIST } = require('../utils/dates');

const DAY_MS = 86_400_000;

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** First day of the month `offset` months from the month of `isoDate`, YYYY-MM-DD. */
function monthStart(isoDate, offset) {
  const [y, m] = isoDate.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return d.toISOString().slice(0, 10);
}

const scalar = async (sql, replacements) => {
  const [row] = await sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
  return Number(row?.n) || 0;
};

const PERIODS = ['today', 'month', 'last'];

/** Date range of a dashboard period and of the one it is compared with. */
function periodRange(period, today) {
  if (period === 'today') {
    const y = addDays(today, -1);
    return { from: today, to: today, prevFrom: y, prevTo: y, label: 'Today', prevLabel: 'yesterday' };
  }
  const thisStart = monthStart(today, 0);
  const lastStart = monthStart(today, -1);
  const beforeStart = monthStart(today, -2);
  // fixed names: en-IN would give "Sept", the rest of the app uses Jan … Dec
  const name = (iso) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(iso.slice(5, 7)) - 1];
  if (period === 'last') {
    return { from: lastStart, to: addDays(thisStart, -1), prevFrom: beforeStart, prevTo: addDays(lastStart, -1), label: name(lastStart), prevLabel: name(beforeStart) };
  }
  return { from: thisStart, to: today, prevFrom: lastStart, prevTo: addDays(thisStart, -1), label: name(thisStart), prevLabel: name(lastStart) };
}

const totalsOf = (row) => ({ income: Number(row?.income) || 0, expense: Number(row?.expense) || 0, profit: Number(row?.profit) || 0, logs: Number(row?.logs) || 0, km: Number(row?.km) || 0 });

/** Everything on car-v1/dashboard.php, in one response, plus the redesign's period figures. */
async function summary(periodParam) {
  const today = todayIST();
  const period = PERIODS.includes(periodParam) ? periodParam : 'month';
  const replacements = { today, nextMonth: addDays(today, 30) };

  const [notifications, activeDrivers, totalVehicles, monthProfit, presentToday, absentToday, topVehicles] = await Promise.all([
    sequelize.query(SQL.EXPIRY_NOTIFICATIONS, { replacements, type: QueryTypes.SELECT }),
    scalar(SQL.ACTIVE_DRIVERS),
    scalar(SQL.TOTAL_VEHICLES),
    scalar(SQL.MONTH_PROFIT, replacements),
    scalar(SQL.PRESENT_TODAY, replacements),
    scalar(SQL.ABSENT_TODAY, replacements),
    sequelize.query(SQL.TOP_VEHICLES, { type: QueryTypes.SELECT }),
  ]);

  // Days left as PHP computed it: floor((expiry midnight - now) / 1 day), in India time.
  const now = Date.now();
  const withDays = notifications.map((n) => {
    const expiry = Date.parse(`${String(n.expiry_date).slice(0, 10)}T00:00:00+05:30`);
    return { ...n, expired: expiry < now, days_left: Math.floor((expiry - now) / DAY_MS) };
  });

  // Added with the UI redesign: profit trend, commitments due, today's gaps.
  const extra = { ...replacements, yesterday: addDays(today, -1), since: monthStart(today, -5) };
  const [trendRows, ranYesterday, missingLogs, unmarked, commitmentsDue] = await Promise.all([
    sequelize.query(SQL.PROFIT_TREND, { replacements: extra, type: QueryTypes.SELECT }),
    scalar(SQL.RAN_YESTERDAY, extra),
    sequelize.query(SQL.MISSING_LOGS, { replacements: extra, type: QueryTypes.SELECT }),
    sequelize.query(SQL.UNMARKED_DRIVERS, { replacements: extra, type: QueryTypes.SELECT }),
    sequelize.query(SQL.COMMITMENTS_DUE, { replacements: extra, type: QueryTypes.SELECT }),
  ]);
  // Period switch (gap review): totals for the period and the one before, top vehicles, trend series.
  const range = periodRange(period, today);
  const [[cur], [prev], topPeriod, onRoutes, moneyRows] = await Promise.all([
    sequelize.query(SQL.PERIOD_TOTALS, { replacements: { from: range.from, to: range.to }, type: QueryTypes.SELECT }),
    sequelize.query(SQL.PERIOD_TOTALS, { replacements: { from: range.prevFrom, to: range.prevTo }, type: QueryTypes.SELECT }),
    sequelize.query(SQL.TOP_VEHICLES_PERIOD, { replacements: { from: range.from, to: range.to }, type: QueryTypes.SELECT }),
    scalar(SQL.ON_ROUTES),
    sequelize.query(SQL.MONEY_TREND, { replacements: extra, type: QueryTypes.SELECT }),
  ]);

  const byMonth = Object.fromEntries(trendRows.map((r) => [r.ym, Number(r.n) || 0]));
  const money = Object.fromEntries(moneyRows.map((r) => [r.ym, r]));
  const trend = Array.from({ length: 6 }, (_, i) => {
    const ym = monthStart(today, i - 5).slice(0, 7);
    return { month: ym, profit: byMonth[ym] || 0, income: Number(money[ym]?.income) || 0, expense: Number(money[ym]?.expense) || 0 };
  });

  return {
    today,
    generatedAt: new Date().toISOString(),
    period: { key: period, ...range, current: totalsOf(cur), previous: totalsOf(prev) },
    onRoutes,
    topVehiclesPeriod: topPeriod.map((v) => ({
      id: v.id,
      reg_no: v.reg_no,
      km: Number(v.km) || 0,
      total_income: Number(v.total_income) || 0,
      total_exp: Number(v.total_exp) || 0,
      total_profit: Number(v.total_profit) || 0,
    })),
    stats: { activeDrivers, presentToday, absentToday, totalVehicles, monthProfit, alerts: withDays.length, ranYesterday, unmarkedToday: unmarked.length },
    notifications: withDays,
    trend,
    commitmentsDue: commitmentsDue.map((c) => {
      const due = Date.parse(`${String(c.due_date).slice(0, 10)}T00:00:00+05:30`);
      return { ...c, amount: Number(c.amount) || 0, days_left: Math.floor((due - now) / DAY_MS) };
    }),
    gaps: { yesterday: extra.yesterday, missingLogs, unmarkedDrivers: unmarked },
    topVehicles: topVehicles.map((v) => ({
      reg_no: v.reg_no,
      total_income: Number(v.total_income) || 0,
      total_exp: Number(v.total_exp) || 0,
      total_profit: Number(v.total_profit) || 0,
    })),
  };
}

module.exports = { summary, periodRange };
