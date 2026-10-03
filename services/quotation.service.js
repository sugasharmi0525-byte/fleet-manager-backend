/*
 * Quotations — copied from car-v1/quotations.php, quote_add.php and quote_view.php.
 * The content is HTML from the rich-text editor; it is cleaned here before saving (PHP saved
 * and echoed it as typed) and cleaned again in the browser before it is shown.
 */
const DOMPurify = require('isomorphic-dompurify');
const { models } = require('../models');
const { HttpError } = require('../middleware/errorHandler');
const { z, date, text, parseBody } = require('../utils/validation');

// What the editor toolbar can produce (bold, italic, underline, lists, clean) plus paragraphs.
const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ol', 'ul', 'li', 'span', 'h1', 'h2', 'h3', 'blockquote'];
const ALLOWED_ATTR = ['class', 'data-list'];

const cleanHtml = (html) => DOMPurify.sanitize(String(html || ''), { ALLOWED_TAGS, ALLOWED_ATTR });

const schema = z.object({
  title: text(255, { label: 'Title' }),
  quote_number: text(50, { label: 'Quotation number' }),
  quote_date: date('Created date'),
  effective_date: date('Effective date'),
  to_name: text(255, { label: 'Client name' }),
  to_address: text(5000, { optional: true, label: 'Address' }),
  to_gst: text(50, { optional: true, label: 'GST number' }),
  to_phone: text(50, { optional: true, label: 'Phone number' }),
  content: z.preprocess((v) => (v == null ? '' : String(v)), z.string().max(500_000, 'Content is too long')),
});

/** All quotations, newest first (quotations.php). */
function list() {
  return models.QuoteData.findAll({
    attributes: ['id', 'title', 'quote_number', 'quote_date', 'effective_date', 'to_name', 'created_at'],
    order: [['created_at', 'DESC']],
    raw: true,
  });
}

async function get(quoteId) {
  const row = await models.QuoteData.findByPk(quoteId, { raw: true });
  if (!row) throw new HttpError(404, 'Quotation not found');
  return row;
}

/** The view page: the quotation plus the company details from Quote Settings. */
async function view(quoteId) {
  const [quote, settings] = await Promise.all([get(quoteId), models.QuoteSettings.findOne({ raw: true })]);
  return { quote, settings: settings || {} };
}

async function save(quoteId, body) {
  const data = parseBody(schema, body);
  data.content = cleanHtml(data.content);
  if (quoteId) {
    const row = await models.QuoteData.findByPk(quoteId);
    if (!row) throw new HttpError(404, 'Quotation not found');
    await row.update(data);
    return row.get({ plain: true });
  }
  const row = await models.QuoteData.create(data);
  return row.get({ plain: true });
}

async function remove(quoteId) {
  const deleted = await models.QuoteData.destroy({ where: { id: quoteId } });
  if (!deleted) throw new HttpError(404, 'Quotation not found');
}

module.exports = { cleanHtml, list, get, view, save, remove };
