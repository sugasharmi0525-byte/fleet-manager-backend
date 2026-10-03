const { HttpError } = require('./errorHandler');

// Every /api route after this middleware needs a logged-in session.
module.exports = function requireAuth(req, res, next) {
  if (!req.session?.user) return next(new HttpError(401, 'Not logged in'));
  next();
};
