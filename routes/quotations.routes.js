/*
 * Quotations: /api/quotations (own business, no scope). Rules live in services/quotation.service.js.
 */
const { Router } = require('express');
const { toId } = require('../crud/crudRouter');
const { audit } = require('../utils/audit');
const quotations = require('../services/quotation.service');

const router = Router();

router.get('/', async (req, res) => res.json(await quotations.list()));
router.get('/:id', async (req, res) => res.json(await quotations.get(toId(req.params.id))));
router.get('/:id/view', async (req, res) => res.json(await quotations.view(toId(req.params.id))));
router.post('/', async (req, res) => {
  const row = await quotations.save(null, req.body);
  audit(req, { action: 'create', entity: 'quotations', id: row.id, quoteNumber: row.quote_number });
  res.status(201).json(row);
});
router.put('/:id', async (req, res) => {
  const id = toId(req.params.id);
  const row = await quotations.save(id, req.body);
  audit(req, { action: 'update', entity: 'quotations', id, quoteNumber: row.quote_number });
  res.json(row);
});
router.delete('/:id', async (req, res) => {
  const id = toId(req.params.id);
  await quotations.remove(id);
  audit(req, { action: 'delete', entity: 'quotations', id });
  res.json({ ok: true });
});

module.exports = router;
