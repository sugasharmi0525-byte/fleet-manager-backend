/*
 * Driver attendance — rules copied from car-v1/attendance.php (sv_attendance.php for 'sv').
 * Views: mark (one date), history (list with filters) and monthly grid.
 */
const { Op, QueryTypes } = require('sequelize');
const { sequelize } = require('../models');
const { modelFor, tableFor } = require('./scope');
const { HttpError } = require('../middleware/errorHandler');
const { z, date, parseBody } = require('../utils/validation');
const { pageParams, pageResult } = require('../utils/pagination');

const STATUSES = ['present', 'absent', 'leave'];
const HISTORY_PAGE_SIZE = 10;

const activeDrivers = (scope) =>
  modelFor('drivers', scope).findAll({ where: { status: 'active' }, attributes: ['id', 'name'], order: [['name', 'ASC']], raw: true });

const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

function monthYear(query, { required }) {
  const month = Number.parseInt(query.month, 10);
  const year = Number.parseInt(query.year, 10);
  const validMonth = month >= 1 && month <= 12 ? month : null;
  const validYear = year >= 2000 && year <= 2100 ? year : null;
  if (required && (!validMonth || !validYear)) throw new HttpError(400, 'Choose a month and year');
  return { month: validMonth, year: validYear };
}

/** Mark view: active drivers with their status for the date (unmarked = absent, as in PHP). */
async function day(scope, dateValue) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue || '')) throw new HttpError(400, 'Invalid date');
  const drivers = await activeDrivers(scope);
  const rows = await modelFor('attendance', scope).findAll({ where: { date: dateValue }, attributes: ['driver_id', 'status'], raw: true });
  const marked = Object.fromEntries(rows.map((r) => [r.driver_id, r.status]));
  // Vehicle on each driver's active route, shown under the name on the tiles (gap review).
  const routeRows = await sequelize.query(
    `SELECT r.driver_id, v.reg_no FROM \`${tableFor('routes', scope)}\` r JOIN \`${tableFor('vehicles', scope)}\` v ON v.id = r.vehicle_id
      WHERE r.status = 'active' ORDER BY r.id`,
    { type: QueryTypes.SELECT }
  );
  const vehicleOf = {};
  for (const r of routeRows) if (!(r.driver_id in vehicleOf)) vehicleOf[r.driver_id] = r.reg_no;
  return {
    date: dateValue,
    alreadyMarked: rows.length > 0,
    drivers: drivers.map((d) => ({ ...d, status: marked[d.id] || 'absent', marked: d.id in marked, reg_no: vehicleOf[d.id] || null })),
  };
}

const saveDaySchema = z.object({
  statuses: z.record(z.string().regex(/^\d+$/), z.enum(STATUSES), { message: 'Statuses are required' }),
});

/** Saves a whole day: deletes every row for the date, then inserts the submitted statuses. */
async function saveDay(scope, dateValue, body) {
  parseBody(z.object({ date: date('Date') }), { date: dateValue });
  const { statuses } = parseBody(saveDaySchema, body);
  const Attendance = modelFor('attendance', scope);
  const rows = Object.entries(statuses).map(([driverId, status]) => ({ driver_id: Number(driverId), date: dateValue, status }));

  await sequelize.transaction(async (transaction) => {
    await Attendance.destroy({ where: { date: dateValue }, transaction });
    if (scope === 'sv' && rows.length) {
      // sub_vendor_attendance.id has no AUTO_INCREMENT (in production too); PHP inserted without an id
      // and MariaDB stored 0. Give each new row the next free id instead.
      const [[{ maxId }]] = await sequelize.query(`SELECT COALESCE(MAX(id), 0) AS maxId FROM ${tableFor('attendance', scope)} FOR UPDATE`, { transaction });
      rows.forEach((r, i) => Object.assign(r, { id: Number(maxId) + i + 1 }));
    }
    if (rows.length) await Attendance.bulkCreate(rows, { transaction });
  });
  return { date: dateValue, saved: rows.length };
}

/** History view: rows with driver name, newest first, 20 per page; totals when one driver is chosen. */
async function history(scope, query) {
  const Attendance = modelFor('attendance', scope);
  const where = {};
  const driverId = Number.parseInt(query.driver_id, 10) || null;
  const { month, year } = monthYear(query, { required: false });
  if (driverId) where.driver_id = driverId;
  const dateConds = [];
  if (month) dateConds.push(sequelize.where(sequelize.fn('MONTH', sequelize.col(`${Attendance.name}.date`)), month));
  if (year) dateConds.push(sequelize.where(sequelize.fn('YEAR', sequelize.col(`${Attendance.name}.date`)), year));
  if (dateConds.length) where[Op.and] = dateConds;

  const { page, limit, offset } = pageParams(query, HISTORY_PAGE_SIZE);
  const { rows, count } = await Attendance.findAndCountAll({
    where,
    include: [{ association: 'driver', attributes: ['id', 'name'], required: true }],
    order: [['date', 'DESC'], [{ model: modelFor('drivers', scope), as: 'driver' }, 'name', 'ASC']],
    limit,
    offset,
    // raw rows: Sequelize would otherwise merge old sub-vendor rows that share an id (see below)
    raw: true,
    nest: true,
  });

  // Old sub-vendor rows can share an id (PHP saved many with id 0); they can't be edited or
  // deleted on their own, so the page shows them locked.
  const ids = [...new Set(rows.map((r) => r.id))];
  const shared = new Set();
  if (scope === 'sv' && ids.length) {
    const dupes = await Attendance.findAll({ where: { id: ids }, attributes: ['id'], group: ['id'], having: sequelize.literal('COUNT(*) > 1'), raw: true });
    dupes.forEach((d) => shared.add(d.id));
  }
  const out = rows.map((r) => ({ ...r, locked: r.id === 0 || shared.has(r.id) }));

  let summary = null;
  if (driverId) {
    const all = await Attendance.findAll({ where, attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'n']], group: ['status'], raw: true });
    const byStatus = Object.fromEntries(all.map((r) => [r.status, Number(r.n)]));
    summary = { present: byStatus.present || 0, absent: byStatus.absent || 0, leave: byStatus.leave || 0 };
  }
  return { ...pageResult(out, count, page, limit), summary };
}

/** Monthly grid: status per active driver per day, plus per-driver and per-day totals. */
async function monthly(scope, query) {
  const { month, year } = monthYear(query, { required: true });
  const days = daysInMonth(year, month);
  const drivers = await activeDrivers(scope);
  const rows = await sequelize.query(
    `SELECT driver_id, DAY(date) AS day, status FROM \`${tableFor('attendance', scope)}\`
      WHERE MONTH(date) = ? AND YEAR(date) = ?`,
    { replacements: [month, year], type: QueryTypes.SELECT }
  );

  const grid = {};
  const dayTotals = Array.from({ length: days }, () => ({ present: 0, absent: 0, leave: 0 }));
  for (const r of rows) {
    const status = String(r.status).toLowerCase();
    (grid[r.driver_id] ||= {})[r.day] = status;
    if (dayTotals[r.day - 1] && status in dayTotals[r.day - 1]) dayTotals[r.day - 1][status] += 1;
  }

  return {
    month,
    year,
    days,
    dayTotals,
    drivers: drivers.map((d) => {
      const statuses = grid[d.id] || {};
      const totals = { present: 0, absent: 0, leave: 0 };
      for (const s of Object.values(statuses)) if (s in totals) totals[s] += 1;
      return { ...d, statuses, totals };
    }),
  };
}

/**
 * Old sub-vendor rows can share an id (PHP saved many with id 0), and PHP's edit/delete by id
 * changed all of them at once. Refuse instead; the day can still be changed from the Mark view.
 */
async function assertSingleRow(scope, idParam) {
  const count = await modelFor('attendance', scope).count({ where: { id: idParam } });
  if (count === 0) throw new HttpError(404, 'Attendance record not found');
  if (count > 1) throw new HttpError(409, `This old entry shares its id with ${count - 1} other entries, so it can't be changed on its own. Change it from the Mark attendance view for its date.`);
}

async function updateOne(scope, idParam, body) {
  const { status } = parseBody(z.object({ status: z.enum(STATUSES) }), body);
  await assertSingleRow(scope, idParam);
  const record = await modelFor('attendance', scope).findByPk(idParam);
  return record.update({ status });
}

async function removeOne(scope, idParam) {
  await assertSingleRow(scope, idParam);
  await modelFor('attendance', scope).destroy({ where: { id: idParam } });
}

module.exports = { day, saveDay, history, monthly, updateOne, removeOne, STATUSES };
