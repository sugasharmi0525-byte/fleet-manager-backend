/*
 * Daily operations: daily logs, fuel, attendance (scoped: /api/:scope/...) and the dashboard.
 * Business rules live in services/*; these handlers only read the request and audit writes.
 */
const { Router } = require('express');
const validateScope = require('../middleware/validateScope');
const { toId } = require('../crud/crudRouter');
const { audit } = require('../utils/audit');
const dailyLogs = require('../services/dailyLog.service');
const fuel = require('../services/fuel.service');
const attendance = require('../services/attendance.service');
const dashboard = require('../services/dashboard.service');
const insights = require('../services/insights.service');

const router = Router();

// ---- Daily logs: /api/:scope/daily-logs
const logs = Router({ mergeParams: true });
logs.get('/', async (req, res) => res.json(await dailyLogs.list(req.params.scope, req.query)));
logs.get('/summary', async (req, res) => res.json(await insights.dailyLogSummary(req.params.scope, req.query)));
logs.get('/last-km', async (req, res) => res.json(await dailyLogs.lastKm(req.params.scope, toId(req.query.vehicle_id))));
logs.get('/route-mappings', async (req, res) => res.json(await dailyLogs.routeMappings(req.params.scope)));
logs.post('/', async (req, res) => {
  const row = await dailyLogs.save(req.params.scope, null, req.body);
  audit(req, { action: 'create', scope: req.params.scope, entity: 'dailyLogs', id: row.id });
  res.status(201).json(row);
});
logs.put('/:id', async (req, res) => {
  const id = toId(req.params.id);
  const row = await dailyLogs.save(req.params.scope, id, req.body);
  audit(req, { action: 'update', scope: req.params.scope, entity: 'dailyLogs', id });
  res.json(row);
});
logs.delete('/:id', async (req, res) => {
  const id = toId(req.params.id);
  await dailyLogs.remove(req.params.scope, id);
  audit(req, { action: 'delete', scope: req.params.scope, entity: 'dailyLogs', id });
  res.json({ ok: true });
});
router.use('/:scope/daily-logs', validateScope, logs);

// ---- Fuel: /api/:scope/fuel
const fuelRouter = Router({ mergeParams: true });
fuelRouter.get('/', async (req, res) => res.json(await fuel.list(req.params.scope, req.query)));
fuelRouter.get('/vehicles', async (req, res) => res.json(await fuel.vehicleOptions(req.params.scope)));
fuelRouter.post('/', async (req, res) => {
  const row = await fuel.save(req.params.scope, null, req.body);
  audit(req, { action: 'create', scope: req.params.scope, entity: 'fuel', id: row.id });
  res.status(201).json(row);
});
fuelRouter.put('/:id', async (req, res) => {
  const id = toId(req.params.id);
  const row = await fuel.save(req.params.scope, id, req.body);
  audit(req, { action: 'update', scope: req.params.scope, entity: 'fuel', id });
  res.json(row);
});
fuelRouter.delete('/:id', async (req, res) => {
  const id = toId(req.params.id);
  await fuel.remove(req.params.scope, id);
  audit(req, { action: 'delete', scope: req.params.scope, entity: 'fuel', id });
  res.json({ ok: true });
});
router.use('/:scope/fuel', validateScope, fuelRouter);

// ---- Attendance: /api/:scope/attendance
const att = Router({ mergeParams: true });
att.get('/day', async (req, res) => res.json(await attendance.day(req.params.scope, req.query.date)));
att.put('/day/:date', async (req, res) => {
  const result = await attendance.saveDay(req.params.scope, req.params.date, req.body);
  audit(req, { action: 'save-day', scope: req.params.scope, entity: 'attendance', date: req.params.date, rows: result.saved });
  res.json(result);
});
att.get('/history', async (req, res) => res.json(await attendance.history(req.params.scope, req.query)));
att.get('/monthly', async (req, res) => res.json(await attendance.monthly(req.params.scope, req.query)));
att.patch('/:id', async (req, res) => {
  const id = toId(req.params.id);
  const row = await attendance.updateOne(req.params.scope, id, req.body);
  audit(req, { action: 'update', scope: req.params.scope, entity: 'attendance', id });
  res.json(row);
});
att.delete('/:id', async (req, res) => {
  const id = toId(req.params.id);
  await attendance.removeOne(req.params.scope, id);
  audit(req, { action: 'delete', scope: req.params.scope, entity: 'attendance', id });
  res.json({ ok: true });
});
router.use('/:scope/attendance', validateScope, att);

// ---- Dashboard (own fleet): /api/dashboard
router.get('/dashboard', async (req, res) => res.json(await dashboard.summary(req.query.period)));

module.exports = router;
