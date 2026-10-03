const winston = require('winston');
require('winston-daily-rotate-file');
const env = require('./env');

const REDACTED_KEYS = new Set([
  'password',
  'pass',
  'pass_hash',
  'cookie',
  'cookies',
  'authorization',
  'token',
  'csrftoken',
  'x-csrf-token',
  'session',
  'sid',
  'secret',
]);

// Replace sensitive values anywhere in the log entry before it is written.
function redact(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(val, depth + 1);
  }
  return out;
}

const redactFormat = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (REDACTED_KEYS.has(key.toLowerCase())) info[key] = '[redacted]';
    else info[key] = redact(info[key]);
  }
  return info;
});

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  redactFormat(),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  redactFormat(),
  winston.format.printf(({ timestamp, level, message, requestId, stack, ...rest }) => {
    const id = requestId ? ` [${String(requestId).slice(0, 8)}]` : '';
    const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
    return `${timestamp} ${level}${id} ${message}${extra}${stack ? `\n${stack}` : ''}`;
  })
);

function rotatingFile(filename, level) {
  return new winston.transports.DailyRotateFile({
    dirname: env.logDir,
    filename: `${filename}-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    zippedArchive: true,
    level,
    format: fileFormat,
  });
}

const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  transports: [rotatingFile('app', env.LOG_LEVEL), rotatingFile('error', 'error')],
  exitOnError: false,
});

if (!env.isProd) {
  logger.add(new winston.transports.Console({ format: consoleFormat }));
}

// Frontend logs are written to their own file (see routes/clientLogs.routes.js).
const clientLogger = winston.createLogger({
  level: 'debug',
  transports: [rotatingFile('client', 'debug')],
  exitOnError: false,
});

module.exports = { logger, clientLogger };
