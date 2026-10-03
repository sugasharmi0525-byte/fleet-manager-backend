const env = require('../config/env');
const { logger } = require('../config/logger');
const { invalidCsrfTokenError } = require('./csrf');

// Thrown by services to send a specific status and message to the client.
class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function notFound(req, res, next) {
  next(new HttpError(404, `Not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const log = req.log || logger;
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Internal server error';

  if (err === invalidCsrfTokenError || err.code === 'EBADCSRFTOKEN') {
    status = 403;
    message = 'Invalid or missing CSRF token';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request body too large';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Invalid JSON body';
  } else if (err.name === 'SequelizeUniqueConstraintError') {
    status = 409;
    message = 'A record with the same value already exists';
  } else if (err.name === 'SequelizeForeignKeyConstraintError') {
    status = 409;
    message = 'This record is linked to other records and cannot be changed this way';
  } else if (err.name === 'SequelizeValidationError') {
    status = 400;
    message = err.errors?.map((e) => e.message).join('; ') || 'Invalid data';
  } else if (err.name === 'MulterError') {
    status = 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (maximum 5 MB)' : `Upload failed: ${err.message}`;
  }

  const meta = { status, method: req.method, url: req.originalUrl, user: req.session?.user?.username };

  if (status >= 500) {
    log.error(message, { ...meta, stack: err.stack });
    if (env.isProd) message = 'Internal server error';
  } else {
    log.warn(message, meta);
  }

  const body = { error: message, requestId: req.id };
  if (err.details && status < 500) body.details = err.details;
  res.status(status).json(body);
}

module.exports = { HttpError, notFound, errorHandler };
