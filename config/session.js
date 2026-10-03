const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const env = require('./env');
const { sslOptions } = require('./database');

const MySQLStore = MySQLStoreFactory(session);

const maxAgeMs = env.SESSION_MAX_AGE_HOURS * 60 * 60 * 1000;

// Sessions live in the `sessions` table, which the store creates on first start.
const store = new MySQLStore({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASS,
  database: env.DB_NAME,
  ssl: sslOptions(),
  createDatabaseTable: true,
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: maxAgeMs,
});

const sessionMiddleware = session({
  name: 'fm.sid',
  secret: env.SESSION_SECRET,
  store,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  proxy: env.isProd,
  cookie: {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'lax',
    maxAge: maxAgeMs,
  },
});

module.exports = { sessionMiddleware, sessionStore: store };
