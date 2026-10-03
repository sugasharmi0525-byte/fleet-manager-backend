const { Router } = require('express');
const { sequelize } = require('../config/database');

const router = Router();

// Public: reports API and database status. Used by monitoring and the deploy check.
router.get('/', async (req, res) => {
  let db = 'ok';
  try {
    await sequelize.authenticate();
  } catch (err) {
    db = 'down';
    req.log.error('Health check: database unreachable', { error: err.message });
  }
  res.status(db === 'ok' ? 200 : 503).json({ status: db === 'ok' ? 'ok' : 'degraded', db, time: new Date().toISOString() });
});

module.exports = router;
