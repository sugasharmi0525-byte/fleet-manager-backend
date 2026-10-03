/*
 * Entity configs for the generic CRUD router. Each rule notes the PHP page it was copied from.
 * Scope ('own' | 'sv') is resolved per request; entities missing from a scope return 404
 * (see services/scope.js).
 */
const { Op } = require('sequelize');
const { HttpError } = require('../middleware/errorHandler');
const { modelFor } = require('../services/scope');
const { z, money, int, id, optionalId, date, optionalDate, text } = require('../utils/validation');
const { today } = require('../utils/dates');

const FUEL_TYPES = ['CNG', 'Petrol', 'Diesel'];
const TAX_STATUSES = ['', 'No Tax End', 'Other'];

// ---------------------------------------------------------------- vehicles (vehicles.php)
const vehicles = {
  entity: 'vehicles',
  path: 'vehicles',
  label: 'Vehicle',
  upload: ['fc_pdf', 'ins_pdf', 'pol_pdf'],
  // Multipart forms send fuel_type as one value or several; store as "Petrol,Diesel".
  fromBody: (body) => {
    const raw = body['fuel_type[]'] ?? body.fuel_type;
    const list = (Array.isArray(raw) ? raw : String(raw ?? '').split(',')).map((s) => String(s).trim()).filter(Boolean);
    return { ...body, fuel_type: list };
  },
  schema: z.object({
    reg_no: text(20, { label: 'Registration No' }),
    make: text(50, { label: 'Make' }),
    model_year: z.coerce.string().regex(/^\d{4}$/, 'Year must be 4 digits'),
    type: text(50, { label: 'Type' }),
    fuel_type: z.array(z.enum(FUEL_TYPES)).transform((list) => [...new Set(list)].join(',')),
    deck: z.enum(['open', 'closed']).default('open'),
    fc_expiry: date('FC expiry'),
    insurance_expiry: date('Insurance expiry'),
    pollution_expiry: date('Pollution expiry'),
    tax_status: z.preprocess((v) => v ?? '', z.enum(TAX_STATUSES)),
    tax_expiry: text(255, { optional: true, label: 'Tax info' }),
    fine_amount: money(),
    car_value: money(),
    petrol_price: money(),
    diesel_price: money(),
    cng_price: money(),
  }),
  prepare: (data) => {
    // Tax info follows the status, as the PHP form's toggleTaxInput() did.
    let taxExpiry = data.tax_expiry;
    if (data.tax_status === '') taxExpiry = '';
    if (data.tax_status === 'No Tax End') taxExpiry = 'No Tax End';
    if (data.tax_status === 'Other' && !taxExpiry) throw new HttpError(400, 'Tax info is required when tax status is Other');
    // vehicles.php: "max_km_per_day removed from UI, defaulting to 0" on every save.
    return { ...data, tax_expiry: taxExpiry, max_km_per_day: 0 };
  },
  beforeCreate: async (data, { model, transaction }) => {
    const existing = await model.findOne({ where: { reg_no: data.reg_no }, attributes: ['id'], transaction });
    if (existing) throw new HttpError(409, 'Registration No already exists. Edit the existing vehicle instead.');
  },
  list: { order: [['created_at', 'DESC']] },
  options: {
    attributes: ['reg_no', 'fuel_type', 'petrol_price', 'diesel_price', 'cng_price'],
    label: 'reg_no',
    where: () => ({ status: 'active' }),
    order: [['reg_no', 'ASC']],
  },
};

// ---------------------------------------------------------------- drivers (drivers.php)
const drivers = {
  entity: 'drivers',
  path: 'drivers',
  label: 'Driver',
  schema: z.object({
    name: text(100, { label: 'Name' }),
    phone: text(20, { label: 'Phone' }),
    daily_rate: money(),
    status: z.enum(['active', 'inactive']).default('active'),
  }),
  // New drivers start with a rate-history row dated today.
  afterCreate: async (record, data, { scope, transaction }) => {
    await modelFor('driverRates', scope).create(
      { driver_id: record.id, daily_rate: data.daily_rate, effective_date: today() },
      { transaction }
    );
  },
  softDelete: { status: 'deleted' },
  list: { where: () => ({ status: { [Op.ne]: 'deleted' } }), order: [['name', 'ASC']] },
  options: { attributes: ['name'], label: 'name', where: () => ({ status: 'active' }), order: [['name', 'ASC']] },
  // POST /:id/rate — revise the daily rate from a date (history row + driver update).
  extend: (router) => {
    const { sequelize } = require('../models');
    const { parseBody } = require('../utils/validation');
    const { audit } = require('../utils/audit');
    const { toId } = require('./crudRouter');
    const schema = z.object({ new_rate: money(), effective_date: date('Effective date') });

    router.post('/:id/rate', async (req, res) => {
      const driverId = toId(req.params.id);
      const { scope } = req.params;
      const { new_rate: rate, effective_date: effectiveDate } = parseBody(schema, req.body);
      const Drivers = modelFor('drivers', scope);

      const driver = await sequelize.transaction(async (transaction) => {
        const found = await Drivers.findByPk(driverId, { transaction });
        if (!found || found.status === 'deleted') throw new HttpError(404, 'Driver not found');
        await modelFor('driverRates', scope).create(
          { driver_id: driverId, daily_rate: rate, effective_date: effectiveDate },
          { transaction }
        );
        await found.update({ daily_rate: rate }, { transaction });
        return found;
      });

      audit(req, { action: 'revise-rate', scope, entity: 'drivers', id: driverId, rate, effectiveDate });
      res.json(driver);
    });
  },
};

// ---------------------------------------------------------------- routes (routes.php)
const routes = {
  entity: 'routes',
  path: 'routes',
  label: 'Route',
  schema: z.object({
    route_name: text(100, { label: 'Route name' }),
    vehicle_id: id('Vehicle'),
    driver_id: id('Driver'),
    max_km: int(),
    extra_km_rate: money(),
  }),
  list: {
    pageSize: 10,
    search: ['route_name'],
    filters: { vehicle_id: 'vehicle_id', driver_id: 'driver_id' },
    include: [
      { as: 'vehicle', attributes: ['id', 'reg_no'] },
      { as: 'driver', attributes: ['id', 'name'] },
    ],
    order: [['route_name', 'ASC']],
  },
};

// ---------------------------------------------------------------- maintenance (maintenance.php)
const MAINTENANCE_TYPES = ['Engine Oil', 'General Service', 'FC Renewal', 'Insurance', 'Pollution', 'Tires', 'Repairs'];

const maintenance = {
  entity: 'maintenance',
  path: 'maintenance',
  label: 'Maintenance record',
  schema: z.object({
    vehicle_id: id('Vehicle'),
    service_date: date('Service date'),
    type: z.enum(MAINTENANCE_TYPES),
    description: text(5000, { optional: true }),
    km_reading: z.coerce.number({ message: 'KM reading is required' }).int().min(0),
    cost_spares: money(),
    cost_labour: money(),
  }),
  prepare: (data) => ({ ...data, total_cost: Math.round((data.cost_spares + data.cost_labour) * 100) / 100 }),
  // One record per vehicle per date, checked on add only (as in PHP).
  beforeCreate: async (data, { model, transaction }) => {
    const existing = await model.findOne({
      where: { vehicle_id: data.vehicle_id, service_date: data.service_date },
      attributes: ['id'],
      transaction,
    });
    if (existing) throw new HttpError(409, 'A maintenance record for this vehicle on this date already exists. Edit it instead.');
  },
  list: {
    pageSize: 10,
    filters: { vehicle_id: 'vehicle_id' },
    include: [{ as: 'vehicle', attributes: ['id', 'reg_no'] }],
    order: [['service_date', 'DESC']],
  },
};

// ---------------------------------------------------------------- commitments (commitments.php, own only)
const commitments = {
  entity: 'commitments',
  path: 'commitments',
  label: 'Commitment',
  schema: z.object({
    name: text(100, { label: 'Name' }),
    amount: z.coerce.number({ message: 'Amount is required' }).min(0),
    frequency: z.enum(['monthly', 'quarterly', 'yearly', 'one-time']).default('monthly'),
    due_date: optionalDate(),
    vehicle_id: optionalId(),
  }),
  list: {
    include: [{ as: 'vehicle', attributes: ['id', 'reg_no'] }],
    order: [['due_date', 'ASC']],
  },
};

module.exports = { ENTITY_CONFIGS: [vehicles, drivers, routes, maintenance, commitments], MAINTENANCE_TYPES, FUEL_TYPES };
