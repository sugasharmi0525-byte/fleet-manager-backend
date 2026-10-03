const { csrfSync } = require('csrf-sync');

// Synchroniser-token CSRF protection: the token lives in the session and must be sent
// back in the x-csrf-token header on every POST, PUT, PATCH and DELETE.
const { csrfSynchronisedProtection, generateToken, invalidCsrfTokenError } = csrfSync({
  getTokenFromRequest: (req) => req.headers['x-csrf-token'],
});

module.exports = {
  csrfProtection: csrfSynchronisedProtection,
  generateCsrfToken: generateToken,
  invalidCsrfTokenError,
};
