const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { clientLogger } = require('../config/logger');
const { HttpError } = require('../middleware/errorHandler');

const router = Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many log requests' },
});

const entrySchema = z.object({
  time: z.string().max(40).optional(),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string().max(2000),
  url: z.string().max(500).optional(),
  userAgent: z.string().max(300).optional(),
  user: z.string().max(100).nullable().optional(),
  data: z.unknown().optional(),
});

const bodySchema = z.object({ entries: z.array(entrySchema).min(1).max(20) });

const MAX_DATA_CHARS = 8000;

// POST /api/client-logs — batches of frontend warnings and errors, written to logs/client-*.log.
router.post('/', limiter, (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Invalid log batch');

  for (const entry of parsed.data.entries) {
    let { data } = entry;
    if (data !== undefined && JSON.stringify(data).length > MAX_DATA_CHARS) data = '[truncated: too large]';
    clientLogger.log(entry.level, entry.message, {
      clientTime: entry.time,
      url: entry.url,
      userAgent: entry.userAgent,
      user: req.session.user.username, // trust the session, not the client's value
      ip: req.ip,
      requestId: req.id,
      data,
    });
  }
  res.status(204).end();
});

module.exports = router;
