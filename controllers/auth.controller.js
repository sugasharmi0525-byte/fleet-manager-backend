const bcrypt = require('bcrypt');
const { z } = require('zod');
const env = require('../config/env');
const { generateCsrfToken } = require('../middleware/csrf');
const { HttpError } = require('../middleware/errorHandler');
const { audit } = require('../utils/audit');

// Compared against when the username is wrong, so a failed login takes the same time
// either way and doesn't reveal which usernames exist.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 12);

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username is required').max(100),
  password: z.string().min(1, 'Password is required').max(200),
});

function publicUser(sessionUser) {
  return { username: sessionUser.username, loginAt: sessionUser.loginAt };
}

// Wraps the callback-style session methods in promises.
const regenerate = (req) => new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
const save = (req) => new Promise((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
const destroy = (req) => new Promise((resolve, reject) => req.session.destroy((e) => (e ? reject(e) : resolve())));

/** GET /api/auth/csrf — token for the next write; creates the session if needed. */
function csrf(req, res) {
  res.json({ csrfToken: generateCsrfToken(req) });
}

/** POST /api/auth/login */
async function login(req, res) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Username and password are required', parsed.error.flatten().fieldErrors);
  }
  const { username, password } = parsed.data;

  if (!env.ADMIN_PASS_HASH) {
    req.log.error('Login attempted but ADMIN_PASS_HASH is not set in server/.env');
    throw new HttpError(503, 'Login is not configured on the server');
  }

  const userMatches = username.toLowerCase() === env.ADMIN_USER.toLowerCase();
  const passwordMatches = await bcrypt.compare(password, userMatches ? env.ADMIN_PASS_HASH : DUMMY_HASH);

  if (!userMatches || !passwordMatches) {
    req.log.warn('Failed login', { attemptedUser: username, ip: req.ip });
    throw new HttpError(401, 'Invalid username or password');
  }

  // New session ID on login (prevents session fixation), then a fresh CSRF token for it.
  await regenerate(req);
  req.session.user = { username: env.ADMIN_USER, loginAt: new Date().toISOString() };
  const csrfToken = generateCsrfToken(req, true);
  await save(req);

  audit(req, { action: 'login', entity: 'auth' });
  res.json({ user: publicUser(req.session.user), csrfToken });
}

/** POST /api/auth/logout */
async function logout(req, res) {
  audit(req, { action: 'logout', entity: 'auth' });
  await destroy(req);
  res.clearCookie('fm.sid', { httpOnly: true, secure: env.isProd, sameSite: 'lax' });
  res.json({ ok: true });
}

/** GET /api/auth/me — restores the login state after a page reload. */
function me(req, res) {
  if (!req.session?.user) throw new HttpError(401, 'Not logged in');
  res.json({ user: publicUser(req.session.user), csrfToken: generateCsrfToken(req) });
}

module.exports = { csrf, login, logout, me };
