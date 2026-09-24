const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');
const env = require('../src/config/environment');
const { readMigrationFiles, splitSqlBatches } = require('./db-setup');

function databaseConfig() {
  return {
    server: env.database.server,
    port: env.database.port,
    database: env.database.database,
    user: env.database.user,
    password: env.database.password,
    options: {
      encrypt: env.database.encrypt,
      trustServerCertificate: env.database.trustServerCertificate
    },
    pool: { max: 1, min: 0, idleTimeoutMillis: 30000 }
  };
}

async function testMigrationRollback() {
  const migration = readMigrationFiles().find(({ version }) => version === '006');
  if (!migration) throw new Error('Migration 006 was not found.');
  if (!env.database.password) throw new Error('DB_PASSWORD is required for the rollback-only migration test.');

  const pool = new sql.ConnectionPool(databaseConfig());
  let transaction;
  let transactionActive = false;
  try {
    await pool.connect();
    const before = await pool.request().query(`SELECT
        OBJECT_ID(N'dbo.schema_migrations', N'U') AS migrations_table,
        OBJECT_ID(N'dbo.document_decision_events', N'U') AS decisions_table,
        OBJECT_ID(N'dbo.form137_status_events', N'U') AS form137_table,
        (SELECT COUNT(*) FROM dbo.schema_migrations WHERE [version] = '006') AS applied_count`);
    const state = before.recordset?.[0];
    if (!state?.migrations_table) throw new Error('dbo.schema_migrations is not available.');
    if (state.decisions_table || state.form137_table || Number(state.applied_count) > 0) {
      throw new Error('Migration 006 is already present; rollback test refused to alter an installed migration.');
    }

    transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    transactionActive = true;
    const request = new sql.Request(transaction);
    const batches = splitSqlBatches(fs.readFileSync(migration.filePath, 'utf8'));
    for (const batch of batches) await request.batch(batch);

    const during = await new sql.Request(transaction).query(`SELECT
        OBJECT_ID(N'dbo.document_decision_events', N'U') AS decisions_table,
        OBJECT_ID(N'dbo.form137_status_events', N'U') AS form137_table`);
    if (!during.recordset?.[0]?.decisions_table || !during.recordset?.[0]?.form137_table) {
      throw new Error('Migration 006 did not create its expected tables inside the transaction.');
    }

    await transaction.rollback();
    transactionActive = false;
    const after = await pool.request().query(`SELECT
        OBJECT_ID(N'dbo.document_decision_events', N'U') AS decisions_table,
        OBJECT_ID(N'dbo.form137_status_events', N'U') AS form137_table`);
    if (after.recordset?.[0]?.decisions_table || after.recordset?.[0]?.form137_table) {
      throw new Error('Migration 006 objects remained after rollback.');
    }
    process.stdout.write('Migration 006 created its objects inside a transaction and left no schema changes after rollback.\n');
  } finally {
    if (transactionActive) {
      try {
        await transaction.rollback();
      } catch {
        // Preserve the original failure; the connection closes below.
      }
    }
    if (pool.connected) await pool.close();
  }
}

if (require.main === module) {
  testMigrationRollback().catch(() => {
    console.error('Rollback-only migration test failed. Confirm SQL Server connectivity, migration state, and local database settings.');
    process.exitCode = 1;
  });
}

module.exports = { testMigrationRollback };
