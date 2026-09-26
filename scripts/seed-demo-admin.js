const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcrypt');
const { getPool, closePool, sql } = require('../src/config/database');
const environment = require('../src/config/environment');
const { DemoSeedError, assertDevelopmentTarget, deriveDemoEmails, loadOrCreateCredentials } = require('./seed-demo');

const DEMO_VERSION = 'dashboard-admin-v1';
const PASSWORD_HASH_ROUNDS = 12;
const CREDENTIAL_FILE = path.resolve(__dirname, '../.env.demo');
const ADMIN_EMAIL_KEY = 'DEMO_DATABASE_ADMIN_EMAIL';
const ADMIN_PASSWORD_KEY = 'DEMO_DATABASE_ADMIN_PASSWORD';

function parseOptions(args, nodeEnv = process.env.NODE_ENV || 'development') {
  if (nodeEnv !== 'development') throw new DemoSeedError('Demo data can only be seeded when NODE_ENV=development.');
  if (!Array.isArray(args) || args.length !== 1 || !['--apply', '--dry-run'].includes(args[0])) {
    throw new DemoSeedError('Choose exactly one option: --dry-run or --apply.');
  }
  return { mode: args[0] === '--apply' ? 'apply' : 'dry-run' };
}

function parseCredentialEntries(contents) {
  const values = new Map();
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^(DEMO_[A-Z0-9_]+)=([^\r\n]*)$/);
    if (!match) continue;
    if (values.has(match[1])) throw new DemoSeedError('The demo credential file contains duplicate keys; preserve it and resolve the duplicate before seeding.');
    values.set(match[1], match[2]);
  }
  return values;
}

function loadOrCreateAdminCredentials({
  smtpUser,
  filePath = CREDENTIAL_FILE,
  fileSystem = fs,
  randomPassword = () => crypto.randomBytes(24).toString('base64url')
}) {
  const emails = deriveDemoEmails(smtpUser);
  loadOrCreateCredentials({ smtpUser, filePath, fileSystem });
  const stat = fileSystem.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new DemoSeedError('.env.demo must be a regular local file.');
  fileSystem.chmodSync(filePath, 0o600);
  const contents = fileSystem.readFileSync(filePath, 'utf8');
  const values = parseCredentialEntries(contents);
  const hasEmail = values.has(ADMIN_EMAIL_KEY);
  const hasPassword = values.has(ADMIN_PASSWORD_KEY);
  if (hasEmail !== hasPassword) throw new DemoSeedError('The existing .env.demo admin credentials are incomplete; preserve the file before seeding.');
  if (hasEmail) {
    const password = values.get(ADMIN_PASSWORD_KEY);
    if (values.get(ADMIN_EMAIL_KEY) !== emails.databaseAdmin || !/^[A-Za-z0-9_-]{32,}$/.test(password)) {
      throw new DemoSeedError('The existing .env.demo admin credentials are invalid or do not match SMTP_USER; preserve the file before seeding.');
    }
    return { email: emails.databaseAdmin, password };
  }

  const password = randomPassword();
  if (typeof password !== 'string' || !/^[A-Za-z0-9_-]{32,}$/.test(password)) {
    throw new DemoSeedError('A strong demo admin password could not be generated.');
  }
  const suffix = contents.endsWith('\n') || contents.length === 0 ? '' : '\n';
  fileSystem.writeFileSync(filePath, `${contents}${suffix}${ADMIN_EMAIL_KEY}=${emails.databaseAdmin}\n${ADMIN_PASSWORD_KEY}=${password}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  fileSystem.chmodSync(filePath, 0o600);
  return { email: emails.databaseAdmin, password };
}

async function seedDemoAdminAccount({
  getDatabasePool = getPool,
  sqlTypes = sql,
  transactionFactory = (pool) => new sqlTypes.Transaction(pool),
  credentials,
  runtime = environment,
  hashPassword = bcrypt.hash
} = {}) {
  assertDevelopmentTarget(runtime);
  if (!credentials || typeof credentials.email !== 'string' || typeof credentials.password !== 'string') {
    throw new DemoSeedError('Demo admin credentials are required before seeding.');
  }
  const emails = deriveDemoEmails(runtime.smtp?.user);
  if (credentials.email !== emails.databaseAdmin || !/^[A-Za-z0-9_-]{32,}$/.test(credentials.password)) {
    throw new DemoSeedError('Demo admin credentials do not match the configured local demo identity.');
  }
  const passwordHash = await hashPassword(credentials.password, PASSWORD_HASH_ROUNDS);
  const pool = await getDatabasePool();
  const transaction = transactionFactory(pool);
  let started = false;
  try {
    await transaction.begin(sqlTypes.ISOLATION_LEVEL.SERIALIZABLE);
    started = true;
    const marker = await transaction.request()
      .input('action', sqlTypes.NVarChar(100), 'demo.seeded')
      .input('entityType', sqlTypes.NVarChar(100), 'demo_seed')
      .input('entityId', sqlTypes.NVarChar(100), DEMO_VERSION)
      .query(`SELECT TOP (1) id FROM dbo.audit_logs WITH (UPDLOCK, HOLDLOCK)
        WHERE action = @action AND entity_type = @entityType AND entity_id = @entityId`);
    if (marker.recordset?.length) {
      await transaction.commit();
      started = false;
      return { alreadySeeded: true };
    }

    const userConflict = await transaction.request()
      .input('email', sqlTypes.NVarChar(255), credentials.email)
      .query('SELECT TOP (1) id FROM dbo.users WITH (UPDLOCK, HOLDLOCK) WHERE email = @email');
    const employeeConflict = await transaction.request()
      .input('employeeNo', sqlTypes.NVarChar(50), 'DEMO-STAFF-ADMIN-001')
      .query('SELECT TOP (1) id FROM dbo.staff_profiles WITH (UPDLOCK, HOLDLOCK) WHERE employee_no = @employeeNo');
    if (userConflict.recordset?.length || employeeConflict.recordset?.length) {
      throw new DemoSeedError('The demo admin email or employee number already exists without its seed marker. No records were changed.', 409);
    }

    const inserted = await transaction.request()
      .input('email', sqlTypes.NVarChar(255), credentials.email)
      .input('passwordHash', sqlTypes.NVarChar(255), passwordHash)
      .input('role', sqlTypes.NVarChar(30), 'database_admin')
      .query(`INSERT INTO dbo.users (email, password_hash, role, is_active)
        OUTPUT INSERTED.id AS id VALUES (@email, @passwordHash, @role, 1)`);
    const userId = inserted.recordset?.[0]?.id;
    if (!Number.isSafeInteger(userId) || userId < 1) throw new Error('Demo admin insert returned no identifier.');

    await transaction.request()
      .input('userId', sqlTypes.Int, userId)
      .input('employeeNo', sqlTypes.NVarChar(50), 'DEMO-STAFF-ADMIN-001')
      .input('firstName', sqlTypes.NVarChar(100), 'Demo Database')
      .input('lastName', sqlTypes.NVarChar(100), 'Administrator')
      .input('department', sqlTypes.NVarChar(100), 'Prototype')
      .query(`INSERT INTO dbo.staff_profiles (user_id, employee_no, first_name, last_name, department)
        VALUES (@userId, @employeeNo, @firstName, @lastName, @department)`);

    await transaction.request()
      .input('action', sqlTypes.NVarChar(100), 'demo.seeded')
      .input('entityType', sqlTypes.NVarChar(100), 'demo_seed')
      .input('entityId', sqlTypes.NVarChar(100), DEMO_VERSION)
      .input('detailsJson', sqlTypes.NVarChar(sqlTypes.MAX), JSON.stringify({ role: 'database_admin', synthetic: true }))
      .query(`INSERT INTO dbo.audit_logs (user_id, action, entity_type, entity_id, details_json)
        VALUES (NULL, @action, @entityType, @entityId, @detailsJson)`);

    await transaction.commit();
    started = false;
    return { alreadySeeded: false };
  } catch (error) {
    if (started) {
      try {
        await transaction.rollback();
      } catch {
        // Preserve the original failure without exposing database details.
      }
    }
    throw error;
  }
}

async function main(args = process.argv.slice(2)) {
  let shouldClosePool = false;
  try {
    const { mode } = parseOptions(args, process.env.NODE_ENV || 'development');
    assertDevelopmentTarget(environment);
    deriveDemoEmails(environment.smtp.user);
    if (mode === 'dry-run') {
      process.stdout.write('Dashboard admin demo preview: 1 synthetic database administrator login. No database changes made.\n');
      process.stdout.write('Applying requires NODE_ENV=development, --apply, and the local ARKTIESIIS database.\n');
      return;
    }
    const credentials = loadOrCreateAdminCredentials({ smtpUser: environment.smtp.user });
    shouldClosePool = true;
    const result = await seedDemoAdminAccount({ credentials });
    process.stdout.write(result.alreadySeeded
      ? 'Dashboard admin demo login already exists; no rows were added. Credentials remain in ignored .env.demo.\n'
      : 'Dashboard admin demo login created. Its login email and random password are in ignored .env.demo (owner-only permissions).\n');
  } catch (error) {
    process.stderr.write(`${error instanceof DemoSeedError ? error.message : 'Dashboard admin demo seeding failed. Check local database connectivity and schema setup.'}\n`);
    process.exitCode = 1;
  } finally {
    if (shouldClosePool) {
      try {
        await closePool();
      } catch {
        // Do not print database connection details.
      }
    }
  }
}

if (require.main === module) main();

module.exports = {
  DEMO_VERSION,
  ADMIN_EMAIL_KEY,
  ADMIN_PASSWORD_KEY,
  parseOptions,
  parseCredentialEntries,
  loadOrCreateAdminCredentials,
  seedDemoAdminAccount
};
