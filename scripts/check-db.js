const { getPool, closePool } = require('../src/config/database');

async function checkDatabase() {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .query("SELECT [version] FROM dbo.schema_migrations WHERE [version] IN ('001', '002', '003', '004', '005', '006', '007')");
    const versions = new Set(result.recordset.map(({ version }) => version));
    const missingVersions = ['001', '002', '003', '004', '005', '006', '007'].filter((version) => !versions.has(version));
    const objects = await pool.request().query(`SELECT
        OBJECT_ID(N'dbo.grade_import_previews', N'U') AS grade_import_previews,
        OBJECT_ID(N'dbo.grade_import_preview_rows', N'U') AS grade_import_preview_rows,
        OBJECT_ID(N'dbo.grade_import_preview_grades', N'U') AS grade_import_preview_grades,
        COL_LENGTH(N'dbo.students', N'lrn') AS lrn_column_length,
        OBJECT_ID(N'dbo.CK_students_lrn_format', N'C') AS lrn_check_constraint,
        OBJECT_ID(N'dbo.TR_students_require_lrn_on_insert', N'TR') AS lrn_insert_trigger,
        CASE WHEN EXISTS (
          SELECT 1 FROM sys.indexes
          WHERE object_id = OBJECT_ID(N'dbo.students') AND name = N'UX_students_lrn'
            AND is_unique = 1 AND has_filter = 1
        ) THEN 1 ELSE 0 END AS unique_lrn_index`);
    const schema = objects.recordset?.[0] || {};
    const missingObjects = [
      ...['grade_import_previews', 'grade_import_preview_rows', 'grade_import_preview_grades']
        .filter((name) => !schema[name]).map((name) => `dbo.${name}`),
      ...(schema.lrn_column_length !== 24 ? ['dbo.students.lrn NVARCHAR(12)'] : []),
      ...(!schema.lrn_check_constraint ? ['dbo.CK_students_lrn_format'] : []),
      ...(!schema.lrn_insert_trigger ? ['dbo.TR_students_require_lrn_on_insert'] : []),
      ...(schema.unique_lrn_index !== 1 ? ['dbo.UX_students_lrn'] : [])
    ];

    if (missingVersions.length > 0 || missingObjects.length > 0) {
      if (missingVersions.length > 0) console.error(`Database is reachable, but required schema migration(s) ${missingVersions.join(', ')} are not installed.`);
      if (missingObjects.length > 0) console.error(`Required grade-import/LRN schema objects are missing or invalid: ${missingObjects.join(', ')}.`);
      process.exitCode = 1;
      return;
    }

    console.log('Database connectivity, migrations 001–007, LRN constraints/index/trigger, and grade-import preview tables verified.');
  } catch {
    console.error('Database check failed. Confirm the database settings, connectivity, and schema migrations 001 through 007.');
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
