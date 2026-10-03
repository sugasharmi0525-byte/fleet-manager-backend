/*
 * Shared setup for the phase check scripts: an in-process API with a test login (no admin
 * password needed), a fetch helper and ok/fail reporting. Refuses to run in production.
 */
const express = require('express');
const env = require('../../config/env');
const requestId = require('../../middleware/requestId');
const { errorHandler } = require('../../middleware/errorHandler');
const apiRoutes = require('../../routes');

if (env.isProd) {
  console.error('Refusing to run against production');
  process.exit(1);
}

function createHarness(username) {
  let failures = 0;
  let base;
  const ok = (msg) => console.log(`  ok    ${msg}`);
  const fail = (msg) => {
    failures += 1;
    console.log(`  FAIL  ${msg}`);
  };
  const expect = (cond, msg, detail) => (cond ? ok(msg) : fail(`${msg}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ''}`));
  const section = (title) => console.log(`\n${title}`);

  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { user: { username } };
    next();
  });
  app.use('/api', apiRoutes);
  app.use(errorHandler);

  async function call(method, path, body) {
    const init = { method, headers: {} };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(`${base}${path}`, init);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  }

  /** Starts the API, runs the steps, always runs cleanup, closes the DB and exits 0/1. */
  async function run({ steps, cleanup, sequelize, label }) {
    const server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const step of steps) await step();
    } catch (err) {
      fail(err.stack);
    } finally {
      if (cleanup) await cleanup().catch((err) => fail(`cleanup: ${err.message}`));
      server.close();
      await sequelize.close();
    }
    console.log(failures ? `\n${failures} check(s) failed` : `\nAll ${label} checks passed`);
    process.exit(failures ? 1 : 0);
  }

  return { ok, fail, expect, section, call, run };
}

module.exports = { createHarness };
