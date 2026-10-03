/*
 * Phase 11 check: quotations add / edit / view / delete, HTML cleaning and validation, end to end
 * against the dev database. Test records are removed at the end.
 *
 *   npm run check:quotations -w server
 */
const { Op } = require('sequelize');
const { models, sequelize } = require('../models');
const { createHarness } = require('./lib/harness');

const { expect, section, call, run } = createHarness('quotations-check');

const body = {
  title: 'ZZTEST Transport contract',
  quote_number: 'Q-ZZ01',
  quote_date: '2099-01-10',
  effective_date: '2099-02-09',
  to_name: 'ZZTEST Client',
  to_address: 'Line 1\nLine 2',
  to_gst: '33ABCDE1234F1Z5',
  to_phone: '9000000000',
  content: '<p>Rate <strong>₹45/km</strong></p><ol><li>Loading</li></ol><script>alert(1)</script><img src=x onerror="alert(1)"><p onclick="x()">click</p>',
};

async function steps() {
  section('Quotations');
  const before = (await call('GET', '/api/quotations')).data.length;
  let r = await call('POST', '/api/quotations', body);
  expect(r.status === 201, 'create', r.data);
  const id = r.data.id;
  const saved = await models.QuoteData.findByPk(id, { raw: true });
  expect(saved.content.includes('<strong>₹45/km</strong>') && saved.content.includes('<ol><li>Loading</li></ol>'), 'formatting is kept', saved.content);
  expect(!/script|onerror|onclick|<img/i.test(saved.content), 'scripts, event handlers and images are removed before saving', saved.content);

  const list = (await call('GET', '/api/quotations')).data;
  expect(list.length === before + 1 && list.some((q) => q.id === id) && !('content' in list[0]), 'list includes it (without the content)');

  const view = (await call('GET', `/api/quotations/${id}/view`)).data;
  expect(view.quote.to_address === 'Line 1\nLine 2' && typeof view.settings === 'object', 'view returns the quotation and the company settings', view.settings);

  r = await call('PUT', `/api/quotations/${id}`, { ...body, title: 'ZZTEST Edited', content: '<p>Edited</p>' });
  expect(r.status === 200 && r.data.title === 'ZZTEST Edited' && r.data.content === '<p>Edited</p>', 'edit', r.data);

  r = await call('POST', '/api/quotations', { ...body, title: '', to_name: '', quote_date: 'x' });
  expect(r.status === 400 && r.data.details?.title && r.data.details?.to_name && r.data.details?.quote_date, 'title, client name and a valid date are required', r.data);
  r = await call('POST', '/api/quotations', { ...body, quote_number: 'Q'.repeat(51) });
  expect(r.status === 400 && r.data.details?.quote_number, 'quotation number longer than the column (50) is rejected', r.data);
  r = await call('GET', '/api/quotations/99999999');
  expect(r.status === 404, 'unknown quotation -> 404');

  r = await call('DELETE', `/api/quotations/${id}`);
  expect(r.status === 200, 'delete');
  r = await call('DELETE', `/api/quotations/${id}`);
  expect(r.status === 404, 'deleting again -> 404');
}

async function cleanup() {
  await models.QuoteData.destroy({ where: { title: { [Op.like]: 'ZZTEST%' } } });
  console.log('\nCleaned up test records');
}

run({ label: 'quotation', sequelize, cleanup, steps: [steps] });
