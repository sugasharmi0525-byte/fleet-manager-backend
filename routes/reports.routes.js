/*
 * Reports: /api/:scope/reports/..., manual incomes (/api/own/manual-incomes) and
 * sub-vendor loading charges (/api/sv/charges).
 * Rules live in services/report.service.js.
 */
const { Router } = require('express');
const validateScope = require('../middleware/validateScope');
const { toId } = require('../crud/crudRouter');
const { HttpError } = require('../middleware/errorHandler');
const { audit } = require('../utils/audit');
const reports = require('../services/report.service');
const charges = require('../services/charges.service');

const router = Router();

const ownOnly = (req, res, next) => (req.params.scope === 'own' ? next() : next(new HttpError(404, 'This report is only for the own fleet')));

const r = Router({ mergeParams: true });
r.get('/options/:report', async (req, res) => res.json(await reports.options(req.params.scope, req.params.report)));
r.get('/financial/by-month', async (req, res) => res.json(await reports.financialByMonth(req.params.scope, req.query)));
r.get('/financial', async (req, res) => res.json(await reports.financial(req.params.scope, req.query)));
r.get('/monthly', async (req, res) => res.json(await reports.monthly(req.params.scope, req.query)));
r.get('/fuel', ownOnly, async (req, res) => res.json(await reports.fuel(req.query)));
r.get('/maintenance', ownOnly, async (req, res) => res.json(await reports.maintenance(req.query)));
router.use('/:scope/reports', validateScope, r);

// Manual incomes belong to own-fleet vehicles (save_income.php).
const income = Router();
income.post('/', async (req, res) => {
  const row = await reports.saveManualIncome(null, req.body);
  audit(req, { action: 'create', scope: 'own', entity: 'manualIncomes', id: row.id, vehicleId: row.vehicle_id, amount: row.amount });
  res.status(201).json(row);
});
income.put('/:id', async (req, res) => {
  const id = toId(req.params.id);
  const row = await reports.saveManualIncome(id, req.body);
  audit(req, { action: 'update', scope: 'own', entity: 'manualIncomes', id, amount: row.amount });
  res.json(row);
});
income.delete('/:id', async (req, res) => {
  const id = toId(req.params.id);
  await reports.removeManualIncome(id);
  audit(req, { action: 'delete', scope: 'own', entity: 'manualIncomes', id });
  res.json({ ok: true });
});
router.use('/own/manual-incomes', income);

// Sub-vendor loading charges (sv_charges.php).
const ch = Router();
ch.get('/', async (req, res) => res.json(await charges.list(req.query)));
ch.get('/vehicles', async (req, res) => res.json(await charges.vehicleOptions()));
ch.post('/', async (req, res) => {
  const row = await charges.save(null, req.body);
  audit(req, { action: 'create', scope: 'sv', entity: 'charges', id: row.id, vehicleId: row.vehicle_id, amount: row.loading_charge });
  res.status(201).json(row);
});
ch.put('/:id', async (req, res) => {
  const id = toId(req.params.id);
  const row = await charges.save(id, req.body);
  audit(req, { action: 'update', scope: 'sv', entity: 'charges', id, amount: row.loading_charge });
  res.json(row);
});
ch.delete('/:id', async (req, res) => {
  const id = toId(req.params.id);
  await charges.remove(id);
  audit(req, { action: 'delete', scope: 'sv', entity: 'charges', id });
  res.json({ ok: true });
});
router.use('/sv/charges', ch);

module.exports = router;
