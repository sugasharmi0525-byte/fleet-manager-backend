/*
 * Single-row settings tables: GET returns the row (or defaults), PUT updates the first row
 * or creates it, as settings.php and quote_settings.php did.
 */
const { Router } = require('express');
const { models } = require('../models');
const { z, money, text, parseBody } = require('../utils/validation');
const { audit } = require('../utils/audit');

function singletonRouter({ model, schema, defaults, entity }) {
  const router = Router();

  router.get('/', async (req, res) => {
    const row = await model.findOne({ order: [['id', 'ASC']] });
    res.json(row || defaults);
  });

  router.put('/', async (req, res) => {
    const data = parseBody(schema, req.body);
    const existing = await model.findOne({ order: [['id', 'ASC']] });
    const row = existing ? await existing.update(data) : await model.create(data);
    audit(req, { action: existing ? 'update' : 'create', entity, id: row.id });
    res.json(row);
  });

  return router;
}

// settings.php — global fuel prices (vehicle prices override these when above 0)
const appSettings = singletonRouter({
  model: models.AppSettings,
  entity: 'app_settings',
  defaults: { global_petrol_price: 0, global_diesel_price: 0, global_cng_price: 0 },
  schema: z.object({ global_petrol_price: money(), global_diesel_price: money(), global_cng_price: money() }),
});

// quote_settings.php — company header printed on quotations
const quoteSettings = singletonRouter({
  model: models.QuoteSettings,
  entity: 'quote_settings',
  defaults: { company_name: '', address: '', phone: '', gst_no: '', pan_no: '', email: '' },
  schema: z.object({
    company_name: text(255, { label: 'Company name' }),
    address: text(2000, { optional: true }),
    phone: text(50, { optional: true }),
    email: z.preprocess((v) => (v == null ? '' : String(v).trim()), z.union([z.literal(''), z.email('Invalid email').max(100)])),
    gst_no: text(50, { optional: true }),
    pan_no: text(50, { optional: true }),
  }),
});

module.exports = { appSettings, quoteSettings };
