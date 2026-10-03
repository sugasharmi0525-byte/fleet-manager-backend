/*
 * Phase 4 check: full login -> me -> logout flow against the running API.
 *
 *   npm run auth:check -w server -- "your admin password"
 *
 * Uses ADMIN_USER from .env and http://localhost:PORT. Nothing is stored.
 */
const env = require('../config/env');

const BASE = `http://localhost:${env.PORT}/api`;
let failures = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const fail = (msg) => {
  failures += 1;
  console.log(`  FAIL  ${msg}`);
};

// Minimal cookie jar for the fm.sid cookie.
let cookie = '';
async function call(method, path, { body, csrf } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, setCookie };
}

async function main() {
  const password = process.argv[2];
  if (!password) throw new Error('Pass the admin password: npm run auth:check -w server -- "password"');

  const { data: csrfData } = await call('GET', '/auth/csrf');
  const preLoginCookie = cookie;

  const login = await call('POST', '/auth/login', {
    body: { username: env.ADMIN_USER, password },
    csrf: csrfData.csrfToken,
  });
  if (login.status === 200 && login.data.user?.username) ok(`login as ${login.data.user.username}`);
  else return fail(`login returned ${login.status}: ${JSON.stringify(login.data)}`);

  if (login.setCookie && /HttpOnly/i.test(login.setCookie) && cookie !== preLoginCookie) ok('new HttpOnly session cookie issued on login');
  else fail('session cookie was not regenerated on login');

  if (login.data.csrfToken && login.data.csrfToken !== csrfData.csrfToken) ok('new CSRF token issued on login');
  else fail('CSRF token was not renewed on login');

  const me = await call('GET', '/auth/me');
  if (me.status === 200 && me.data.user?.username) ok('/auth/me returns the user with the session cookie');
  else fail(`/auth/me returned ${me.status}`);

  const loggedInCookie = cookie;
  const noCsrf = await call('POST', '/auth/logout');
  if (noCsrf.status === 403) ok('logout without CSRF token is rejected (403)');
  else fail(`logout without CSRF returned ${noCsrf.status}`);

  const logout = await call('POST', '/auth/logout', { csrf: me.data.csrfToken });
  if (logout.status === 200) ok('logout');
  else fail(`logout returned ${logout.status}`);

  cookie = loggedInCookie; // reuse the old cookie: the session must be gone
  const after = await call('GET', '/auth/me');
  if (after.status === 401) ok('old session cookie no longer works (401)');
  else fail(`old cookie after logout returned ${after.status}`);
}

main()
  .catch((err) => fail(err.message))
  .finally(() => {
    console.log(failures ? `\n${failures} check(s) failed` : '\nAll auth checks passed');
    process.exit(failures ? 1 : 0);
  });
