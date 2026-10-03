/*
 * Sets the admin login password. Only its bcrypt hash is stored, in server/.env (ADMIN_PASS_HASH).
 *
 *   npm run auth:set-password -w server -- "your new password"   # set a chosen password
 *   npm run auth:set-password -w server                          # generate a random one and print it
 *
 * Restart the API afterwards so it reads the new hash.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

const ENV_FILE = path.join(__dirname, '..', '.env');
const MIN_LENGTH = 8;

function randomPassword() {
  return crypto.randomBytes(12).toString('base64url'); // 16 characters
}

async function main() {
  if (!fs.existsSync(ENV_FILE)) throw new Error('server/.env not found. Copy .env.example first.');

  const given = process.argv[2];
  const password = given || randomPassword();
  if (password.length < MIN_LENGTH) throw new Error(`Password must be at least ${MIN_LENGTH} characters`);

  const hash = await bcrypt.hash(password, 12);
  const line = `ADMIN_PASS_HASH='${hash}'`;

  let content = fs.readFileSync(ENV_FILE, 'utf8');
  content = /^ADMIN_PASS_HASH=.*$/m.test(content)
    ? content.replace(/^ADMIN_PASS_HASH=.*$/m, line)
    : `${content.trimEnd()}\n${line}\n`;
  fs.writeFileSync(ENV_FILE, content);

  console.log('Admin password hash saved to server/.env. Restart the API to use it.');
  if (!given) console.log(`Generated password (shown once, store it safely): ${password}`);
}

main().catch((err) => {
  console.error(`Failed: ${err.message}`);
  process.exit(1);
});
