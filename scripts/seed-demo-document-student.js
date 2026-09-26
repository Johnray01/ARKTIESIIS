const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcrypt');
const { getPool, closePool, sql } = require('../src/config/database');
const environment = require('../src/config/environment');
const { DemoSeedError, assertDevelopmentTarget, deriveDemoEmails } = require('./seed-demo');
const { loadOrCreateAdminCredentials, parseCredentialEntries } = require('./seed-demo-admin');
const { buildGradeDemoPlan } = require('./seed-demo-grade-documents');

const DEMO_VERSION = 'document-student-v1';
const PASSWORD_HASH_ROUNDS = 12;
const CREDENTIAL_FILE = path.resolve(__dirname, '../.env.demo');
const STUDENT_EMAIL_KEY = 'DEMO_DOCUMENT_STUDENT_EMAIL';
const STUDENT_PASSWORD_KEY = 'DEMO_DOCUMENT_STUDENT_PASSWORD';
const STUDENT_NUMBER = 'DEMO-GRADE-001';

function parseOptions(args, nodeEnv = process.env.NODE_ENV || 'development') {
  if (nodeEnv !== 'development') throw new DemoSeedError('Demo data can only be seeded when NODE_ENV=development.');
  if (!Array.isArray(args) || args.length !== 1 || !['--apply', '--dry-run'].includes(args[0])) {
    throw new DemoSeedError('Choose exactly one option: --dry-run or --apply.');
  }
  return { mode: args[0] === '--apply' ? 'apply' : 'dry-run' };
}

function loadOrCreateDocumentStudentCredentials({
  smtpUser,
  filePath = CREDENTIAL_FILE,
  fileSystem = fs,
  randomPassword = () => crypto.randomBytes(24).toString('base64url')
}) {
  const emails = deriveDemoEmails(smtpUser);
  loadOrCreateAdminCredentials({ smtpUser, filePath, fileSystem });
  const stat = fileSystem.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new DemoSeedError('.env.demo must be a regular local file.');
  fileSystem.chmodSync(filePath, 0o600);
  const contents = fileSystem.readFileSync(filePath, 'utf8');
  const values = parseCredentialEntries(contents);
  const hasEmail = values.has(STUDENT_EMAIL_KEY);
  const hasPassword = values.has(STUDENT_PASSWORD_KEY);
  if (hasEmail !== hasPassword) throw new DemoSeedError('The existing .env.demo document-student credentials are incomplete; preserve the file before seeding.');
  if (hasEmail) {
    const password = values.get(STUDENT_PASSWORD_KEY);
    if (values.get(STUDENT_EMAIL_KEY) !== emails.documentStudent || !/^[A-Za-z0-9_-]{32,}$/.test(password)) {
      throw new DemoSeedError('The existing .env.demo document-student credentials are invalid or do not match SMTP_USER; preserve the file before seeding.');
    }
    return { email: emails.documentStudent, password };
  }

  const password = randomPassword();
  if (typeof password !== 'string' || !/^[A-Za-z0-9_-]{32,}$/.test(password)) {
    throw new DemoSeedError('A strong document-student password could not be generated.');
  }
  const suffix = contents.endsWith('\n') || contents.length === 0 ? '' : '\n';
  fileSystem.writeFileSync(filePath, `${contents}${suffix}${STUDENT_EMAIL_KEY}=${emails.documentStudent}\n${STUDENT_PASSWORD_KEY}=${password}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  fileSystem.chmodSync(filePath, 0o600);
  return { email: emails.documentStudent, password };
}

async function seedDemoDocumentStudent({
  getDatabasePool = getPool,
  sqlTypes = sql,
  transactionFactory = (pool) => new sqlTypes.Transaction(pool),
  credentials,
  runtime = environment,
  hashPassword = bcrypt.hash
} = {}) {
  assertDevelopmentTarget(runtime);
  if (!credentials || typeof credentials.email !== 'string' || typeof credentials.password !== 'string') {
    throw new DemoSeedError('Document-student demo credentials are required before seeding.');
  }
  const emails = deriveDemoEmails(runtime.smtp?.user);
  if (credentials.email !== emails.documentStudent || !/^[A-Za-z0-9_-]{32,}$/.test(credentials.password)) {
    throw new DemoSeedError('Document-student demo credentials do not match the configured local demo identity.');
  }
  const plan = buildGradeDemoPlan();
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
    if (userConflict.recordset?.length) {
      throw new DemoSeedError('The document-student demo email already exists without its seed marker. No records were changed.', 409);
    }

    const studentResult = await transaction.request()
      .input('studentNo', sqlTypes.NVarChar(50), plan.student.studentNo)
      .input('lrn', sqlTypes.NVarChar(12), plan.student.lrn)
      .query(`SELECT TOP (1) id, user_id, status FROM dbo.students WITH (UPDLOCK, HOLDLOCK)
        WHERE student_no = @studentNo AND lrn = @lrn`);
    const student = studentResult.recordset?.[0];
    if (!student) throw new DemoSeedError('Apply the grade/document demo seed before linking its student login. No records were changed.', 409);
    if (student.user_id !== null || student.status === 'archived') {
      throw new DemoSeedError('The synthetic document student is already linked or archived. No records were changed.', 409);
    }

    const sample = await transaction.request()
      .input('studentId', sqlTypes.Int, student.id)
      .input('documentName0', sqlTypes.NVarChar(255), plan.documents[0].originalFilename)
      .input('documentName1', sqlTypes.NVarChar(255), plan.documents[1].originalFilename)
      .query(`SELECT COUNT_BIG(*) AS document_count FROM dbo.documents WITH (UPDLOCK, HOLDLOCK)
        WHERE student_id = @studentId
          AND original_filename IN (@documentName0, @documentName1)`);
    if (Number(sample.recordset?.[0]?.document_count || 0) !== 2) {
      throw new DemoSeedError('The synthetic document samples are not available for this student. Apply the grade/document demo seed again after resolving the conflict.', 409);
    }

    const inserted = await transaction.request()
      .input('email', sqlTypes.NVarChar(255), credentials.email)
      .input('passwordHash', sqlTypes.NVarChar(255), passwordHash)
      .input('role', sqlTypes.NVarChar(30), 'student')
      .query(`INSERT INTO dbo.users (email, password_hash, role, is_active)
        OUTPUT INSERTED.id AS id VALUES (@email, @passwordHash, @role, 1)`);
    const userId = inserted.recordset?.[0]?.id;
    if (!Number.isSafeInteger(userId) || userId < 1) throw new Error('Document-student demo insert returned no identifier.');

    const linked = await transaction.request()
      .input('studentId', sqlTypes.Int, student.id)
      .input('userId', sqlTypes.Int, userId)
      .query(`UPDATE dbo.students SET user_id = @userId, updated_at = SYSUTCDATETIME()
        OUTPUT INSERTED.id AS id WHERE id = @studentId AND user_id IS NULL AND status <> N'archived'`);
    if (linked.recordset?.[0]?.id !== student.id) throw new Error('Document-student demo link was not saved.');

    await transaction.request()
      .input('action', sqlTypes.NVarChar(100), 'demo.seeded')
      .input('entityType', sqlTypes.NVarChar(100), 'demo_seed')
      .input('entityId', sqlTypes.NVarChar(100), DEMO_VERSION)
      .input('detailsJson', sqlTypes.NVarChar(sqlTypes.MAX), JSON.stringify({ role: 'student', studentNo: STUDENT_NUMBER, documents: 2, synthetic: true }))
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
      process.stdout.write('Document-student demo preview: one synthetic login linked to the two existing needs-review sample documents. No database changes made.\n');
      process.stdout.write('Applying requires NODE_ENV=development, --apply, and the local ARKTIESIIS database.\n');
      return;
    }
    const credentials = loadOrCreateDocumentStudentCredentials({ smtpUser: environment.smtp.user });
    shouldClosePool = true;
    const result = await seedDemoDocumentStudent({ credentials });
    process.stdout.write(result.alreadySeeded
      ? 'Document-student demo login already exists; no rows were added. Credentials remain in ignored .env.demo.\n'
      : 'Document-student demo login linked to its two synthetic review samples. Credentials are in ignored .env.demo (owner-only permissions).\n');
  } catch (error) {
    process.stderr.write(`${error instanceof DemoSeedError ? error.message : 'Document-student demo seeding failed. Check local database connectivity and schema setup.'}\n`);
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
  STUDENT_EMAIL_KEY,
  STUDENT_PASSWORD_KEY,
  parseOptions,
  loadOrCreateDocumentStudentCredentials,
  seedDemoDocumentStudent
};
