const { sql, getPool, closePool } = require('../src/config/database');

async function checkDatabase() {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('version', sql.NVarChar(50), '001')
      .query('SELECT [version] FROM dbo.schema_migrations WHERE [version] = @version');

    if (result.recordset.length === 0) {
      console.error('Database is reachable, but baseline schema version 001 is not installed.');
      process.exitCode = 1;
      return;
    }

    console.log('Database connectivity and baseline schema version 001 verified.');
  } catch {
    console.error('Database check failed. Confirm the database settings, connectivity, and schema baseline 001.');
    process.exitCode = 1;
  } finally {
    try {
      await closePool();
    } catch {
      console.error('Database check could not close its connection cleanly.');
      process.exitCode = 1;
    }
  }
}

if (require.main === module) {
  checkDatabase();
}

module.exports = { checkDatabase };
