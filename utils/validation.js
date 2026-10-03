const { z } = require('zod');
const { HttpError } = require('../middleware/errorHandler');

// Form values arrive as strings (and as '' when left empty), so these helpers coerce them.

const blankToUndefined = (v) => (v === '' || v === null ? undefined : v);

/** Number that defaults to 0 when empty, like PHP's `$_POST['x'] ?: 0`. */
const money = () => z.preprocess((v) => blankToUndefined(v) ?? 0, z.coerce.number().min(0, 'Must be 0 or more').max(1e12));

/** Whole number that defaults to 0 when empty. */
const int = () => z.preprocess((v) => blankToUndefined(v) ?? 0, z.coerce.number().int('Must be a whole number').min(0));

/** Required id of a related record. */
const id = (label = 'Value') => z.coerce.number({ message: `${label} is required` }).int().positive(`${label} is required`);

/** Optional id: '' or null become null. */
const optionalId = () => z.preprocess((v) => blankToUndefined(v) ?? null, z.coerce.number().int().positive().nullable());

/** Required YYYY-MM-DD date. */
const date = (label = 'Date') => z.string({ message: `${label} is required` }).regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a valid date`);

/** Optional YYYY-MM-DD date: '' becomes null. */
const optionalDate = () => z.preprocess((v) => blankToUndefined(v) ?? null, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date').nullable());

/** Trimmed text with a max length; required unless `optional` is set. */
const text = (max, { optional = false, label = 'Value' } = {}) => {
  const base = z.preprocess((v) => (v == null ? '' : String(v).trim()), z.string().max(max, `${label} is too long`));
  return optional ? base : base.pipe(z.string().min(1, `${label} is required`));
};

/** Parses req.body with a zod schema or throws a 400 with field errors. */
function parseBody(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) fields[issue.path.join('.') || 'body'] = issue.message;
    throw new HttpError(400, Object.values(fields)[0] || 'Invalid data', fields);
  }
  return result.data;
}

module.exports = { z, money, int, id, optionalId, date, optionalDate, text, parseBody };
