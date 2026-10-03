/*
 * Replaces ALL data in the development database with fictional demo records (every table
 * except `sessions`; the admin login lives in .env, not in the database). No real data:
 * names, registration numbers, phone numbers and amounts are invented.
 *
 *   npm run db:seed-demo -w server -- --yes            backs up first, then wipes and seeds
 *   npm run db:seed-demo -w server -- --yes --no-backup
 *
 * Safety: refuses in production, refuses unless the database name ends in "_dev", needs --yes.
 * Backup: every table is copied to a new database <name>_backup_<yyyymmddhhmm> on the same server.
 *
 * Records go through the app's services where rules apply (daily logs → extra km and odometer,
 * fuel → mileage, attendance → day save, charges, manual income, quotations), so the demo data
 * obeys the same rules as data entered on the screens. Fixed random seed: same data every run.
 */
const env = require('../config/env');
const { sequelize, models } = require('../models');
const { modelFor } = require('../services/scope');
const { today } = require('../utils/dates');
const dailyLogs = require('../services/dailyLog.service');
const fuel = require('../services/fuel.service');
const attendance = require('../services/attendance.service');
const charges = require('../services/charges.service');
const reports = require('../services/report.service');
const quotations = require('../services/quotation.service');

const args = process.argv.slice(2);
const KEEP = ['sessions'];

// ---------------------------------------------------------------- helpers
let seed = 20261003;
/** Deterministic random 0..1 (mulberry32). */
function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (a, b) => Math.round(a + rand() * (b - a));
const pick = (list) => list[Math.floor(rand() * list.length)];
const round2 = (n) => Math.round(n * 100) / 100;

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function monthStart(iso, offset) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 10);
}
function* days(from, to) {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d;
}
const step = (label) => console.log(`  · ${label}`);

// ---------------------------------------------------------------- backup + wipe
async function tables() {
  const [rows] = await sequelize.query("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME");
  return rows.map((r) => r.t);
}

async function backup(list) {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
  const target = `${env.DB_NAME}_backup_${stamp}`;
  await sequelize.query(`CREATE DATABASE \`${target}\``);
  for (const t of list) {
    await sequelize.query(`CREATE TABLE \`${target}\`.\`${t}\` LIKE \`${env.DB_NAME}\`.\`${t}\``);
    const [cols] = await sequelize.query(
      "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND EXTRA NOT LIKE '%GENERATED%' ORDER BY ORDINAL_POSITION",
      { replacements: [t] }
    );
    const names = cols.map((c) => `\`${c.c}\``).join(', ');
    await sequelize.query(`INSERT INTO \`${target}\`.\`${t}\` (${names}) SELECT ${names} FROM \`${env.DB_NAME}\`.\`${t}\``);
  }
  return target;
}

async function wipe(list) {
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const t of list) if (!KEEP.includes(t)) await sequelize.query(`TRUNCATE TABLE \`${t}\``);
  } finally {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

// ---------------------------------------------------------------- demo data (all fictional)
const TODAY = today();
const YESTERDAY = addDays(TODAY, -1);
const START = monthStart(TODAY, -4); // four full months back + this month

const OWN_VEHICLES = [
  ['TN 01 DM 1001', 'TATA', '2022', 'ACE HT', 'Diesel'],
  ['TN 01 DM 1002', 'ASHOK LEYLAND', '2023', 'DOST', 'Diesel'],
  ['TN 01 DM 1003', 'MAHINDRA', '2021', 'BOLERO PICKUP', 'Diesel'],
  ['TN 01 DM 1004', 'TATA', '2024', 'ACE CNG', 'CNG'],
  ['TN 01 DM 1005', 'MARUTI', '2022', 'EECO', 'Petrol,CNG'],
  ['TN 01 DM 1006', 'TATA', '2020', 'INTRA V30', 'Diesel'],
  ['TN 01 DM 1007', 'EICHER', '2023', 'PRO 2049', 'Diesel'],
  ['TN 01 DM 1008', 'PIAGGIO', '2024', 'APE XTRA', 'CNG'],
  ['TN 01 DM 1009', 'MAHINDRA', '2019', 'SUPRO', 'Diesel'],
  ['TN 01 DM 1010', 'HONDA', '2018', 'ACTIVA', 'Petrol'],
];
const OWN_DRIVERS = [
  ['Demo Driver Arun', 750], ['Demo Driver Bala', 700], ['Demo Driver Charles', 800], ['Demo Driver Dinesh', 650], ['Demo Driver Elango', 720],
  ['Demo Driver Farook', 680], ['Demo Driver Ganesh', 900], ['Demo Driver Hari', 760], ['Demo Driver Imran', 600], ['Demo Driver Jagan', 640],
];
const SV_VEHICLES = [
  ['TN 22 SV 2001', 'TATA', '2021', 'ACE GOLD', 'Diesel'],
  ['TN 22 SV 2002', 'MAHINDRA', '2022', 'JEETO', 'Diesel'],
  ['TN 22 SV 2003', 'ASHOK LEYLAND', '2020', 'BADA DOST', 'Diesel'],
  ['TN 22 SV 2004', 'PIAGGIO', '2023', 'APE CITY', 'CNG'],
];
const SV_DRIVERS = [['Demo Vendor Driver Kannan', 700], ['Demo Vendor Driver Logu', 650], ['Demo Vendor Driver Mani', 680], ['Demo Vendor Driver Naveen', 720]];

/** Expiry dates spread so every document state shows: expired, ≤7 days, ≤30 days, valid. */
function expiries(i) {
  const o = [
    [200, 300, 150], [5, 220, 90], [-12, 180, 40], [400, 25, 300], [120, 3, -20],
    [250, 340, 18], [90, 60, 200], [-40, 150, 6], [310, -8, 260], [60, 45, 120],
  ][i % 10];
  return { fc_expiry: addDays(TODAY, o[0]), insurance_expiry: addDays(TODAY, o[1]), pollution_expiry: addDays(TODAY, o[2]) };
}
function taxFields(i) {
  if (i % 4 === 0) return { tax_status: 'No Tax End', tax_expiry: 'No Tax End' };
  if (i % 4 === 1) return { tax_status: 'Other', tax_expiry: addDays(TODAY, [12, 75, 200][i % 3]) };
  if (i % 4 === 2) return { tax_status: 'Other', tax_expiry: 'Paid till Mar 2027' };
  return { tax_status: '', tax_expiry: '' };
}

async function seedSettings() {
  await models.AppSettings.create({ global_petrol_price: 102.5, global_diesel_price: 92.4, global_cng_price: 88 });
  await models.QuoteSettings.create({
    company_name: 'Demo Logistics Pvt Ltd',
    address: '1, Sample Street, Demo Nagar, Chennai 600000',
    phone: '+91 90000 00000',
    gst_no: '33AAAAA0000A1Z0',
    pan_no: 'AAAAA0000A',
    email: 'accounts@demo-logistics.example',
  });
  step('settings (fuel prices, quotation company)');
}

async function seedFleet(scope) {
  const sv = scope === 'sv';
  const V = modelFor('vehicles', scope);
  const D = modelFor('drivers', scope);
  const RH = modelFor('driverRates', scope);
  const R = modelFor('routes', scope);
  const list = sv ? SV_VEHICLES : OWN_VEHICLES;
  const people = sv ? SV_DRIVERS : OWN_DRIVERS;

  const vehicles = [];
  for (const [i, [reg, make, year, type, fuelType]] of list.entries()) {
    vehicles.push(
      await V.create({
        reg_no: reg, make, model_year: year, type, fuel_type: fuelType, deck: i % 3 === 0 ? 'closed' : 'open',
        ...expiries(i + (sv ? 3 : 0)), ...taxFields(i),
        fine_amount: i % 5 === 2 ? 1500 : 0, car_value: between(3, 18) * 50000,
        petrol_price: 0, diesel_price: i % 3 === 1 ? 91.8 : 0, cng_price: 88,
        max_km_per_day: 0, current_km: 15000 + i * 7350, status: !sv && i === 9 ? 'maintenance' : 'active',
      })
    );
  }

  // Sub-vendor driver tables have no AUTO_INCREMENT (as in production), so ids are given.
  const drivers = [];
  for (const [i, [name, rate]] of people.entries()) {
    const status = !sv && i === 8 ? 'inactive' : !sv && i === 9 ? 'deleted' : 'active';
    const startRate = i % 4 === 1 ? rate - 50 : rate; // some drivers had a raise during the period
    drivers.push(await D.create({ ...(sv ? { id: i + 1, created_at: new Date() } : {}), name, phone: `90000${String(10000 + i * 37).padStart(5, '0')}`, daily_rate: rate, status }));
    await RH.create({ ...(sv ? { id: i * 2 + 1 } : {}), driver_id: drivers[i].id, daily_rate: startRate, effective_date: START });
    if (startRate !== rate) await RH.create({ ...(sv ? { id: i * 2 + 2 } : {}), driver_id: drivers[i].id, daily_rate: rate, effective_date: monthStart(TODAY, -2) });
  }

  const routeCount = sv ? 4 : 8;
  const routes = [];
  for (let i = 0; i < routeCount; i += 1) {
    routes.push(await R.create({ route_name: `${sv ? 'Vendor ' : ''}Demo Route ${String.fromCharCode(65 + i)}`, vehicle_id: vehicles[i].id, driver_id: drivers[i].id, max_km: [120, 150, 100, 180, 0, 140, 160, 110][i], extra_km_rate: [10, 12, 8, 15, 0, 9, 11, 10][i], status: 'active' }));
  }
  if (!sv) await R.create({ route_name: 'Demo Route Z (stopped)', vehicle_id: vehicles[8].id, driver_id: drivers[8].id, max_km: 90, extra_km_rate: 7, status: 'inactive' });
  step(`${scope}: ${vehicles.length} vehicles, ${drivers.length} drivers (+ rate history), ${routes.length} routes`);
  return { vehicles, drivers, routes };
}

/** Daily logs + fuel for every route vehicle, day by day, through the services. */
async function seedOperations(scope, { routes, vehicles }) {
  const sv = scope === 'sv';
  const from = sv ? monthStart(TODAY, -2) : START;
  let logs = 0;
  let fills = 0;
  for (const route of routes) {
    const vehicle = vehicles.find((v) => v.id === route.vehicle_id);
    const fuels = String(vehicle.fuel_type).split(',');
    let km = Number(vehicle.current_km);
    let sinceFill = 0;
    for (const date of days(from, YESTERDAY)) {
      // ~1 in 12 days off; the last route vehicle has no log yesterday ("Today's gaps")
      if (rand() < 0.08 || (date === YESTERDAY && route === routes[routes.length - 1])) continue;
      const run = between(70, Number(route.max_km) > 0 ? Number(route.max_km) + 60 : 220);
      const body = {
        vehicle_id: vehicle.id, driver_id: route.driver_id, date, opening_km: km, closing_km: km + run,
        income: sv ? 0 : pick([0, 0, 1800, 2200, 2500, 3200]), other_exp: rand() < 0.15 ? pick([50, 120, 200, 350]) : 0,
      };
      if (sv) Object.assign(body, { awb_number: `DEMOAWB${String(5000 + logs).padStart(6, '0')}`, vehicle_number: `DEMO ${between(100, 999)}`, on_load_charges: rand() < 0.4 ? pick([150, 250, 400]) : 0 });
      await dailyLogs.save(scope, null, body);
      logs += 1;
      km += run;
      sinceFill += run;
      if (sinceFill > between(350, 600)) {
        const type = fuels.length > 1 && rand() < 0.3 ? fuels[0] : fuels[fuels.length - 1];
        const kmpl = type === 'CNG' ? between(18, 26) : type === 'Petrol' ? between(14, 20) : between(11, 17);
        const liters = round2(sinceFill / kmpl);
        const price = { Diesel: 92.4, Petrol: 102.5, CNG: 88 }[type];
        await fuel.save(scope, null, { vehicle_id: vehicle.id, fuel_type: type, date, km_reading: km, liters, amount: round2(liters * price * (rand() < 0.1 ? 1.02 : 1)) });
        fills += 1;
        sinceFill = 0;
      }
    }
  }
  step(`${scope}: ${logs} daily logs, ${fills} fuel fills`);
}

async function seedAttendance(scope, drivers) {
  const sv = scope === 'sv';
  const active = drivers.filter((d) => d.status === 'active');
  let n = 0;
  for (const date of days(sv ? monthStart(TODAY, -2) : START, TODAY)) {
    // today: only half the drivers marked, so the dashboard shows "not marked"
    const list = date === TODAY ? active.slice(0, Math.ceil(active.length / 2)) : active;
    const statuses = {};
    for (const d of list) {
      const r = rand();
      statuses[d.id] = r < 0.86 ? 'present' : r < 0.94 ? 'absent' : 'leave';
    }
    await attendance.saveDay(scope, date, { statuses });
    n += list.length;
  }
  step(`${scope}: ${n} attendance marks`);
}

async function seedMaintenance(scope, vehicles) {
  const M = modelFor('maintenance', scope);
  const TYPES = ['Engine Oil', 'General Service', 'FC Renewal', 'Insurance', 'Pollution', 'Tires', 'Repairs'];
  const count = scope === 'sv' ? 5 : 26;
  const used = new Set();
  for (let i = 0; i < count; i += 1) {
    const v = vehicles[i % vehicles.length];
    let date = addDays(START, between(0, 120));
    while (used.has(`${v.id}|${date}`) || date > YESTERDAY) date = addDays(date, -1);
    used.add(`${v.id}|${date}`);
    const spares = pick([0, 450, 1200, 2800, 6500]);
    const labour = pick([300, 500, 800, 1500]);
    const type = TYPES[i % TYPES.length];
    await M.create({ vehicle_id: v.id, service_date: date, type, description: `${type} (demo record ${i + 1})`, km_reading: 15000 + i * 900, cost_spares: spares, cost_labour: labour, total_cost: spares + labour });
  }
  step(`${scope}: ${count} maintenance records`);
}

async function seedSalaryEntries(scope, drivers) {
  const T = modelFor('salaryTransactions', scope);
  const active = drivers.filter((d) => d.status === 'active');
  let n = 0;
  const add = async (d, type, amount, month, year, day, note) => {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    await T.create({ driver_id: d.id, type, amount, note, recorded_by: 'Admin', payment_date: date, month, year, created_at: new Date(`${date}T10:30:00+05:30`) });
    n += 1;
  };
  for (let m = -4; m <= 0; m += 1) {
    const [y, mo] = monthStart(TODAY, m).split('-').map(Number);
    for (const [i, d] of active.entries()) {
      if (rand() < 0.35) await add(d, 'advance', pick([1000, 2000, 3000, 5000]), mo, y, between(5, 20), 'Demo advance');
      if (m === 0) continue; // current month not paid yet
      if (rand() < 0.25) await add(d, 'deduction', pick([500, 1000]), mo, y, 28, 'Demo advance recovery');
      // older months fully paid; last month: some paid, some part paid, some pending
      const share = m < -1 ? 1 : [1, 0.5, 0, 1, 1, 0.6][i % 6];
      if (share > 0) await add(d, i % 3 === 0 ? 'weekly_salary' : 'monthly_salary', Math.round(Number(d.daily_rate) * 26 * share), mo, y, 28, share < 1 ? 'Demo part payment' : 'Demo salary paid');
    }
  }
  step(`${scope}: ${n} salary entries`);
}

async function seedOwnExtras(vehicles, drivers) {
  const rows = [
    ['Demo Bank Vehicle Loan EMI', 18500, 'monthly', 6, 0], ['Demo Finance EMI', 14200, 'monthly', 12, 1], ['Demo Credit EMI', 9800, 'monthly', 25, 2],
    ['Demo Insurance Renewal', 32000, 'yearly', 40, 3], ['Demo Policy Premium', 12000, 'quarterly', 3, null], ['Demo Office Rent', 15000, 'monthly', 20, null], ['Demo GPS Device', 7500, 'one-time', -10, 5],
  ];
  for (const [name, amount, frequency, due, vi] of rows) await models.Commitments.create({ name, amount, frequency, due_date: addDays(TODAY, due), vehicle_id: vi === null ? null : vehicles[vi].id });
  for (let i = 0; i < 9; i += 1) {
    await reports.saveManualIncome(null, { vehicle_id: vehicles[i % 6].id, date: addDays(START, between(5, 115)), amount: pick([2500, 4000, 6500, 8000]), description: pick(['Demo target bonus', 'Demo extra trip', 'Demo festival bonus']) });
  }
  // Old salaries table (not used by the new app; a few rows like production has)
  for (const d of drivers.slice(0, 3)) await models.Salaries.create({ driver_id: d.id, month: Number(START.slice(5, 7)), year: Number(START.slice(0, 4)), advance: 0, paid: 15000, payment_date: addDays(START, 29) });
  const quotes = [
    ['Monthly transport contract', 'Q-DEMO-001', 'Demo Client One'],
    ['Warehouse to retail distribution', 'Q-DEMO-002', 'Demo Client Two'],
    ['Event logistics – 3 days', 'Q-DEMO-003', 'Demo Client Three'],
  ];
  for (const [i, [title, number, client]] of quotes.entries()) {
    await quotations.save(null, {
      title, quote_number: number, quote_date: addDays(TODAY, -20 + i * 7), effective_date: addDays(TODAY, -10 + i * 7),
      to_name: client, to_address: `${i + 1}, Sample Road, Demo City`, to_gst: `33DEMO0000${i}A1Z0`, to_phone: `90000${String(20000 + i).padStart(5, '0')}`,
      content: `<p>Dear Sir/Madam,</p><p>We are pleased to quote for <strong>${title.toLowerCase()}</strong>.</p><ul><li>Vehicle: small goods carrier</li><li>Rate: ₹${(2200 + i * 300).toLocaleString('en-IN')} per day (up to 120 km)</li><li>Extra km: ₹12 per km</li></ul><p>Thank you.</p>`,
    });
  }
  step('own: 7 commitments, 9 manual incomes, 3 old salary rows, 3 quotations');
}

async function seedCharges(vehicles) {
  let n = 0;
  for (const date of days(monthStart(TODAY, -2), YESTERDAY)) {
    if (rand() < 0.5) continue;
    await charges.save(null, { vehicle_id: pick(vehicles).id, date, awb_number: `DEMOAWB${between(100000, 999999)}`, mbox_number: `DEMOMB${between(1000, 9999)}`, loading_charge: pick([300, 450, 600, 850]) });
    n += 1;
  }
  step(`sv: ${n} loading charges`);
}

// ---------------------------------------------------------------- main
async function main() {
  if (env.isProd) throw new Error('Refusing to run in production');
  if (!/_dev$/.test(env.DB_NAME)) throw new Error(`Refusing: database "${env.DB_NAME}" does not end in _dev`);
  if (!args.includes('--yes')) throw new Error(`This deletes ALL data in ${env.DB_NAME} (except sessions). Re-run with --yes`);

  const list = await tables();
  if (!args.includes('--no-backup')) console.log(`Backup: ${await backup(list)}`);
  await wipe(list);
  console.log(`Wiped ${list.length - KEEP.length} tables in ${env.DB_NAME}; seeding demo data ${START} … ${TODAY}`);

  await seedSettings();
  const own = await seedFleet('own');
  const sv = await seedFleet('sv');
  await seedOperations('own', own);
  await seedOperations('sv', sv);
  await seedAttendance('own', own.drivers);
  await seedAttendance('sv', sv.drivers);
  await seedMaintenance('own', own.vehicles);
  await seedMaintenance('sv', sv.vehicles);
  await seedSalaryEntries('own', own.drivers);
  await seedSalaryEntries('sv', sv.drivers);
  await seedOwnExtras(own.vehicles, own.drivers);
  await seedCharges(sv.vehicles);

  console.log('\nRows per table:');
  for (const t of list) {
    const [[{ n }]] = await sequelize.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    console.log(`  ${t.padEnd(34)} ${n}`);
  }
}

main()
  .catch((err) => {
    console.error(`\n${err.stack || err.message}`);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
