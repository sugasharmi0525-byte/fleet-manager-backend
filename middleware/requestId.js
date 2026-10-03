const crypto = require('crypto');
const { logger } = require('../config/logger');

// Gives every request an ID, returns it in X-Request-Id and attaches a child logger as req.log.
module.exports = function requestId(req, res, next) {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  req.log = logger.child({ requestId: req.id });
  next();
};
