const { getPool, closePool } = require('../src/config/database');

async function checkDatabase() {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .query("SELECT [version] FROM dbo.schema_migrations WHERE [version] IN ('001', '002', '003', '004', '005', '006')");
    const versions = new Set(result.recordset.map(({ version }) => version));
    const missingVersions = ['001', '002', '003', '004', '005', '006'].filter((version) => !versions.has(version));

    if (missingVersions.length > 0) {
      console.error(`Database is reachable, but required schema migration(s) ${missingVersions.join(', ')} are not installed.`);
      process.exitCode = 1;
      return;
    }

    console.log('Database connectivity and schema migrations 001 through 006 verified.');
  } catch {
    console.error('Database check failed. Confirm the database settings, connectivity, and schema migrations 001 through 006.');
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
