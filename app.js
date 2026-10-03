const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const env = require('./config/env');
const { sessionMiddleware } = require('./config/session');
const requestId = require('./middleware/requestId');
const httpLogger = require('./middleware/httpLogger');
const { csrfProtection } = require('./middleware/csrf');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const requireAuth = require('./middleware/requireAuth');
const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const apiRoutes = require('./routes');
const { uploadsStatic } = require('./crud/crudRouter');

const app = express();

app.disable('x-powered-by');
if (env.isProd) app.set('trust proxy', 1); // behind Nginx: real client IP and HTTPS for secure cookies

// Order matters: request ID first so every later log line carries it.
app.use(requestId);
app.use(
  helmet({
    hsts: env.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  })
);
if (env.isDev) {
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
}
app.use(httpLogger);
app.use(express.json({ limit: '1mb' }));
app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many requests, please slow down' },
  })
);
app.use(sessionMiddleware);
app.use(csrfProtection); // GET, HEAD and OPTIONS pass; every write needs x-csrf-token

// Public routes
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);

// Everything below needs a logged-in session.
app.use('/api', requireAuth, apiRoutes);
app.use('/uploads', requireAuth, uploadsStatic()); // vehicle PDFs are private documents

app.use(notFound);
app.use(errorHandler);

module.exports = app;
