/*
 * Read-only lookups for the shell and detail pages (services/insights.service.js):
 *   GET /api/search?q=            global search (Ctrl K)
 *   GET /api/alerts               bell items + sidebar badges
 *   GET /api/:scope/vehicles/:id/overview   vehicle detail page
 */
const { Router } = require('express');
const validateScope = require('../middleware/validateScope');
const { toId } = require('../crud/crudRouter');
const insights = require('../services/insights.service');

const router = Router();

router.get('/search', async (req, res) => res.json(await insights.search(req.query.q)));
router.get('/alerts', async (req, res) => res.json(await insights.alerts()));
router.get('/:scope/vehicles/:id/overview', validateScope, async (req, res) => res.json(await insights.vehicleOverview(req.params.scope, toId(req.params.id))));

module.exports = router;
