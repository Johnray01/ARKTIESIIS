const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');
const env = require('../src/config/environment');

const PROJECT_DATABASE = 'ARKTIESIIS';
const MIGRATIONS_DIRECTORY = path.resolve(__dirname, '../database/migrations');
const BASELINE_PATH = path.resolve(__dirname, '../database/schema.sql');
const APPLICATION_LOCK = 'ARKTIESIIS database setup';

class SetupError extends Error {}

function makeSqlConfig(database, maxPoolSize = 10) {
  return {
    server: env.database.server,
    port: env.database.port,
    database,
    user: env.database.user,
    password: env.database.password,
    options: {
      encrypt: env.database.encrypt,
      trustServerCertificate: env.database.trustServerCertificate
    },
    pool: { max: maxPoolSize, min: 0, idleTimeoutMillis: 30000 }
  };
}

function splitSqlBatches(contents) {
  const batches = [];
  let currentLines = [];

  for (const line of contents.split(/\r?\n/)) {
    if (/^\s*GO\s*(?:--.*)?$/i.test(line)) {
      const batch = currentLines.join('\n').trim();
      if (batch) batches.push(batch);
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  const finalBatch = currentLines.join('\n').trim();
  if (finalBatch) batches.push(finalBatch);
  return batches;
}

function readMigrationFiles() {
  const sqlFiles = fs.readdirSync(MIGRATIONS_DIRECTORY)
    .filter((fileName) => fileName.toLowerCase().endsWith('.sql'))
    .sort();
  const migrations = [];
  const versions = new Set();

  for (const fileName of sqlFiles) {
    const match = /^(\d{3})_[a-z0-9_]+\.sql$/i.exec(fileName);
    if (!match) {
      throw new SetupError(`Migration file "${fileName}" must use the name format 003_description.sql.`);
    }

    const version = match[1];
    if (versions.has(version)) {
      throw new SetupError(`More than one migration uses version ${version}. Give each migration a unique version.`);
    }

    versions.add(version);
    migrations.push({ version, fileName, filePath: path.join(MIGRATIONS_DIRECTORY, fileName) });
  }

  return migrations;
}

function readSqlBatches(filePath) {
  let contents;
  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch {
    throw new SetupError(`Could not read SQL file ${path.relative(process.cwd(), filePath)}.`);
  }

  const batches = splitSqlBatches(contents);
  if (batches.length === 0) {
    throw new SetupError(`SQL file ${path.relative(process.cwd(), filePath)} is empty.`);
  }

  return batches;
}

async function executeBatches(request, filePath) {
  const batches = readSqlBatches(filePath);
  for (const batch of batches) await request.batch(batch);
}

function stripLeadingSqlComments(batch) {
  return batch.replace(/^(?:\s|\/\*[\s\S]*?\*\/|--[^\r\n]*(?:\r?\n|$))*/, '').trim();
}

function validateBaselinePrelude(batches) {
  if (batches.length < 3) {
    throw new SetupError('The baseline must begin with CREATE DATABASE ARKTIESIIS and USE ARKTIESIIS batches.');
  }

  const createDatabaseBatch = stripLeadingSqlComments(batches[0]);
  const useDatabaseBatch = stripLeadingSqlComments(batches[1]);
  const createsExpectedDatabase = /^IF\s+DB_ID\s*\(\s*'ARKTIESIIS'\s*\)\s+IS\s+NULL\b[\s\S]*\bCREATE\s+DATABASE\s+ARKTIESIIS\b[\s\S]*\bEND\s*;?$/i.test(createDatabaseBatch);
  const selectsExpectedDatabase = /^USE\s+\[?ARKTIESIIS\]?\s*;?$/i.test(useDatabaseBatch);

  if (!createsExpectedDatabase || !selectsExpectedDatabase) {
    throw new SetupError('The baseline prelude changed unexpectedly; setup requires CREATE DATABASE ARKTIESIIS followed by USE ARKTIESIIS.');
  }
}

async function databaseExists() {
  const masterPool = new sql.ConnectionPool(makeSqlConfig('master'));
  try {
    await masterPool.connect();
    const result = await masterPool.request()
      .input('databaseName', sql.NVarChar(128), PROJECT_DATABASE)
      .query('SELECT DB_ID(@databaseName) AS databaseId;');
    return result.recordset[0].databaseId !== null;
  } finally {
    await masterPool.close();
  }
}

async function runBaseline() {
  const batches = readSqlBatches(BASELINE_PATH);
  validateBaselinePrelude(batches);

  const masterPool = new sql.ConnectionPool(makeSqlConfig('master', 1));
  try {
    await masterPool.connect();
    await masterPool.request().batch(batches[0]);
  } finally {
    await masterPool.close();
  }

  const databasePool = new sql.ConnectionPool(makeSqlConfig(PROJECT_DATABASE, 1));
  try {
    await databasePool.connect();
    for (const batch of batches.slice(2)) await databasePool.request().batch(batch);
  } finally {
    await databasePool.close();
  }
}

async function acquireSetupLock(transaction) {
  await new sql.Request(transaction)
    .input('resource', sql.NVarChar(255), APPLICATION_LOCK)
    .query(`
      DECLARE @lockResult INT;
      EXEC @lockResult = sys.sp_getapplock
        @Resource = @resource,
        @LockMode = 'Exclusive',
        @LockOwner = 'Transaction',
        @LockTimeout = 60000;
      IF @lockResult < 0 THROW 51000, 'Could not acquire database setup lock.', 1;
    `);
}

async function readAppliedVersions(pool) {
  let tableResult;
  try {
    tableResult = await pool.request().query("SELECT OBJECT_ID(N'dbo.schema_migrations', N'U') AS tableId;");
  } catch {
    throw new SetupError('Could not inspect dbo.schema_migrations. Check database permissions and schema state.');
  }

  if (tableResult.recordset[0].tableId === null) {
    throw new SetupError(
      'ARKTIESIIS already exists but dbo.schema_migrations is missing. The baseline was not rerun; inspect or restore this database before setup.'
    );
  }

  let versionsResult;
  try {
    versionsResult = await pool.request().query('SELECT [version] FROM dbo.schema_migrations;');
  } catch {
    throw new SetupError('Could not read dbo.schema_migrations. Check database permissions and schema state.');
  }

  return new Set(versionsResult.recordset.map(({ version }) => String(version)));
}

function validateAppliedVersions(appliedVersions, migrations) {
  if (!appliedVersions.has('001')) {
    throw new SetupError(
      'ARKTIESIIS exists but baseline version 001 is not recorded. The baseline was not rerun; inspect or restore this database before setup.'
    );
  }

  const knownVersions = new Set(['001', ...migrations.map(({ version }) => version)]);
  const unknownVersions = [...appliedVersions].filter((version) => !knownVersions.has(version));
  if (unknownVersions.length > 0) {
    throw new SetupError(
      `Database migration version(s) ${unknownVersions.sort().join(', ')} are not present in this checkout. Restore the matching migration files before setup.`
    );
  }

  let firstMissingVersion = null;
  for (const { version } of migrations) {
    if (!appliedVersions.has(version)) {
      if (firstMissingVersion === null) firstMissingVersion = version;
    } else if (firstMissingVersion !== null) {
      throw new SetupError(
        `Migration history is inconsistent: version ${version} is recorded while earlier version ${firstMissingVersion} is missing. Inspect or restore this database before setup.`
      );
    }
  }
}

async function applyMigration(pool, migration) {
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await acquireSetupLock(transaction);

    const alreadyApplied = await new sql.Request(transaction)
      .input('version', sql.NVarChar(50), migration.version)
      .query('SELECT 1 AS applied FROM dbo.schema_migrations WHERE [version] = @version;');
    if (alreadyApplied.recordset.length > 0) {
      await transaction.rollback();
      return false;
    }

    await executeBatches(new sql.Request(transaction), migration.filePath);
    await new sql.Request(transaction)
      .input('version', sql.NVarChar(50), migration.version)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.schema_migrations WHERE [version] = @version)
          INSERT INTO dbo.schema_migrations ([version]) VALUES (@version);
      `);
    await transaction.commit();
    return true;
  } catch (error) {
    try {
      await transaction.rollback();
    } catch {
      // SQL Server may already have rolled the transaction back.
    }
    if (error instanceof SetupError) throw error;
    throw new SetupError(
      `Migration ${migration.version} (${migration.fileName}) failed and was rolled back. Fix the database issue, then rerun npm run db:setup.`
    );
  }
}

async function setupDatabase() {
  if (env.database.database !== PROJECT_DATABASE) {
    throw new SetupError(`DB_NAME must be ${PROJECT_DATABASE} because the one-time baseline creates that database name.`);
  }
  if (!env.database.password) {
    throw new SetupError('DB_PASSWORD is required. Copy .env.example to .env and set a unique local SQL Server password.');
  }

  const migrations = readMigrationFiles();
  if (!(await databaseExists())) {
    try {
      await runBaseline();
    } catch (error) {
      if (error instanceof SetupError) throw error;
      throw new SetupError(
        'The fresh database baseline failed. Check SQL Server availability and permissions; the database may now be partial, so inspect it before retrying.'
      );
    }
    console.log('Created ARKTIESIIS from the one-time baseline (001).');
  } else {
    console.log('ARKTIESIIS already exists; the one-time baseline will not be rerun.');
  }

  const pool = new sql.ConnectionPool(makeSqlConfig(PROJECT_DATABASE));
  try {
    await pool.connect();
    const appliedVersions = await readAppliedVersions(pool);
    validateAppliedVersions(appliedVersions, migrations);

    let newlyApplied = 0;
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;
      if (await applyMigration(pool, migration)) {
        newlyApplied += 1;
        appliedVersions.add(migration.version);
        console.log(`Applied migration ${migration.version} (${migration.fileName}).`);
      }
    }

    console.log(newlyApplied === 0
      ? 'Database is already up to date.'
      : `Database setup complete; applied ${newlyApplied} migration(s).`);
  } finally {
    await pool.close();
  }
}

if (require.main === module) {
  setupDatabase().catch((error) => {
    if (error instanceof SetupError) {
      console.error(`Database setup failed: ${error.message}`);
    } else {
      console.error('Database setup failed. Confirm SQL Server is running and DB_SERVER, DB_PORT, DB_USER, and DB_PASSWORD are correct.');
    }
    process.exitCode = 1;
  });
}

module.exports = {
  splitSqlBatches,
  readMigrationFiles,
  validateBaselinePrelude,
  validateAppliedVersions,
  setupDatabase
};
