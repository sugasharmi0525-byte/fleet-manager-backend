const { logger } = require('../config/logger');

/**
 * Writes one audit line for a change made by the logged-in user.
 *   audit(req, { action: 'create', scope: 'own', entity: 'vehicles', id: 12 })
 */
function audit(req, { action, scope, entity, id, ...extra }) {
  const log = req.log || logger;
  log.info('audit', {
    audit: true,
    user: req.session?.user?.username || 'anonymous',
    action,
    scope,
    entity,
    id,
    ip: req.ip,
    ...extra,
  });
}

module.exports = { audit };
