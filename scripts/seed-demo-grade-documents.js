const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { getPool, closePool, sql } = require('../src/config/database');
const environment = require('../src/config/environment');
const { assertDevelopmentTarget, DemoSeedError } = require('./seed-demo');

const DEMO_VERSION = 'grade-documents-v1';
const SCHOOL_YEAR = '2026-2027';
const TERM_NAME = 'DEMO Grade Import';
const FIXTURE_WORKBOOK = path.resolve(__dirname, '../tests/fixtures/grade-import/corrected-mini.xlsx');
const PUBLIC_DIRECTORY = path.resolve(__dirname, '../public');

function parseOptions(args, nodeEnv = process.env.NODE_ENV || 'development') {
  if (nodeEnv !== 'development') throw new DemoSeedError('Demo data can only be seeded when NODE_ENV=development.');
  if (!Array.isArray(args) || args.length !== 1 || !['--apply', '--dry-run'].includes(args[0])) {
    throw new DemoSeedError('Choose exactly one option: --dry-run or --apply.');
  }
  return { mode: args[0] === '--apply' ? 'apply' : 'dry-run' };
}

function buildGradeDemoPlan() {
  return {
    version: DEMO_VERSION,
    term: { schoolYear: SCHOOL_YEAR, term: TERM_NAME },
    section: { name: 'STEM A', gradeLevel: '11' },
    student: {
      studentNo: 'DEMO-GRADE-001',
      lrn: '123456789012',
      firstName: 'Jamie',
      lastName: 'Garcia'
    },
    subject: { code: 'DEMO-GRADE-OCOM-2026', name: 'Oral Communication', units: '3.00' },
    documents: [
      {
        type: 'good_moral',
        originalFilename: 'DEMO-SAMPLE-Good-Moral-NOT-OFFICIAL.pdf',
        mimeType: 'application/pdf',
        fixturePath: path.resolve(__dirname, '../tests/fixtures/ocr/synthetic-two-page.pdf')
      },
      {
        type: 'report_card',
        originalFilename: 'DEMO-SAMPLE-Report-Card-NOT-OFFICIAL.png',
        mimeType: 'image/png',
        fixturePath: path.resolve(__dirname, '../tests/fixtures/ocr/synthetic-png.png')
      }
    ]
  };
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function ensurePrivateStorageDirectory({ storageDirectory, publicDirectory = PUBLIC_DIRECTORY, fileSystem = fs }) {
  const storageRoot = path.resolve(storageDirectory);
  const publicRoot = path.resolve(publicDirectory);
  if (isInside(publicRoot, storageRoot)) {
    throw new DemoSeedError('Document storage must be outside the public web directory.');
  }
  await fileSystem.mkdir(storageRoot, { recursive: true, mode: 0o700 });
  const [realStorageRoot, realPublicRoot] = await Promise.all([
    fileSystem.realpath(storageRoot),
    fileSystem.realpath(publicRoot)
  ]);
  if (isInside(realPublicRoot, realStorageRoot)) {
    throw new DemoSeedError('Document storage must be outside the public web directory.');
  }
  await fileSystem.chmod(storageRoot, 0o700);
  return storageRoot;
}

async function seedGradeDemoData({
  getDatabasePool = getPool,
  sqlTypes = sql,
  transactionFactory = (pool) => new sqlTypes.Transaction(pool),
  runtime = environment,
  storageDirectory = runtime.upload.storageDirectory,
  publicDirectory = PUBLIC_DIRECTORY,
  fileSystem = fs,
  randomId = () => crypto.randomUUID()
} = {}) {
  assertDevelopmentTarget(runtime);
  const plan = buildGradeDemoPlan();
  const documentBuffers = await Promise.all(plan.documents.map(({ fixturePath }) => fileSystem.readFile(fixturePath)));
  if (documentBuffers.some((buffer) => !Buffer.isBuffer(buffer) || buffer.length < 1)) {
    throw new DemoSeedError('A synthetic demo document fixture is unavailable.');
  }

  const pool = await getDatabasePool();
  const transaction = transactionFactory(pool);
  const storedPaths = [];
  let started = false;
  try {
    await transaction.begin(sqlTypes.ISOLATION_LEVEL.SERIALIZABLE);
    started = true;
    const marker = await transaction.request()
      .input('action', sqlTypes.NVarChar(100), 'demo.seeded')
      .input('entityType', sqlTypes.NVarChar(100), 'demo_seed')
      .input('entityId', sqlTypes.NVarChar(100), plan.version)
      .query(`SELECT TOP (1) id FROM dbo.audit_logs WITH (UPDLOCK, HOLDLOCK)
        WHERE action = @action AND entity_type = @entityType AND entity_id = @entityId`);
    if (marker.recordset?.length) {
      await transaction.commit();
      started = false;
      return { alreadySeeded: true, contextCount: 1, studentCount: 1, documentCount: plan.documents.length };
    }

    const conflict = await transaction.request()
      .input('employeeNo', sqlTypes.NVarChar(50), 'DEMO-STAFF-REG-001')
      .input('studentNo', sqlTypes.NVarChar(50), plan.student.studentNo)
      .input('lrn', sqlTypes.NVarChar(12), plan.student.lrn)
      .input('schoolYear', sqlTypes.NVarChar(20), plan.term.schoolYear)
      .input('termName', sqlTypes.NVarChar(30), plan.term.term)
      .input('subjectCode', sqlTypes.NVarChar(50), plan.subject.code)
      .input('documentName0', sqlTypes.NVarChar(255), plan.documents[0].originalFilename)
      .input('documentName1', sqlTypes.NVarChar(255), plan.documents[1].originalFilename)
      .query(`SELECT
          (SELECT COUNT(*) FROM dbo.staff_profiles AS profile
            INNER JOIN dbo.users AS account ON account.id = profile.user_id
            WHERE profile.employee_no = @employeeNo AND account.role = N'registrar' AND account.is_active = 1) AS registrar_count,
          (SELECT COUNT(*) FROM dbo.students WHERE student_no = @studentNo OR lrn = @lrn) AS student_conflict_count,
          (SELECT COUNT(*) FROM dbo.academic_terms WHERE school_year = @schoolYear AND term = @termName) AS term_conflict_count,
          (SELECT COUNT(*) FROM dbo.subjects WHERE subject_code = @subjectCode) AS subject_conflict_count,
          (SELECT COUNT(*) FROM dbo.documents WHERE original_filename IN (@documentName0, @documentName1)) AS document_conflict_count`);
    const checks = conflict.recordset?.[0];
    if (!checks || Number(checks.registrar_count) !== 1) {
      throw new DemoSeedError('Run the base demo seed first; an active demo registrar account is required.', 409);
    }
    if (Number(checks.student_conflict_count) || Number(checks.term_conflict_count)
      || Number(checks.subject_conflict_count) || Number(checks.document_conflict_count)) {
      throw new DemoSeedError('A grade-demo student, term, subject, or sample document already exists without its seed marker. No records were changed.', 409);
    }

    const storageRoot = await ensurePrivateStorageDirectory({ storageDirectory, publicDirectory, fileSystem });
    const registrarResult = await transaction.request()
      .input('employeeNo', sqlTypes.NVarChar(50), 'DEMO-STAFF-REG-001')
      .query(`SELECT account.id FROM dbo.staff_profiles AS profile
        INNER JOIN dbo.users AS account ON account.id = profile.user_id
        WHERE profile.employee_no = @employeeNo AND account.role = N'registrar' AND account.is_active = 1`);
    const registrarId = registrarResult.recordset?.[0]?.id;
    if (!Number.isSafeInteger(registrarId) || registrarId < 1) throw new Error('Demo registrar lookup returned no identifier.');

    const termResult = await transaction.request()
      .input('schoolYear', sqlTypes.NVarChar(20), plan.term.schoolYear)
      .input('termName', sqlTypes.NVarChar(30), plan.term.term)
      .query(`INSERT INTO dbo.academic_terms (school_year, term, is_current)
        OUTPUT INSERTED.id AS id VALUES (@schoolYear, @termName, 0)`);
    const termId = termResult.recordset?.[0]?.id;
    if (!Number.isSafeInteger(termId) || termId < 1) throw new Error('Demo academic term insert returned no identifier.');

    const sectionResult = await transaction.request()
      .input('sectionName', sqlTypes.NVarChar(100), plan.section.name)
      .input('gradeLevel', sqlTypes.NVarChar(50), plan.section.gradeLevel)
      .input('termId', sqlTypes.Int, termId)
      .query(`INSERT INTO dbo.sections (name, grade_level, academic_term_id)
        OUTPUT INSERTED.id AS id VALUES (@sectionName, @gradeLevel, @termId)`);
    const sectionId = sectionResult.recordset?.[0]?.id;
    if (!Number.isSafeInteger(sectionId) || sectionId < 1) throw new Error('Demo section insert returned no identifier.');

    const studentResult = await transaction.request()
      .input('studentNo', sqlTypes.NVarChar(50), plan.student.studentNo)
      .input('lrn', sqlTypes.NVarChar(12), plan.student.lrn)
      .input('firstName', sqlTypes.NVarChar(100), plan.student.firstName)
      .input('lastName', sqlTypes.NVarChar(100), plan.student.lastName)
      .query(`DECLARE @insertedStudents TABLE (id INT);
        INSERT INTO dbo.students (user_id, student_no, lrn, first_name, last_name, status)
        OUTPUT INSERTED.id INTO @insertedStudents(id)
        VALUES (NULL, @studentNo, @lrn, @firstName, @lastName, N'active');
        SELECT id FROM @insertedStudents`);
    const studentId = studentResult.recordset?.[0]?.id;
    if (!Number.isSafeInteger(studentId) || studentId < 1) throw new Error('Demo student insert returned no identifier.');

    const enrollmentResult = await transaction.request()
      .input('studentId', sqlTypes.Int, studentId)
      .input('termId', sqlTypes.Int, termId)
      .input('sectionId', sqlTypes.Int, sectionId)
      .query(`INSERT INTO dbo.enrollments (student_id, academic_term_id, section_id, enrollment_status)
        OUTPUT INSERTED.id AS id VALUES (@studentId, @termId, @sectionId, N'enrolled')`);
    const enrollmentId = enrollmentResult.recordset?.[0]?.id;
    if (!Number.isSafeInteger(enrollmentId) || enrollmentId < 1) throw new Error('Demo enrollment insert returned no identifier.');

    const subjectResult = await transaction.request()
      .input('subjectCode', sqlTypes.NVarChar(50), plan.subject.code)
      .input('subjectName', sqlTypes.NVarChar(200), plan.subject.name)
      .input('units', sqlTypes.Decimal(5, 2), plan.subject.units)
      .query(`INSERT INTO dbo.subjects (subject_code, subject_name, units)
        OUTPUT INSERTED.id AS id VALUES (@subjectCode, @subjectName, @units)`);
    const subjectId = subjectResult.recordset?.[0]?.id;
    if (!Number.isSafeInteger(subjectId) || subjectId < 1) throw new Error('Demo subject insert returned no identifier.');

    const assignmentResult = await transaction.request()
      .input('enrollmentId', sqlTypes.Int, enrollmentId)
      .input('subjectId', sqlTypes.Int, subjectId)
      .query(`INSERT INTO dbo.student_subjects (enrollment_id, subject_id)
        OUTPUT INSERTED.id AS id VALUES (@enrollmentId, @subjectId)`);
    const assignmentId = assignmentResult.recordset?.[0]?.id;
    if (!Number.isSafeInteger(assignmentId) || assignmentId < 1) throw new Error('Demo subject assignment insert returned no identifier.');

    for (let index = 0; index < plan.documents.length; index += 1) {
      const document = plan.documents[index];
      const extension = path.extname(document.originalFilename).toLowerCase();
      const storedFilename = `${randomId()}${extension}`;
      const storedPath = path.join(storageRoot, storedFilename);
      await fileSystem.writeFile(storedPath, documentBuffers[index], { flag: 'wx', mode: 0o600 });
      storedPaths.push(storedPath);
      await transaction.request()
        .input('studentId', sqlTypes.Int, studentId)
        .input('documentType', sqlTypes.NVarChar(50), document.type)
        .input('originalFilename', sqlTypes.NVarChar(255), document.originalFilename)
        .input('storedFilename', sqlTypes.NVarChar(255), storedFilename)
        .input('mimeType', sqlTypes.NVarChar(100), document.mimeType)
        .input('fileSizeBytes', sqlTypes.BigInt, documentBuffers[index].length)
        .input('uploadedBy', sqlTypes.Int, registrarId)
        .query(`INSERT INTO dbo.documents
          (student_id, document_type, original_filename, stored_filename, mime_type,
            file_size_bytes, uploaded_by, upload_source, status)
          VALUES (@studentId, @documentType, @originalFilename, @storedFilename, @mimeType,
            @fileSizeBytes, @uploadedBy, N'registrar', N'needs_review')`);
    }

    await transaction.request()
      .input('action', sqlTypes.NVarChar(100), 'demo.seeded')
      .input('entityType', sqlTypes.NVarChar(100), 'demo_seed')
      .input('entityId', sqlTypes.NVarChar(100), plan.version)
      .input('detailsJson', sqlTypes.NVarChar(sqlTypes.MAX), JSON.stringify({
        schoolYear: plan.term.schoolYear,
        section: plan.section.name,
        studentNo: plan.student.studentNo,
        subjects: 1,
        documents: plan.documents.length,
        syntheticDocuments: true,
        validationsCreated: 0,
        humanReviewRequired: true
      }))
      .query(`INSERT INTO dbo.audit_logs (user_id, action, entity_type, entity_id, details_json)
        VALUES (NULL, @action, @entityType, @entityId, @detailsJson)`);

    await transaction.commit();
    started = false;
    return {
      alreadySeeded: false,
      contextCount: 1,
      studentCount: 1,
      documentCount: plan.documents.length,
      workbookPath: path.relative(path.resolve(__dirname, '..'), FIXTURE_WORKBOOK)
    };
  } catch (error) {
    if (started) {
      try {
        await transaction.rollback();
      } catch {
        // Preserve the original error without exposing database details.
      }
    }
    for (const storedPath of storedPaths) {
      try {
        await fileSystem.unlink(storedPath);
      } catch {
        // Preserve the original error without exposing filesystem details.
      }
    }
    throw error;
  }
}

async function main(args = process.argv.slice(2)) {
  let shouldClosePool = false;
  try {
    const { mode } = parseOptions(args, process.env.NODE_ENV || 'development');
    const plan = buildGradeDemoPlan();
    if (mode === 'dry-run') {
      process.stdout.write(`Grade/document demo preview: 1 active Grade 11 learner in ${plan.section.name}, ${plan.term.schoolYear}; subject ${plan.subject.name}; ${plan.documents.length} synthetic documents marked for human review. No database changes made.\n`);
      process.stdout.write(`Matching workbook: ${path.relative(path.resolve(__dirname, '..'), FIXTURE_WORKBOOK)}\n`);
      process.stdout.write('Applying requires NODE_ENV=development, --apply, and the local ARKTIESIIS database.\n');
      return;
    }
    assertDevelopmentTarget(environment);
    shouldClosePool = true;
    const result = await seedGradeDemoData();
    process.stdout.write(result.alreadySeeded
      ? 'Grade/document demo sample data already exists; no rows or files were added.\n'
      : `Grade-import context and ${result.documentCount} synthetic review submissions created. Matching workbook: ${result.workbookPath}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof DemoSeedError ? error.message : 'Grade/document demo seeding failed. Check local database and private document storage setup.'}\n`);
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
  DemoSeedError,
  parseOptions,
  buildGradeDemoPlan,
  isInside,
  ensurePrivateStorageDirectory,
  seedGradeDemoData
};
