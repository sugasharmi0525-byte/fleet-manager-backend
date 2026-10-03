/*
 * Payroll (scoped): /api/:scope/salaries and /api/:scope/salary-transactions.
 * Rules live in services/salary.service.js.
 */
const { Router } = require('express');
const validateScope = require('../middleware/validateScope');
const { toId } = require('../crud/crudRouter');
const { audit } = require('../utils/audit');
const salaries = require('../services/salary.service');

const router = Router();

const payroll = Router({ mergeParams: true });
payroll.get('/', async (req, res) => res.json(await salaries.list(req.params.scope, req.query)));
payroll.get('/:driverId/stats', async (req, res) => res.json(await salaries.stats(req.params.scope, toId(req.params.driverId), req.query)));
payroll.get('/:driverId/history', async (req, res) => res.json(await salaries.history(req.params.scope, toId(req.params.driverId), req.query)));
router.use('/:scope/salaries', validateScope, payroll);

const trans = Router({ mergeParams: true });
trans.get('/', async (req, res) => res.json(await salaries.monthTransactions(req.params.scope, req.query)));
trans.post('/', async (req, res) => {
  const row = await salaries.create(req.params.scope, req.body, req.session?.user?.username);
  audit(req, { action: 'create', scope: req.params.scope, entity: 'salaryTransactions', id: row.id, type: row.type, amount: row.amount, driverId: row.driver_id });
  res.status(201).json(row);
});
trans.put('/:id', async (req, res) => {
  const id = toId(req.params.id);
  const row = await salaries.update(req.params.scope, id, req.body);
  audit(req, { action: 'update', scope: req.params.scope, entity: 'salaryTransactions', id, type: row.type, amount: row.amount });
  res.json(row);
});
trans.delete('/:id', async (req, res) => {
  const id = toId(req.params.id);
  await salaries.remove(req.params.scope, id);
  audit(req, { action: 'delete', scope: req.params.scope, entity: 'salaryTransactions', id });
  res.json({ ok: true });
});
router.use('/:scope/salary-transactions', validateScope, trans);

module.exports = router;
