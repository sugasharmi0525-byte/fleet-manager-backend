/*
 * Read-only lookups added with the UI gap review (docs/ui-redesign-proposal.md, "Gap review"):
 * global search, alerts for the bell and the Vehicles menu badge, the vehicle detail page and
 * the daily-logs summary strip. Nothing here writes or changes a PHP calculation.
 */
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');
const { tableFor } = require('./scope');
const { HttpError } = require('../middleware/errorHandler');
const { today: todayIST } = require('../utils/dates');

const DAY_MS = 86_400_000;
const select = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const num = (v) => Number(v) || 0;

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** First and last day of a YYYY-MM month. */
function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

const daysLeft = (isoDate) => Math.floor((Date.parse(`${String(isoDate).slice(0, 10)}T00:00:00+05:30`) - Date.now()) / DAY_MS);

// A real date that is on or before :soon (zero dates and free-text tax values never match).
const dueBy = (col) => `(${col} REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND ${col} > '1900-01-01' AND ${col} <= :soon)`;

// ---------------------------------------------------------------- global search (Ctrl K)

async function search(q) {
  const term = String(q || '').trim().slice(0, 60);
  if (term.length < 2) return { results: [] };
  const like = `%${term}%`;
  const groups = await Promise.all(
    ['own', 'sv'].flatMap((scope) => {
      const p = scope === 'sv' ? '/sv' : '';
      const fleet = scope === 'sv' ? 'Sub-vendor' : 'Own fleet';
      return [
        select(`SELECT id, reg_no, make FROM \`${tableFor('vehicles', scope)}\` WHERE reg_no LIKE :like ORDER BY reg_no LIMIT 6`, { like }).then((rows) =>
          rows.map((r) => ({ type: 'Vehicle', scope, label: r.reg_no, detail: [fleet, r.make].filter(Boolean).join(' · '), to: `${p}/vehicles/${r.id}`, icon: 'bi-truck' }))
        ),
        select(`SELECT id, name, phone FROM \`${tableFor('drivers', scope)}\` WHERE status <> 'deleted' AND (name LIKE :like OR phone LIKE :like) ORDER BY name LIMIT 6`, { like }).then((rows) =>
          rows.map((r) => ({ type: 'Driver', scope, label: r.name, detail: [fleet, r.phone].filter(Boolean).join(' · '), to: `${p}/drivers?search=${encodeURIComponent(r.name)}`, icon: 'bi-person' }))
        ),
        select(
          `SELECT r.id, r.route_name, v.reg_no FROM \`${tableFor('routes', scope)}\` r LEFT JOIN \`${tableFor('vehicles', scope)}\` v ON v.id = r.vehicle_id
            WHERE r.route_name LIKE :like ORDER BY r.route_name LIMIT 6`,
          { like }
        ).then((rows) =>
          rows.map((r) => ({ type: 'Route', scope, label: r.route_name, detail: [fleet, r.reg_no].filter(Boolean).join(' · '), to: `${p}/routes?search=${encodeURIComponent(r.route_name)}`, icon: 'bi-map' }))
        ),
      ];
    })
  );
  return { results: groups.flat() };
}

// ---------------------------------------------------------------- alerts (bell + menu badges)

const DOC_COLUMNS = [
  ['FC', 'fc_expiry'],
  ['Insurance', 'insurance_expiry'],
  ['Pollution', 'pollution_expiry'],
  ['Tax', 'tax_expiry'],
];

/** Vehicles with a document expired or expiring within 30 days, per scope; plus commitments due in 7 days. */
async function alerts() {
  const today = todayIST();
  const soon = addDays(today, 30);
  const anyDue = DOC_COLUMNS.map(([, c]) => dueBy(c)).join(' OR ');

  const [ownCount, svCount, docs, commitments] = await Promise.all([
    select(`SELECT COUNT(*) AS n FROM vehicles WHERE status = 'active' AND (${anyDue})`, { soon }),
    select(`SELECT COUNT(*) AS n FROM sub_vendor_vehicles WHERE (status = 'active' OR status IS NULL) AND (${anyDue})`, { soon }),
    select(
      DOC_COLUMNS.map(([label, c]) => `SELECT id, reg_no, '${label}' AS type, ${c} AS expiry_date FROM vehicles WHERE status = 'active' AND ${dueBy(c)}`).join(' UNION ALL ') +
        ' ORDER BY expiry_date LIMIT 20',
      { soon }
    ),
    select(
      `SELECT c.id, c.name, c.amount, c.due_date, v.reg_no FROM commitments c LEFT JOIN vehicles v ON v.id = c.vehicle_id
        WHERE c.due_date BETWEEN :today AND :week ORDER BY c.due_date`,
      { today, week: addDays(today, 7) }
    ),
  ]);

  const items = [
    ...docs.map((d) => {
      const left = daysLeft(d.expiry_date);
      return { kind: 'document', id: d.id, title: `${d.reg_no} · ${d.type}`, days_left: left, date: String(d.expiry_date).slice(0, 10), to: `/vehicles/${d.id}` };
    }),
    ...commitments.map((c) => ({ kind: 'commitment', id: c.id, title: `${c.name}${c.reg_no ? ` · ${c.reg_no}` : ''}`, amount: num(c.amount), days_left: daysLeft(c.due_date), date: String(c.due_date).slice(0, 10), to: '/commitments' })),
  ].sort((a, b) => a.days_left - b.days_left);

  return { badges: { vehicles: num(ownCount[0]?.n), svVehicles: num(svCount[0]?.n) }, count: items.length, items };
}

// ---------------------------------------------------------------- vehicle detail page

async function vehicleOverview(scope, vehicleId) {
  const V = tableFor('vehicles', scope);
  const L = tableFor('dailyLogs', scope);
  const F = tableFor('fuel', scope);
  const M = tableFor('maintenance', scope);
  const R = tableFor('routes', scope);
  const D = tableFor('drivers', scope);
  const r = { id: vehicleId };

  const [vehicle] = await select(`SELECT * FROM \`${V}\` WHERE id = :id`, r);
  if (!vehicle) throw new HttpError(404, 'Vehicle not found');

  const ym = todayIST().slice(0, 7);
  const { from, to } = monthRange(ym);
  const m = { ...r, from, to };
  const profitCol = scope === 'own' ? 'SUM(profit)' : 'NULL';

  const [routes, logs, fuel, maintenance, logMonth, logAll, fuelMonth, maintMonth, maintAll, commitments] = await Promise.all([
    select(`SELECT r.id, r.route_name, r.max_km, r.extra_km_rate, r.status, d.name AS driver_name FROM \`${R}\` r LEFT JOIN \`${D}\` d ON d.id = r.driver_id WHERE r.vehicle_id = :id ORDER BY r.status, r.id`, r),
    select(`SELECT l.id, l.date, l.opening_km, l.closing_km, l.extra_km, l.extra_km_cost, ${scope === 'own' ? 'l.profit' : 'NULL AS profit'}, d.name AS driver_name FROM \`${L}\` l LEFT JOIN \`${D}\` d ON d.id = l.driver_id WHERE l.vehicle_id = :id ORDER BY l.date DESC, l.id DESC LIMIT 15`, r),
    select(`SELECT id, date, fuel_type, liters, amount, km_reading, km_run, mileage FROM \`${F}\` WHERE vehicle_id = :id ORDER BY date DESC, km_reading DESC LIMIT 15`, r),
    select(`SELECT id, service_date, type, description, km_reading, total_cost FROM \`${M}\` WHERE vehicle_id = :id ORDER BY service_date DESC LIMIT 15`, r),
    select(`SELECT COUNT(*) AS logs, SUM(closing_km - opening_km) AS km, SUM(extra_km) AS extra_km, SUM(extra_km_cost) AS extra_cost, ${profitCol} AS profit FROM \`${L}\` WHERE vehicle_id = :id AND date BETWEEN :from AND :to`, m),
    select(`SELECT COUNT(*) AS logs, MIN(date) AS first_date, MAX(date) AS last_date FROM \`${L}\` WHERE vehicle_id = :id`, r),
    select(`SELECT SUM(amount) AS amount, SUM(liters) AS liters, AVG(NULLIF(mileage, 0)) AS mileage FROM \`${F}\` WHERE vehicle_id = :id AND date BETWEEN :from AND :to`, m),
    select(`SELECT SUM(total_cost) AS total, COUNT(*) AS n FROM \`${M}\` WHERE vehicle_id = :id AND service_date BETWEEN :from AND :to`, m),
    select(`SELECT SUM(total_cost) AS total, MAX(service_date) AS last_date FROM \`${M}\` WHERE vehicle_id = :id`, r),
    scope === 'own' ? select(`SELECT id, name, amount, frequency, due_date FROM commitments WHERE vehicle_id = :id ORDER BY due_date`, r) : Promise.resolve([]),
  ]);

  const documents = DOC_COLUMNS.map(([label, col]) => ({ label, value: vehicle[col] || null }));
  const activity = [
    ...logs.map((l) => ({ date: l.date, icon: 'bi-journal-text', text: `Trip log · ${num(l.closing_km) - num(l.opening_km)} km${l.driver_name ? ` · ${l.driver_name}` : ''}` })),
    ...fuel.map((f) => ({ date: f.date, icon: 'bi-fuel-pump', text: `${f.fuel_type || 'Fuel'} · ${num(f.liters)} ${String(f.fuel_type).toLowerCase() === 'cng' ? 'kg' : 'L'} · ₹${num(f.amount).toLocaleString('en-IN')}` })),
    ...maintenance.map((x) => ({ date: x.service_date, icon: 'bi-tools', text: `${x.type} · ₹${num(x.total_cost).toLocaleString('en-IN')}` })),
  ]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 10);

  return {
    scope,
    month: ym,
    vehicle,
    documents,
    routes,
    kpis: {
      km: num(logMonth[0]?.km),
      logs: num(logMonth[0]?.logs),
      extraKm: num(logMonth[0]?.extra_km),
      extraCost: num(logMonth[0]?.extra_cost),
      profit: scope === 'own' ? num(logMonth[0]?.profit) : null,
      fuelSpend: num(fuelMonth[0]?.amount),
      fuelLiters: num(fuelMonth[0]?.liters),
      mileage: num(fuelMonth[0]?.mileage),
      maintenance: num(maintMonth[0]?.total),
      maintenanceAll: num(maintAll[0]?.total),
      lastService: maintAll[0]?.last_date || null,
      totalLogs: num(logAll[0]?.logs),
      lastLog: logAll[0]?.last_date || null,
    },
    logs,
    fuel,
    maintenance,
    commitments,
    activity,
  };
}

// ---------------------------------------------------------------- daily-logs summary strip

/** Totals for a month (default: this month) shown above the daily-logs list. */
async function dailyLogSummary(scope, query) {
  const ym = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : todayIST().slice(0, 7);
  const { from, to } = monthRange(ym);
  const L = tableFor('dailyLogs', scope);
  const r = { from, to };
  const [logs] = await select(
    `SELECT COUNT(*) AS logs, COUNT(DISTINCT vehicle_id) AS vehicles, SUM(closing_km - opening_km) AS km, SUM(extra_km_cost) AS extra_cost,
            ${scope === 'own' ? 'SUM(profit)' : 'SUM(on_load_charges)'} AS money
       FROM \`${L}\` WHERE date BETWEEN :from AND :to`,
    r
  );
  const out = { month: ym, logs: num(logs?.logs), vehiclesRan: num(logs?.vehicles), km: num(logs?.km), extraCost: num(logs?.extra_cost) };
  if (scope === 'own') return { ...out, profit: num(logs?.money) };

  const [[vehicles], [charges]] = await Promise.all([
    select(`SELECT COUNT(*) AS n FROM sub_vendor_vehicles WHERE status = 'active' OR status IS NULL`),
    select(`SELECT SUM(loading_charge) AS total, COUNT(*) AS n FROM sub_vendor_charges WHERE date BETWEEN :from AND :to`, r),
  ]);
  return { ...out, onLoadCharges: num(logs?.money), vendorVehicles: num(vehicles?.n), loadingCharges: num(charges?.total), chargeEntries: num(charges?.n) };
}

module.exports = { search, alerts, vehicleOverview, dailyLogSummary, monthRange, addDays };
