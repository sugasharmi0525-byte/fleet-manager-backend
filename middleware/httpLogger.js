const morgan = require('morgan');
const { logger } = require('../config/logger');

morgan.token('id', (req) => req.id);
morgan.token('user', (req) => req.session?.user?.username || '-');

const format = ':method :url :status :res[content-length] - :response-time ms user=:user id=:id';

// One `http` log line per request, written through winston.
module.exports = morgan(format, {
  stream: {
    write: (line) => logger.http(line.trim()),
  },
});
