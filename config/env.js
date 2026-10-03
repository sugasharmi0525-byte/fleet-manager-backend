const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { z } = require('zod');

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  CLIENT_ORIGIN: z.string().default('http://localhost:3000'),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASS: z.string().default(''),
  DB_SSL: bool,
  DB_SSL_CA: z.string().default(''),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_MAX_AGE_HOURS: z.coerce.number().positive().default(8),

  ADMIN_USER: z.string().default('admin'),
  ADMIN_PASS_HASH: z.string().default(''),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
  LOG_DIR: z.string().default('./logs'),
  UPLOAD_DIR: z.string().default('./uploads'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid server/.env:\n${problems}`);
  process.exit(1);
}

const env = parsed.data;
const serverRoot = path.join(__dirname, '..');

module.exports = {
  ...env,
  isProd: env.NODE_ENV === 'production',
  isDev: env.NODE_ENV === 'development',
  logDir: path.resolve(serverRoot, env.LOG_DIR),
  uploadDir: path.resolve(serverRoot, env.UPLOAD_DIR),
};
