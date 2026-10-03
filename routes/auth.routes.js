const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const auth = require('../controllers/auth.controller');
const requireAuth = require('../middleware/requireAuth');

const router = Router();

// 5 failed logins per 15 minutes per IP; successful logins don't count.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => {
    req.log.warn('Login rate limit reached', { ip: req.ip });
    res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.', requestId: req.id });
  },
});

router.get('/csrf', auth.csrf);
router.post('/login', loginLimiter, auth.login);
router.get('/me', auth.me);
router.post('/logout', requireAuth, auth.logout);

module.exports = router;
