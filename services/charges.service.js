/*
 * Sub-vendor loading charges — rules copied from car-v1/sv_charges.php.
 */
const { QueryTypes } = require('sequelize');
const { sequelize, models } = require('../models');
const { HttpError } = require('../middleware/errorHandler');
const { z, id, date, text, parseBody } = require('../utils/validation');
const { today } = require('../utils/dates');

const { pageParams } = require('../utils/pagination');

const PAGE_SIZE = 10;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const select = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });

function monthBounds() {
  const [y, m] = today().split('-').map(Number);
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` };
}

/** GET /sv/charges?from_date&to_date&search&vehicle_id&page — with the period total. */
async function list(query) {
  const def = monthBounds();
  const from = ISO.test(query.from_date || '') ? query.from_date : def.from;
  const to = ISO.test(query.to_date || '') ? query.to_date : def.to;
  const search = String(query.search || '').trim().slice(0, 100);
  const vehicleId = Number.parseInt(query.vehicle_id, 10) || 0;
  const { page, limit, offset } = pageParams(query, PAGE_SIZE);

  let where = ' WHERE c.date BETWEEN ? AND ?';
  const params = [from, to];
  if (search) {
    where += ' AND (c.awb_number LIKE ? OR c.mbox_number LIKE ? OR v.reg_no LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (vehicleId) {
    where += ' AND c.vehicle_id=?';
    params.push(vehicleId);
  }
  const joins = ' FROM sub_vendor_charges c JOIN sub_vendor_vehicles v ON v.id=c.vehicle_id ';
  const [[sum], [count], rows] = await Promise.all([
    select(`SELECT COALESCE(SUM(c.loading_charge),0) AS n${joins}${where}`, params),
    select(`SELECT COUNT(*) AS n${joins}${where}`, params),
    select(`SELECT c.*,v.reg_no${joins}${where} ORDER BY c.date DESC,c.id DESC LIMIT ${limit} OFFSET ${offset}`, params),
  ]);
  const total = Number(count.n) || 0;
  return { from_date: from, to_date: to, total_charge: Number(sum.n) || 0, rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

/** Vehicles for the filter and the form (status active or in maintenance). */
function vehicleOptions() {
  return select("SELECT id,reg_no FROM sub_vendor_vehicles WHERE status IN ('active','sub_vendor_maintenance') ORDER BY reg_no");
}

const schema = z.object({
  vehicle_id: id('Vehicle'),
  date: date('Date'),
  awb_number: text(100, { optional: true, label: 'AWB number' }),
  mbox_number: text(100, { optional: true, label: 'Mbox number' }),
  // PHP: max(0, (float) loading_charge)
  loading_charge: z.preprocess((v) => (v === '' || v == null ? 0 : v), z.coerce.number().max(99_999_999.99)).transform((v) => Math.max(0, v)),
});

async function save(chargeId, body) {
  const data = parseBody(schema, body);
  const vehicle = await models.SubVendorVehicles.findByPk(data.vehicle_id, { attributes: ['id'] });
  if (!vehicle) throw new HttpError(400, 'Vehicle not found', { vehicle_id: 'Vehicle not found' });
  if (chargeId) {
    const row = await models.SubVendorCharges.findByPk(chargeId);
    if (!row) throw new HttpError(404, 'Charge record not found');
    await row.update(data);
    return row.get({ plain: true });
  }
  const row = await models.SubVendorCharges.create(data);
  return row.get({ plain: true });
}

async function remove(chargeId) {
  const deleted = await models.SubVendorCharges.destroy({ where: { id: chargeId } });
  if (!deleted) throw new HttpError(404, 'Charge record not found');
}

module.exports = { PAGE_SIZE, list, vehicleOptions, save, remove };
