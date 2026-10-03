const env = require('./config/env');
const { logger } = require('./config/logger');
const { sequelize, models } = require('./models'); // loading here fails fast on a broken model
const { sessionStore } = require('./config/session');
const app = require('./app');

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { error: reason instanceof Error ? reason.stack : String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception, shutting down', { error: err.stack });
  setTimeout(() => process.exit(1), 500); // let the log flush; PM2 restarts the process
});

async function start() {
  try {
    await sequelize.authenticate();
    logger.info('Database connected', {
      host: env.DB_HOST,
      database: env.DB_NAME,
      models: Object.keys(models).length,
    });
  } catch (err) {
    logger.error('Database connection failed', { error: err.message });
    process.exit(1);
  }

  // Express 5 passes listen errors (e.g. port in use) to this callback.
  const server = app.listen(env.PORT, (err) => {
    if (err) {
      logger.error(`Cannot listen on port ${env.PORT}`, { error: err.message });
      process.exit(1);
    }
    logger.info(`API listening on http://localhost:${env.PORT}`, { env: env.NODE_ENV });
  });

  const shutdown = (signal) => {
    logger.info(`${signal} received, closing server`);
    server.close(async () => {
      await Promise.allSettled([sequelize.close(), sessionStore.close()]);
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
