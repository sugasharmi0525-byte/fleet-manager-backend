const { SCOPES } = require('../services/scope');
const { HttpError } = require('./errorHandler');

// Express 5 can't restrict a path parameter with /:scope(own|sv), so routes use /:scope
// with this middleware. Any other value is a 404, as if the route didn't exist.
module.exports = function validateScope(req, res, next) {
  if (!SCOPES.includes(req.params.scope)) {
    return next(new HttpError(404, `Not found: ${req.method} ${req.originalUrl}`));
  }
  next();
};
