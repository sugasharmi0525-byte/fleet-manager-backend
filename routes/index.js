/*
 * All logged-in API routes. Scoped resources live at /api/:scope/<path>, where scope is
 * 'own' or 'sv' (checked by validateScope; entities missing from a scope return 404).
 */
const { Router } = require('express');
const validateScope = require('../middleware/validateScope');
const { crudRouter } = require('../crud/crudRouter');
const { ENTITY_CONFIGS } = require('../crud/entities');
const clientLogsRoutes = require('./clientLogs.routes');
const { appSettings, quoteSettings } = require('./settings.routes');
const operationsRoutes = require('./operations.routes');
const salariesRoutes = require('./salaries.routes');
const reportsRoutes = require('./reports.routes');
const quotationsRoutes = require('./quotations.routes');
const insightsRoutes = require('./insights.routes');

const router = Router();

router.use('/client-logs', clientLogsRoutes);
router.use('/settings', appSettings);
router.use('/quote-settings', quoteSettings);
router.use('/quotations', quotationsRoutes);
router.use(operationsRoutes);
router.use(salariesRoutes);
router.use(reportsRoutes);
router.use(insightsRoutes);

for (const def of ENTITY_CONFIGS) {
  router.use(`/:scope/${def.path}`, validateScope, crudRouter(def));
}

module.exports = router;
