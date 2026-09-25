const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const bcrypt = require('bcrypt');
const { createApp } = require('../src/app');
const { configuredMaxBytes, documentStatusLabel } = require('../src/routes/documents');
const {
  DocumentServiceError,
  createDocumentService,
  validateUpload,
  verificationChecklistItems
} = require('../src/services/documentService');

function fakeSql() {
  return {
    MAX: 'MAX',
    Int: 'Int',
    BigInt: 'BigInt',
    ISOLATION_LEVEL: { SERIALIZABLE: 'SERIALIZABLE' },
    NVarChar: (length) => `NVarChar(${length})`
  };
}

function makeFile({ name = 'report.pdf', mimeType = 'application/pdf', bytes = Buffer.from('%PDF-1.7\nexample'), size } = {}) {
  return { originalname: name, mimetype: mimeType, buffer: bytes, size: size ?? bytes.length };
}

async function temporaryDirectory() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ark-document-test-'));
}

function confirmedChecklist(documentType) {
  return Object.fromEntries(verificationChecklistItems(documentType).map(({ key }) => [key, 'yes']));
}

test('upload validation requires supported extension, MIME, signature, nonempty content, and configured size', () => {
  assert.equal(configuredMaxBytes({ upload: { maxMb: 0.5 } }), 524288);
  assert.deepEqual(validateUpload(makeFile(), 100), {
    originalFilename: 'report.pdf', extension: '.pdf', mimeType: 'application/pdf', fileSizeBytes: 16
  });
  assert.equal(validateUpload(makeFile({ name: 'scan.PNG', mimeType: 'image/png', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }), 100).mimeType, 'image/png');
  assert.equal(validateUpload(makeFile({ name: 'scan.jpeg', mimeType: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }), 100).extension, '.jpeg');
  assert.throws(() => validateUpload(null, 100), /Choose a PDF/);
  assert.throws(() => validateUpload(makeFile({ bytes: Buffer.alloc(0), size: 0 }), 100), /file is empty/);
  assert.throws(() => validateUpload(makeFile({ size: 101 }), 100), /configured upload limit/);
  assert.throws(() => validateUpload(makeFile({ name: 'report.jpg', mimeType: 'application/pdf' }), 100), /extension and declared file type/);
  assert.throws(() => validateUpload(makeFile({ bytes: Buffer.from('not a pdf') }), 100), /content does not match/);
  assert.throws(() => validateUpload(makeFile({ name: 'report.exe' }), 100), /extension and declared file type/);
});

test('document status labels describe staff actions without implying authenticity', () => {
  assert.equal(documentStatusLabel('valid'), 'Verified after staff source inspection');
  assert.equal(documentStatusLabel('needs_review'), 'Awaiting staff review');
  assert.equal(documentStatusLabel('needs_review', 'correction_requested'), 'Correction requested');
  assert.equal(documentStatusLabel('failed'), 'OCR could not process; staff review required');
  assert.equal(documentStatusLabel('rejected'), 'Rejected after staff review');
});

function transactionHarness({ actorRole = 'student', ownStudentId = 44, previousOwnerId = 7, previousDocumentType = 'good_moral', failAt = null, correctionAction = 'correction_requested', hasRevision = false, documentStatus = 'needs_review', ocrResultStatus = 'needs_review', validationJson = JSON.stringify({ advisoryChecks: [{ key: 'linked_student_name', found: true }] }), previousDecision = null, fileSystem } = {}) {
  const state = { queries: [], inserted: [], events: [], decisions: [], form137Statuses: [], committed: false, rolledBack: false, id: 90, documentStatus, previousDecision };
  const transactionFactory = () => ({
    async begin(isolation) {
      state.isolation = isolation;
      state.transactionSnapshot = {
        documentStatus: state.documentStatus,
        insertedCount: state.inserted.length,
        eventCount: state.events.length,
        decisionCount: state.decisions.length,
        form137StatusCount: state.form137Statuses.length,
        audit: state.audit
      };
    },
    request() {
      const values = {};
      return {
        input(name, _type, value) { values[name] = value; return this; },
        async query(statement) {
          const call = { statement, values: { ...values } };
          state.queries.push(call);
          if (statement.includes('FROM dbo.users')) return { recordset: actorRole ? [{ id: 7, role: actorRole }] : [] };
          if (statement.includes('OUTER APPLY')) return { recordset: [{ id: values.documentId, student_id: 44, document_type: previousDocumentType, status: state.documentStatus, result_status: ocrResultStatus, validation_json: validationJson }] };
          if (statement.includes('FROM dbo.students') && statement.includes('WHERE user_id = @actorId')) return { recordset: ownStudentId ? [{ id: ownStudentId }] : [] };
          if (statement.includes('FROM dbo.students') && statement.includes('WHERE id = @studentId')) return { recordset: [{ id: values.studentId }] };
          if (statement.includes('FROM dbo.documents AS d')) return { recordset: [{ id: values.documentId, student_id: 44, document_type: previousDocumentType, status: 'needs_review', student_user_id: previousOwnerId }] };
          if (statement.includes('FROM dbo.documents WITH')) return { recordset: [{ id: values.documentId, student_id: 44, document_type: 'good_moral' }] };
          if (statement.includes('FROM dbo.document_decision_events')) return { recordset: state.previousDecision ? [{ decision_type: state.previousDecision }] : [] };
          if (statement.includes('FROM dbo.document_review_events')) return { recordset: correctionAction ? [{ action_type: correctionAction }] : [] };
          if (statement.includes('SELECT TOP (1) id FROM dbo.documents')) return { recordset: hasRevision ? [{ id: 91 }] : [] };
          if (statement.includes('INSERT INTO dbo.documents')) {
            if (failAt === 'insert') throw new Error('database details are private');
            state.inserted.push(call);
            return { recordset: [{ id: state.id++ }] };
          }
          if (statement.includes('INSERT INTO dbo.document_review_events')) { state.events.push(call); return { recordset: [] }; }
          if (statement.includes('INSERT INTO dbo.document_decision_events')) { state.decisions.push(call); return { recordset: [] }; }
          if (statement.includes('INSERT INTO dbo.form137_status_events')) { state.form137Statuses.push(call); return { recordset: [] }; }
          if (statement.includes('UPDATE dbo.documents')) {
            if (statement.includes('@nextStatus')) {
              if (state.documentStatus !== values.currentStatus || !['needs_review', 'failed'].includes(state.documentStatus)) return { recordset: [] };
              state.documentStatus = values.nextStatus;
              return { recordset: [{ id: values.documentId }] };
            }
            return { recordset: [] };
          }
          if (statement.includes('INSERT INTO dbo.audit_logs')) {
            if (failAt === 'audit') throw new Error('database details are private');
            state.audit = call;
            return { recordset: [] };
          }
          throw new Error(`Unexpected SQL: ${statement}`);
        }
      };
    },
    async commit() { if (failAt === 'commit') throw new Error('database details are private'); state.committed = true; },
    async rollback() {
      state.rolledBack = true;
      const snapshot = state.transactionSnapshot;
      if (!snapshot) return;
      state.documentStatus = snapshot.documentStatus;
      state.inserted.length = snapshot.insertedCount;
      state.events.length = snapshot.eventCount;
      state.decisions.length = snapshot.decisionCount;
      state.form137Statuses.length = snapshot.form137StatusCount;
      if (snapshot.audit === undefined) delete state.audit;
      else state.audit = snapshot.audit;
    }
  });
  const service = createDocumentService({ getPool: async () => ({}), sql: fakeSql(), transactionFactory, maxUploadBytes: 100, fileSystem });
  return { state, transactionFactory, service };
}

// Replace test service with a storage-root-scoped instance while retaining the same SQL fixture.
function serviceWithStorage(harness, storageDirectory, fileSystem, logger) {
  return createDocumentService({
    getPool: async () => ({}),
    sql: fakeSql(),
    transactionFactory: harness.transactionFactory,
    maxUploadBytes: 100,
    storageDirectory,
    fileSystem,
    logger
  });
}

test('student upload derives the linked student record, checks private storage permissions where supported, and audits without file contents', async () => {
  const directory = await temporaryDirectory();
  try {
    const harness = transactionHarness();
    const service = serviceWithStorage(harness, directory);
    await service.upload(7, { documentType: 'report_card', studentId: '999' }, makeFile());
    const insert = harness.state.inserted[0];
    assert.equal(insert.values.studentId, 44);
    assert.equal(insert.values.documentType, 'report_card');
    assert.equal(insert.values.uploadSource, 'student');
    assert.match(insert.statement, /'pending'/);
    assert.match(insert.values.storedFilename, /^[0-9a-f-]+\.pdf$/i);
    assert.notEqual(insert.values.storedFilename, 'report.pdf');
    assert.equal(harness.state.committed, true);
    assert.equal(harness.state.isolation, 'SERIALIZABLE');
    assert.equal(harness.state.audit.values.action, 'student.document_uploaded');
    assert.equal(harness.state.audit.values.detailsJson.includes('report.pdf'), false);
    assert.equal(harness.state.audit.values.detailsJson.includes('example'), false);
    const storedPath = path.join(directory, insert.values.storedFilename);
    assert.equal((await fs.readFile(storedPath)).toString(), '%PDF-1.7\nexample');
    // Windows uses ACLs; Node's chmod mode does not expose owner/group/other privacy bits.
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(storedPath)).mode & 0o777, 0o600);
      assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
    }
    assert.match(path.relative(directory, storedPath), /^[-0-9a-f]+\.pdf$/i);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('document storage rejects a location inside the public web directory', () => {
  const publicStorageDirectory = path.resolve(__dirname, '../public/private-uploads');
  assert.throws(() => createDocumentService({ storageDirectory: publicStorageDirectory }), /outside the public web directory/);
});

test('Form 137 cannot be uploaded and students cannot access an unlinked account', async () => {
  const directory = await temporaryDirectory();
  try {
    const restricted = transactionHarness();
    await assert.rejects(serviceWithStorage(restricted, directory).upload(7, { documentType: 'form_137', studentId: '44' }, makeFile()), /physical document status/);
    assert.equal(restricted.state.inserted.length, 0);
    assert.deepEqual(await fs.readdir(directory), []);

    const unlinked = transactionHarness({ ownStudentId: null });
    await assert.rejects(serviceWithStorage(unlinked, directory).upload(7, { documentType: 'good_moral' }, makeFile()), /No student record is linked/);
    assert.equal(unlinked.state.inserted.length, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('student re-upload creates a linked immutable submission only after a correction request', async () => {
  const directory = await temporaryDirectory();
  try {
    const harness = transactionHarness({ correctionAction: 'correction_requested' });
    const service = serviceWithStorage(harness, directory);
    const result = await service.reupload(7, '12', makeFile({ name: 'corrected.pdf' }));
    assert.equal(result.id, 90);
    assert.equal(harness.state.inserted[0].values.studentId, 44);
    assert.equal(harness.state.inserted[0].values.documentType, 'good_moral');
    assert.equal(harness.state.inserted[0].values.supersedesDocumentId, 12);
    assert.equal(harness.state.inserted[0].values.originalFilename, 'corrected.pdf');
    assert.equal(harness.state.queries.some(({ statement }) => statement.startsWith('UPDATE dbo.documents')), false);
    assert.equal(harness.state.audit.values.action, 'student.document_reuploaded');

    const noRequest = transactionHarness({ correctionAction: null });
    await assert.rejects(serviceWithStorage(noRequest, directory).reupload(7, '12', makeFile()), /has not been requested/);
    assert.equal(noRequest.state.inserted.length, 0);
    const alreadyReuploaded = transactionHarness({ hasRevision: true });
    await assert.rejects(serviceWithStorage(alreadyReuploaded, directory).reupload(7, '12', makeFile()), /already been submitted/);

    const restrictedType = transactionHarness({ previousDocumentType: 'form_137' });
    await assert.rejects(serviceWithStorage(restrictedType, directory).reupload(7, '12', makeFile()), /Document not found/);
    assert.equal(restrictedType.state.inserted.length, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('student document lists exclude staff-only document types for the linked record', async () => {
  const rows = [
    { id: 1, document_type: 'good_moral' },
    { id: 2, document_type: 'report_card' },
    { id: 3, document_type: 'form_137' },
    { id: 4, document_type: 'psa_birth_certificate', upload_source: 'registrar' },
    { id: 5, document_type: 'psa_birth_certificate', upload_source: 'student' }
  ];
  let listSql = '';
  const pool = {
    request() {
      const values = {};
      return {
        input(name, _type, value) { values[name] = value; return this; },
        async query(statement) {
          if (statement.startsWith('SELECT id, role FROM dbo.users')) return { recordset: [{ id: values.actorId, role: 'student' }] };
          if (statement.includes('dbo.form137_status_events')) return { recordset: [] };
          listSql = statement;
          const allowedTypeFilter = statement.includes("d.document_type IN ('good_moral', 'report_card')")
            && statement.includes("d.upload_source IN ('registrar', 'database_admin')");
          return { recordset: allowedTypeFilter ? rows.filter((row) => ['good_moral', 'report_card'].includes(row.document_type) || (row.document_type === 'psa_birth_certificate' && row.upload_source === 'registrar')) : rows };
        }
      };
    }
  };
  const service = createDocumentService({ getPool: async () => pool, sql: fakeSql() });
  const result = await service.listDocuments(7);
  assert.deepEqual(result.documents.map(({ document_type }) => document_type), ['good_moral', 'report_card', 'psa_birth_certificate']);
  assert.match(listSql, /s\.user_id = @actorId AND \(/);
  assert.match(listSql, /d\.upload_source IN \('registrar', 'database_admin'\)/);
  assert.match(listSql, /latest_decision\.decision_type AS latest_decision_type/);
  assert.match(listSql, /FROM dbo\.document_decision_events AS e/);
  assert.equal(result.form137Status.status, 'not_recorded');
});

test('OCR details are fetched only for registrar and database administrator document views', async () => {
  const document = {
    id: 88,
    student_id: 44,
    document_type: 'report_card',
    original_filename: 'report.pdf',
    stored_filename: '5dd677e1-87fb-4214-a7c1-27aca233ae1f.pdf',
    mime_type: 'application/pdf',
    file_size_bytes: 100,
    uploaded_by: 7,
    upload_source: 'student',
    status: 'needs_review',
    supersedes_document_id: null,
    created_at: new Date(),
    student_user_id: 7,
    student_no: 'S-44',
    first_name: 'Test',
    middle_name: null,
    last_name: 'Student',
    uploader_role: 'student'
  };

  async function readAsRole(role, { deactivateAfterDocumentRead = false, checklistSchemaVersion = 1 } = {}) {
    const queries = [];
    let staffIsActive = true;
    const pool = {
      request() {
        const values = {};
        return {
          input(name, _type, value) { values[name] = value; return this; },
          async query(statement) {
            queries.push({ statement, values: { ...values } });
            if (statement.includes('SELECT id, role FROM dbo.users')) return { recordset: [{ id: 7, role }] };
            if (statement.includes('FROM dbo.documents AS d') && statement.includes('WHERE d.id = @documentId')) {
              if (deactivateAfterDocumentRead) staffIsActive = false;
              return { recordset: [{ ...document }] };
            }
            if (statement.includes('FROM dbo.documents AS history_document')) return { recordset: [] };
            if (statement.includes('FROM dbo.documents AS d') && statement.includes('WHERE d.student_id = @studentId')) return { recordset: [{ id: 88, original_filename: 'report.pdf', status: 'needs_review' }] };
            if (statement.includes('FROM dbo.document_review_events AS e')) return { recordset: [] };
            if (statement.includes('FROM dbo.document_decision_events AS e')) return { recordset: [{
              id: 5, decision_type: 'verified', reason: null,
              verification_checklist_json: role === 'student' ? null : JSON.stringify({
                schemaVersion: checklistSchemaVersion,
                linkedStudentNameLegible: true,
                schoolNameLegible: true,
                selectedDocumentTypeCorrect: true,
                allSubmittedPagesReadableComplete: true
              }),
              created_at: new Date(), reviewer_name: null
            }] };
            if (statement.includes('FROM dbo.document_validations')) return { recordset: staffIsActive ? [{
              id: 4,
              processor: 'Tesseract OCR',
              extracted_text: '<script>unsafe OCR text</script>',
              validation_json: JSON.stringify({
                outcome: 'extracted', message: 'ignored untrusted message',
                advisoryChecks: [
                  { key: 'linked_student_name', found: true },
                  { key: 'possible_school_name', found: true, candidates: ['Other Academy'] },
                  { key: 'apparent_grade_entries', found: false, candidates: ['Mathematics 59'] }
                ]
              }),
              result_status: 'needs_review',
              created_at: new Date()
            }] : [] };
            throw new Error(`Unexpected read SQL: ${statement}`);
          }
        };
      }
    };
    const service = createDocumentService({ getPool: async () => pool, sql: fakeSql() });
    return { result: await service.getDocument(7, '88'), queries };
  }

  const student = await readAsRole('student');
  assert.equal(student.result.validation, null);
  assert.deepEqual(student.result.decisions[0].verificationChecklist, []);
  assert.equal(student.queries.some(({ statement }) => statement.includes('FROM dbo.document_validations')), false);
  const studentDecisionQuery = student.queries.find(({ statement }) => statement.includes('FROM dbo.document_decision_events AS e'));
  assert.match(studentDecisionQuery.statement, /CAST\(NULL AS NVARCHAR\(500\)\) AS verification_checklist_json/);

  const registrar = await readAsRole('registrar');
  assert.equal(registrar.result.validation.extracted_text, '<script>unsafe OCR text</script>');
  assert.equal(registrar.result.validation.message, 'OCR text was extracted. Advisory checks are available; registrar or database administrator source inspection is required.');
  assert.deepEqual(registrar.result.validation.advisoryChecks.map(({ key }) => key), ['linked_student_name', 'possible_school_name']);
  assert.equal(registrar.result.validation.requiresOverrideReason, false, 'retired grade-entry OCR suggestions no longer affect review');
  assert.deepEqual(registrar.result.decisions[0].verificationChecklist, verificationChecklistItems('report_card').map(({ label }) => label));
  const validationQuery = registrar.queries.find(({ statement }) => statement.includes('FROM dbo.document_validations'));
  assert.ok(validationQuery);
  assert.match(validationQuery.statement, /id = @actorId AND is_active = 1 AND role IN \('registrar', 'database_admin'\)/);
  assert.equal(validationQuery.values.actorId, 7);

  const unknownChecklistVersion = await readAsRole('registrar', { checklistSchemaVersion: 2 });
  assert.deepEqual(unknownChecklistVersion.result.decisions[0].verificationChecklist, [], 'history does not reinterpret an unknown checklist version');

  const revokedRegistrar = await readAsRole('registrar', { deactivateAfterDocumentRead: true });
  assert.equal(revokedRegistrar.result.validation, null, 'active-role recheck prevents OCR text disclosure after access is revoked');
});

test('student decision history lets a final decision supersede correction and hides staff decision reasons', async () => {
  for (const finalDecision of ['verified', 'rejected']) {
    const queries = [];
    const pool = {
      request() {
        const values = {};
        return {
          input(name, _type, value) { values[name] = value; return this; },
          async query(statement) {
            queries.push(statement);
            if (statement.startsWith('SELECT id, role FROM dbo.users')) return { recordset: [{ id: 7, role: 'student' }] };
            if (statement.includes('FROM dbo.documents AS d') && statement.includes('WHERE d.id = @documentId')) {
              return { recordset: [{
                id: 88, student_id: 44, document_type: 'report_card', original_filename: 'report.pdf',
                stored_filename: '5dd677e1-87fb-4214-a7c1-27aca233ae1f.pdf', mime_type: 'application/pdf',
                file_size_bytes: 100, uploaded_by: 7, upload_source: 'student', status: finalDecision === 'verified' ? 'valid' : 'rejected',
                supersedes_document_id: null, created_at: new Date(), student_user_id: 7,
                student_no: 'S-44', first_name: 'Test', middle_name: null, last_name: 'Student', uploader_role: 'student'
              }] };
            }
            if (statement.includes('FROM dbo.documents AS history_document')) return { recordset: [] };
            if (statement.includes('FROM dbo.documents AS d') && statement.includes('WHERE d.student_id = @studentId')) return { recordset: [] };
            if (statement.includes('FROM dbo.document_review_events AS e')) return { recordset: [] };
            if (statement.includes('FROM dbo.document_decision_events AS e')) return { recordset: [
              { id: 2, decision_type: finalDecision, reason: null, verification_checklist_json: null, created_at: new Date(), reviewer_name: null },
              { id: 1, decision_type: 'correction_requested', reason: 'Upload a clearer report card.', created_at: new Date(Date.now() - 1000), reviewer_name: null }
            ] };
            throw new Error(`Unexpected read SQL: ${statement}`);
          }
        };
      }
    };
    const result = await createDocumentService({ getPool: async () => pool, sql: fakeSql() }).getDocument(7, '88');
    assert.equal(result.decisions[0].decision_type, finalDecision);
    assert.equal(result.decisions[0].reason, null);
    assert.equal(result.decisions[0].reviewer_name, null);
    assert.deepEqual(result.decisions[0].verificationChecklist, [], 'students do not receive stored staff attestations');
    assert.equal(result.decisions[1].reason, 'Upload a clearer report card.');
    const studentDecisionSql = queries.find((statement) => statement.includes('FROM dbo.document_decision_events AS e'));
    assert.match(studentDecisionSql, /CASE WHEN e\.decision_type = 'correction_requested' AND @documentType <> 'psa_birth_certificate' THEN e\.reason ELSE NULL END AS reason/);
    assert.doesNotMatch(studentDecisionSql, /AND e\.decision_type = 'correction_requested'/);
    assert.doesNotMatch(studentDecisionSql, /JOIN dbo\.staff_profiles/);
    assert.match(studentDecisionSql, /CAST\(NULL AS NVARCHAR\(500\)\) AS verification_checklist_json/);
  }
});

test('student views of staff-uploaded PSA files hide staff-only correction instructions', async () => {
  const queries = [];
  const document = {
    id: 88,
    student_id: 44,
    document_type: 'psa_birth_certificate',
    original_filename: 'psa.pdf',
    stored_filename: '5dd677e1-87fb-4214-a7c1-27aca233ae1f.pdf',
    mime_type: 'application/pdf',
    file_size_bytes: 100,
    uploaded_by: 9,
    upload_source: 'registrar',
    status: 'needs_review',
    supersedes_document_id: null,
    created_at: new Date(),
    student_user_id: 7,
    student_no: 'S-44',
    first_name: 'Test',
    middle_name: null,
    last_name: 'Student',
    uploader_role: 'registrar'
  };
  const pool = {
    request() {
      const values = {};
      return {
        input(name, _type, value) { values[name] = value; return this; },
        async query(statement) {
          queries.push({ statement, values: { ...values } });
          if (statement.startsWith('SELECT id, role FROM dbo.users')) return { recordset: [{ id: 7, role: 'student' }] };
          if (statement.includes('FROM dbo.documents AS d') && statement.includes('WHERE d.id = @documentId')) return { recordset: [{ ...document }] };
          if (statement.includes('FROM dbo.documents AS history_document')) return { recordset: [] };
          if (statement.includes('FROM dbo.documents AS d') && statement.includes('WHERE d.student_id = @studentId')) return { recordset: [] };
          if (statement.includes('FROM dbo.document_review_events AS e')) return { recordset: [] };
          if (statement.includes('FROM dbo.document_decision_events AS e')) return { recordset: [
            { id: 2, decision_type: 'correction_requested', reason: values.documentType === 'psa_birth_certificate' ? null : 'Internal staff instruction.', created_at: new Date(), reviewer_name: null }
          ] };
          throw new Error(`Unexpected read SQL: ${statement}`);
        }
      };
    }
  };

  const result = await createDocumentService({ getPool: async () => pool, sql: fakeSql() }).getDocument(7, '88');
  assert.equal(result.decisions[0].reason, null);
  const reviewQuery = queries.find(({ statement }) => statement.includes('FROM dbo.document_review_events AS e'));
  const decisionQuery = queries.find(({ statement }) => statement.includes('FROM dbo.document_decision_events AS e'));
  assert.equal(reviewQuery.values.documentType, 'psa_birth_certificate');
  assert.match(reviewQuery.statement, /@documentType <> 'psa_birth_certificate'/);
  assert.equal(decisionQuery.values.documentType, 'psa_birth_certificate');
  assert.match(decisionQuery.statement, /AND @documentType <> 'psa_birth_certificate' THEN e\.reason/);
});

test('failed document insert, audit, or transaction commit removes an unreferenced private file', async () => {
  for (const failAt of ['insert', 'audit', 'commit']) {
    const directory = await temporaryDirectory();
    try {
      const harness = transactionHarness({ failAt });
      const service = serviceWithStorage(harness, directory);
      await assert.rejects(service.upload(7, { documentType: 'good_moral' }, makeFile()));
      assert.equal(harness.state.rolledBack, true);
      assert.deepEqual(await fs.readdir(directory), [], `file leaked after ${failAt} failure`);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
});

test('failed file cleanup returns a safe storage error without exposing database details', async () => {
  const directory = await temporaryDirectory();
  try {
    const harness = transactionHarness({ failAt: 'insert' });
    const failingFileSystem = {
      ...fs,
      async unlink() { throw new Error('private filesystem path and details'); }
    };
    const service = serviceWithStorage(harness, directory, failingFileSystem, { error() {} });
    await assert.rejects(service.upload(7, { documentType: 'good_moral' }, makeFile()), (error) => {
      assert.equal(error.status, 503);
      assert.match(error.message, /temporary file could not be removed/);
      assert.doesNotMatch(error.message, /private filesystem|database details/);
      return true;
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('finance and inactive actors are rejected before document writes', async () => {
  const directory = await temporaryDirectory();
  try {
    const finance = transactionHarness({ actorRole: 'finance' });
    await assert.rejects(serviceWithStorage(finance, directory).upload(7, { documentType: 'good_moral', studentId: '44' }, makeFile()), /access is no longer active/);
    assert.equal(finance.state.inserted.length, 0);
    const inactive = transactionHarness({ actorRole: null });
    await assert.rejects(serviceWithStorage(inactive, directory).upload(7, { documentType: 'good_moral' }, makeFile()), /access is no longer active/);
    assert.deepEqual(await fs.readdir(directory), []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('registrar can upload restricted document types and record correction/review events atomically', async () => {
  const directory = await temporaryDirectory();
  try {
    const uploadHarness = transactionHarness({ actorRole: 'registrar' });
    const service = serviceWithStorage(uploadHarness, directory);
    const physicalOnly = transactionHarness({ actorRole: 'registrar' });
    await assert.rejects(serviceWithStorage(physicalOnly, directory).upload(7, { studentId: '22', documentType: 'form_137' }, makeFile()), /physical document status/);
    assert.equal(physicalOnly.state.inserted.length, 0);
    const uploaded = await service.upload(7, { studentId: '22', documentType: 'psa_birth_certificate' }, makeFile());
    assert.equal(uploadHarness.state.inserted[0].values.studentId, 22);
    assert.equal(uploadHarness.state.inserted[0].values.documentType, 'psa_birth_certificate');
    assert.equal(uploadHarness.state.audit.values.action, 'registrar.document_uploaded');
    assert.ok(uploaded.id > 0);

    const reviewHarness = transactionHarness({ actorRole: 'registrar' });
    const reviewService = serviceWithStorage(reviewHarness, directory);
    await reviewService.addReviewEvent(7, '12', 'correction_requested', 'Upload a clearer report card.');
    assert.equal(reviewHarness.state.events[0].values.reviewerId, 7);
    assert.equal(reviewHarness.state.events[0].values.instruction, 'Upload a clearer report card.');
    assert.equal(reviewHarness.state.queries.some(({ statement }) => statement.includes('UPDATE dbo.documents')), false, 'review handoff does not disturb pending or processing OCR state');
    assert.equal(reviewHarness.state.audit.values.action, 'registrar.document_correction_requested');
    assert.equal(reviewHarness.state.audit.values.detailsJson.includes('clearer'), false);

    const correctedRestrictedDocument = transactionHarness({
      actorRole: 'registrar', previousDocumentType: 'psa_birth_certificate', correctionAction: 'correction_requested'
    });
    await serviceWithStorage(correctedRestrictedDocument, directory).reupload(7, '12', makeFile({ name: 'corrected.pdf' }));
    assert.equal(correctedRestrictedDocument.state.inserted[0].values.studentId, 44);
    assert.equal(correctedRestrictedDocument.state.inserted[0].values.documentType, 'psa_birth_certificate');
    assert.equal(correctedRestrictedDocument.state.inserted[0].values.supersedesDocumentId, 12);
    assert.equal(correctedRestrictedDocument.state.audit.values.action, 'registrar.document_reuploaded');

    const studentHarness = transactionHarness();
    await assert.rejects(serviceWithStorage(studentHarness, directory).addReviewEvent(7, '12', 'review_requested'), /access is no longer active/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('registrar and database administrator can only set Form 137 physical statuses, with correction instructions audited', async () => {
  const registrar = transactionHarness({ actorRole: 'registrar' });
  const result = await registrar.service.recordForm137Status(7, '44', 'correction', 'Bring a clearer paper copy to the registrar.');
  assert.deepEqual(result, { studentId: 44, status: 'correction' });
  assert.equal(registrar.state.form137Statuses[0].values.status, 'correction');
  assert.equal(registrar.state.form137Statuses[0].values.instruction, 'Bring a clearer paper copy to the registrar.');
  assert.equal(registrar.state.inserted.length, 0, 'physical status does not create a document upload');
  assert.equal(registrar.state.audit.values.action, 'registrar.form137_status_recorded');
  assert.equal(registrar.state.audit.values.detailsJson.includes('clearer paper copy'), false);

  const verifiedAfterScanFailure = transactionHarness({ actorRole: 'registrar' });
  await verifiedAfterScanFailure.service.recordForm137Status(7, '44', 'verified', '');
  assert.equal(verifiedAfterScanFailure.state.form137Statuses[0].values.status, 'verified');
  assert.equal(verifiedAfterScanFailure.state.form137Statuses[0].values.instruction, null);
  assert.equal(verifiedAfterScanFailure.state.inserted.length, 0, 'a physical status decision stores no scan or OCR record');

  const missingInstruction = transactionHarness({ actorRole: 'database_admin' });
  await assert.rejects(missingInstruction.service.recordForm137Status(7, '44', 'correction'), /instruction when requesting/);
  assert.equal(missingInstruction.state.form137Statuses.length, 0);
  await assert.rejects(missingInstruction.service.recordForm137Status(7, '44', 'unknown'), /valid Form 137 status/);

  const student = transactionHarness({ actorRole: 'student' });
  await assert.rejects(student.service.recordForm137Status(7, '44', 'received'), /access is no longer active/);
});

test('manual decisions require completed OCR, append history, and only verification sets valid', async () => {
  const missingChecklist = transactionHarness({ actorRole: 'registrar' });
  await assert.rejects(
    missingChecklist.service.decideDocument(7, '12', 'verified', 'I inspected this source.'),
    /Confirm every applicable source-inspection checklist item/
  );
  assert.equal(missingChecklist.state.decisions.length, 0);
  assert.equal(missingChecklist.state.documentStatus, 'needs_review');
  assert.equal(missingChecklist.state.rolledBack, true);

  const tamperedChecklist = transactionHarness({ actorRole: 'registrar' });
  await assert.rejects(tamperedChecklist.service.decideDocument(7, '12', 'verified', 'I inspected this source.', {
    ...confirmedChecklist('good_moral'), schoolNameLegible: 'no'
  }), /Confirm every applicable source-inspection checklist item/);
  assert.equal(tamperedChecklist.state.decisions.length, 0);

  const warning = transactionHarness({
    actorRole: 'registrar',
    validationJson: JSON.stringify({ advisoryChecks: [{ key: 'linked_student_name', found: false }] })
  });
  await assert.rejects(warning.service.decideDocument(7, '12', 'verified', '', confirmedChecklist('good_moral')), /reason to verify/);
  assert.equal(warning.state.decisions.length, 0);

  const verified = await warning.service.decideDocument(7, '12', 'verified', 'I inspected the source file and confirmed the student details.', confirmedChecklist('good_moral'));
  assert.deepEqual(verified, { id: 12, status: 'valid', decision: 'verified' });
  assert.equal(warning.state.documentStatus, 'valid');
  assert.equal(warning.state.decisions.length, 1);
  assert.deepEqual(JSON.parse(warning.state.decisions[0].values.verificationChecklistJson), {
    schemaVersion: 1,
    linkedStudentNameLegible: true,
    schoolNameLegible: true,
    selectedDocumentTypeCorrect: true,
    allSubmittedPagesReadableComplete: true
  });
  assert.match(warning.state.queries.find(({ statement }) => statement.includes('FROM dbo.documents AS d WITH (UPDLOCK, HOLDLOCK)')).statement, /OUTER APPLY/);
  assert.equal(warning.state.audit.values.action, 'registrar.document_review_verified');
  assert.equal(warning.state.audit.values.detailsJson.includes('confirmed the student details'), false);
  await assert.rejects(warning.service.decideDocument(7, '12', 'rejected', 'Duplicate'), /finish OCR/);

  const correction = transactionHarness({ actorRole: 'database_admin' });
  await correction.service.decideDocument(7, '12', 'correction_requested', 'Upload a clearer report card.');
  assert.equal(correction.state.decisions[0].values.decisionType, 'correction_requested');
  assert.equal(correction.state.documentStatus, 'needs_review');
  assert.equal(correction.state.audit.values.action, 'database_admin.document_review_correction_requested');

  const auditFailure = transactionHarness({ actorRole: 'registrar', failAt: 'audit' });
  await assert.rejects(auditFailure.service.decideDocument(
    7, '12', 'verified', 'I inspected the source.', confirmedChecklist('good_moral')
  ));
  assert.equal(auditFailure.state.rolledBack, true);
  assert.equal(auditFailure.state.documentStatus, 'needs_review');
  assert.equal(auditFailure.state.decisions.length, 0, 'checklist decision is rolled back when its audit event cannot be recorded');
  assert.equal(auditFailure.state.audit, undefined);
});

test('verification requires and stores the applicable checklist for each digital document type', async () => {
  for (const role of ['registrar', 'database_admin']) {
    for (const documentType of ['report_card', 'good_moral', 'psa_birth_certificate']) {
      const allowed = transactionHarness({ actorRole: role, previousDocumentType: documentType });
      const checklist = confirmedChecklist(documentType);
      await allowed.service.decideDocument(7, '12', 'verified', 'I inspected the submitted source.', checklist);
      const parsedChecklist = JSON.parse(allowed.state.decisions[0].values.verificationChecklistJson);
      assert.equal(parsedChecklist.schemaVersion, 1, `${role} ${documentType} records a stable checklist schema version`);
      assert.equal(parsedChecklist.linkedStudentNameLegible, true, `${role} ${documentType} records linked-name inspection`);
      assert.equal(parsedChecklist.selectedDocumentTypeCorrect, true, `${role} ${documentType} records type inspection`);
      assert.equal(parsedChecklist.allSubmittedPagesReadableComplete, true, `${role} ${documentType} records page inspection`);
      assert.equal(Object.hasOwn(parsedChecklist, 'schoolNameLegible'), documentType !== 'psa_birth_certificate');
      assert.equal(allowed.state.audit.values.action, `${role}.document_review_verified`);
    }
  }

  for (const role of ['student', 'finance']) {
    const denied = transactionHarness({ actorRole: role });
    await assert.rejects(denied.service.decideDocument(7, '12', 'verified', 'Reviewed', confirmedChecklist('good_moral')), /access is no longer active/);
    assert.equal(denied.state.decisions.length, 0);
    assert.equal(denied.state.rolledBack, true);
  }
});

test('OCR failure and legacy OCR without advisory results require an override reason', async () => {
  const failed = transactionHarness({
    actorRole: 'registrar', documentStatus: 'failed', ocrResultStatus: 'failed',
    validationJson: JSON.stringify({ outcome: 'processor_unavailable' })
  });
  await assert.rejects(failed.service.decideDocument(7, '12', 'verified', '', confirmedChecklist('good_moral')), /reason to verify/);
  await failed.service.decideDocument(7, '12', 'verified', 'I inspected the original source despite OCR failure.', confirmedChecklist('good_moral'));
  assert.equal(failed.state.documentStatus, 'valid');

  const legacy = transactionHarness({
    actorRole: 'registrar', validationJson: JSON.stringify({ stage: 'ocr', outcome: 'extracted' })
  });
  await assert.rejects(legacy.service.decideDocument(7, '12', 'verified', '', confirmedChecklist('good_moral')), /reason to verify/);
  await legacy.service.decideDocument(7, '12', 'verified', 'I inspected the source; this legacy OCR result has no advisory checks.', confirmedChecklist('good_moral'));
  assert.equal(legacy.state.documentStatus, 'valid');

  const partialLegacy = transactionHarness({
    actorRole: 'registrar',
    validationJson: JSON.stringify({
      stage: 'ocr', outcome: 'extracted',
      advisoryChecks: [{ key: 'linked_student_name', found: true }]
    })
  });
  await assert.rejects(partialLegacy.service.decideDocument(7, '12', 'verified', '', confirmedChecklist('good_moral')), /reason to verify/);
  await partialLegacy.service.decideDocument(7, '12', 'verified', 'I inspected the source; the legacy advisory set is incomplete.', confirmedChecklist('good_moral'));
  assert.equal(partialLegacy.state.documentStatus, 'valid');

  const malformedCandidates = transactionHarness({
    actorRole: 'registrar',
    validationJson: JSON.stringify({ advisoryChecks: [
      { key: 'linked_student_name', found: true },
      { key: 'possible_school_name', found: true }
    ] })
  });
  await assert.rejects(malformedCandidates.service.decideDocument(7, '12', 'verified', '', confirmedChecklist('good_moral')), /reason to verify/);
  await malformedCandidates.service.decideDocument(7, '12', 'verified', 'I inspected the source; candidate text is missing from the stored OCR summary.', confirmedChecklist('good_moral'));
  assert.equal(malformedCandidates.state.documentStatus, 'valid');

  const processing = transactionHarness({ actorRole: 'registrar', documentStatus: 'processing' });
  await assert.rejects(processing.service.decideDocument(7, '12', 'verified', 'Reviewed', confirmedChecklist('good_moral')), /finish OCR/);
  assert.equal(processing.state.decisions.length, 0, 'a staff decision cannot race an active OCR lease');
  const noResult = transactionHarness({ actorRole: 'registrar', ocrResultStatus: null, validationJson: null });
  await assert.rejects(noResult.service.decideDocument(7, '12', 'verified', 'Reviewed', confirmedChecklist('good_moral')), /OCR result must be recorded/);
  assert.equal(noResult.state.decisions.length, 0);
});

async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function csrfFromHtml(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  assert.ok(match, 'expected CSRF token');
  return match[1];
}

function sessionCookie(response) {
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie, 'expected session cookie');
  return cookie.split(';', 1)[0];
}

function authPool(users) {
  return async () => ({
    request() {
      const values = {};
      return {
        input(name, _type, value) { values[name] = value; return this; },
        async query(statement) {
          if (statement.includes('WHERE email = @email')) {
            const user = users.find((candidate) => candidate.email === values.email);
            return { recordset: user ? [{ ...user }] : [] };
          }
          if (statement.includes('WHERE id = @userId')) {
            const user = users.find((candidate) => candidate.id === values.userId);
            return { recordset: user ? [{ ...user, updated_at_fingerprint: '' }] : [] };
          }
          throw new Error(`Unexpected auth SQL: ${statement}`);
        }
      };
    }
  });
}

async function login(baseUrl, email) {
  const loginPage = await fetch(`${baseUrl}/login`);
  const anonymousCookie = sessionCookie(loginPage);
  const csrfToken = csrfFromHtml(await loginPage.text());
  const response = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: anonymousCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrfToken, email, password: 'Correct-Horse-Battery-12' })
  });
  assert.equal(response.status, 303);
  return sessionCookie(response);
}

test('HTTP document routes enforce role matrix and CSRF before writes', async () => {
  const passwordHash = await bcrypt.hash('Correct-Horse-Battery-12', 4);
  const users = ['student', 'registrar', 'finance', 'database_admin'].map((role, index) => ({
    id: index + 1,
    email: `${role}@example.edu`,
    password_hash: passwordHash,
    role,
    is_active: true
  }));
  const calls = [];
  const processingCalls = [];
  const scanCalls = [];
  const decisionCalls = [];
  const uploadedBuffers = [];
  const scanBuffers = [];
  const documentService = {
    async listDocuments(actorId) {
      calls.push(['list', actorId]);
      return {
        documents: [], searchTerm: '', isStaff: actorId !== 1,
        form137Status: { status: 'not_recorded', instruction: null, created_at: null }
      };
    },
    async getStudentDocuments(actorId, studentId) {
      calls.push(['student', actorId, studentId]);
      return {
        student: { id: studentId, student_no: 'S-1', first_name: 'Test', last_name: 'Student' },
        documents: [], form137Status: { status: 'not_recorded', instruction: null, created_at: null }, form137StatusHistory: []
      };
    },
    async upload(actorId, body, file) {
      if (body.documentType === 'form_137') throw new DocumentServiceError('Form 137 is tracked as a physical status only.');
      if (actorId === 1 && !['good_moral', 'report_card'].includes(body.documentType)) throw new DocumentServiceError('Students may upload only Good Moral Certificates and report cards.', 403);
      if (Buffer.isBuffer(file?.buffer)) uploadedBuffers.push(file.buffer);
      calls.push(['upload', actorId, body.documentType, file?.originalname]);
      return { id: actorId === 1 ? 15 : 18 };
    },
    async reupload(actorId, documentId, file) {
      calls.push(['reupload', actorId, documentId, file?.originalname]);
      return { id: actorId === 1 ? 17 : 19 };
    },
    async decideDocument(...args) {
      decisionCalls.push(args);
      return { id: Number(args[1]), decision: args[2], status: args[2] === 'verified' ? 'valid' : 'rejected' };
    },
    async getDocument(actorId, documentId) {
      calls.push(['detail', actorId, documentId]);
      const numericDocumentId = Number(documentId);
      const isHistoricalForm137 = numericDocumentId === 22;
      const isRestrictedDocumentType = numericDocumentId === 16 || isHistoricalForm137;
      const finalDecision = numericDocumentId === 20 ? 'rejected' : 'verified';
      const hasFinalDecision = numericDocumentId === 20 || numericDocumentId === 21;
      if (actorId === 1 && isRestrictedDocumentType) return null;
      return {
        id: numericDocumentId, student_id: 44, student_user_id: 1, student_no: 'S-1',
        first_name: 'Test', middle_name: null, last_name: 'Student', document_type: isHistoricalForm137 ? 'form_137' : isRestrictedDocumentType ? 'psa_birth_certificate' : 'good_moral',
        original_filename: 'moral.pdf', stored_filename: 'opaque-stored-name.pdf', mime_type: 'application/pdf',
        file_size_bytes: 1000, uploaded_by: isRestrictedDocumentType ? 2 : 1, uploader_role: isRestrictedDocumentType ? 'registrar' : 'student', upload_source: isRestrictedDocumentType ? 'registrar' : 'student',
        status: numericDocumentId === 20 ? 'rejected' : numericDocumentId === 21 ? 'valid' : 'needs_review', supersedes_document_id: null, created_at: new Date(),
        history: [{ id: numericDocumentId, original_filename: 'moral.pdf', status: 'needs_review', supersedes_document_id: null, created_at: new Date() }],
        reviewEvents: [{ id: 1, action_type: 'correction_requested', instruction: 'Upload a clearer file <script>alert(1)</script>', created_at: new Date(), reviewer_name: 'Registrar' }],
        validation: actorId === 1 || isHistoricalForm137 ? null : {
          processor: 'Tesseract OCR',
          extracted_text: '<img src=x onerror=alert(1)>',
          result_status: 'needs_review',
          created_at: new Date(),
          message: 'OCR text was extracted. Advisory checks are available; registrar or database administrator source inspection is required.',
          advisoryChecks: [
            { key: 'linked_student_name', label: 'Linked student name appears in the extracted text', found: false },
            { key: 'possible_school_name', label: 'Possible school name', found: true, candidates: ['Possible Academy'] }
          ],
          requiresOverrideReason: true
        },
        decisions: hasFinalDecision ? [
          { id: 2, decision_type: finalDecision, reason: null, created_at: new Date(), reviewer_name: null },
          { id: 1, decision_type: 'correction_requested', reason: 'Upload a clearer file.', created_at: new Date(Date.now() - 1000), reviewer_name: null }
        ] : [],
        isStaff: actorId !== 1
      };
    },
    async recordForm137Status(actorId, studentId, status, instruction) {
      calls.push(['form137', actorId, studentId, status, instruction]);
      return { studentId, status };
    }
  };
  const app = createApp({
    databasePool: authPool(users),
    environment: { nodeEnv: 'development', devPasswordOnlyLogin: true, sessionSecret: 'phase-eight-document-http-test-secret' },
    documentService,
    documentProcessingService: {
      schedulePendingProcessing() { processingCalls.push('scheduled'); }
    },
    form137ScanService: {
      async scan(actorId, studentId, file) {
        if (Buffer.isBuffer(file?.buffer)) scanBuffers.push(file.buffer);
        scanCalls.push(['scan', actorId, studentId, file?.originalname]);
        if (scanCalls.length === 1) {
          return {
            status: 'completed',
            message: 'OCR suggestions are ready for staff inspection.',
            suggestions: [
              { key: 'linked_student_name', label: 'Linked student name appears in the scanned text', found: true },
              { key: 'possible_school_name', label: 'Possible school name', found: true, candidates: ['Academy <script>alert(1)</script>'] }
            ]
          };
        }
        return { status: 'failed', message: 'The local OCR scan timed out. Inspect the physical paper and record its status manually.', suggestions: [] };
      }
    }
  });

  await withServer(app, async (baseUrl) => {
    const studentCookie = await login(baseUrl, 'student@example.edu');
    const studentPage = await fetch(`${baseUrl}/documents`, { headers: { cookie: studentCookie } });
    const studentHtml = await studentPage.text();
    assert.equal(studentPage.status, 200, JSON.stringify(calls));
    assert.match(studentHtml, /Good Moral Certificate/);
    assert.match(studentHtml, /Report card/);
    assert.match(studentHtml, /Form 137 physical record/);
    assert.match(studentHtml, /Authorized staff may send a scan for temporary local OCR suggestions/);
    assert.match(studentHtml, /only the human-recorded status and instruction are saved/);
    assert.doesNotMatch(studentHtml, /No file is uploaded or processed/);
    assert.match(studentHtml, /Not recorded/);
    assert.doesNotMatch(studentHtml, /option value="form_137"|option value="psa_birth_certificate"/);
    assert.doesNotMatch(studentHtml, /OCR output|extracted text/i);
    assert.equal((await fetch(`${baseUrl}/documents/students/44`, { headers: { cookie: studentCookie } })).status, 403);
    const studentScan = new FormData();
    studentScan.set('_csrf', csrfFromHtml(studentHtml));
    studentScan.set('form137Scan', new Blob([Buffer.from('%PDF-1.7\nphysical paper')], { type: 'application/pdf' }), 'physical.pdf');
    assert.equal((await fetch(`${baseUrl}/documents/students/44/form137-scan`, {
      method: 'POST', headers: { cookie: studentCookie }, body: studentScan, redirect: 'manual'
    })).status, 403);
    assert.equal(scanCalls.length, 0, 'students cannot invoke the temporary scan service');

    const missingCsrfForm = new FormData();
    missingCsrfForm.set('_csrf', 'wrong');
    missingCsrfForm.set('documentType', 'report_card');
    missingCsrfForm.set('document', new Blob([Buffer.from('%PDF-1.7\nexample')], { type: 'application/pdf' }), 'report.pdf');
    const deniedWrite = await fetch(`${baseUrl}/documents`, { method: 'POST', headers: { cookie: studentCookie }, body: missingCsrfForm, redirect: 'manual' });
    assert.equal(deniedWrite.status, 403);
    assert.equal(calls.some(([action]) => action === 'upload'), false);

    const validForm = new FormData();
    validForm.set('_csrf', csrfFromHtml(studentHtml));
    validForm.set('documentType', 'report_card');
    validForm.set('document', new Blob([Buffer.from('%PDF-1.7\nexample')], { type: 'application/pdf' }), 'report.pdf');
    const acceptedWrite = await fetch(`${baseUrl}/documents`, { method: 'POST', headers: { cookie: studentCookie }, body: validForm, redirect: 'manual' });
    assert.equal(acceptedWrite.status, 303);
    assert.equal(acceptedWrite.headers.get('location'), '/documents/15?notice=uploaded');
    assert.equal(calls.some(([action, actorId, type, filename]) => action === 'upload' && actorId === 1 && type === 'report_card' && filename === 'report.pdf'), true);
    assert.ok(uploadedBuffers[0].every((byte) => byte === 0), 'the upload route clears the multipart buffer after the service returns');
    assert.deepEqual(processingCalls, ['scheduled'], 'student upload schedules background OCR');

    const studentDetail = await fetch(`${baseUrl}/documents/15`, { headers: { cookie: studentCookie } });
    const studentDetailHtml = await studentDetail.text();
    assert.equal(studentDetail.status, 200);
    assert.match(studentDetailHtml, /Upload a clearer file &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(studentDetailHtml, /action="\/documents\/15\/reupload"/);
    assert.doesNotMatch(studentDetailHtml, /Required source-inspection checklist|Staff source-inspection checklist/);
    assert.doesNotMatch(studentDetailHtml, /opaque-stored-name|extracted text|OCR output|img src=x onerror/i);

    for (const [documentId, expectedStatus] of [[20, /Rejected after staff review/], [21, /Verified after staff source inspection/]]) {
      const finalDetail = await fetch(`${baseUrl}/documents/${documentId}`, { headers: { cookie: studentCookie } });
      const finalDetailHtml = await finalDetail.text();
      assert.equal(finalDetail.status, 200);
      assert.match(finalDetailHtml, expectedStatus);
      assert.doesNotMatch(finalDetailHtml, new RegExp(`action="/documents/${documentId}/reupload"`), 'a final decision clears the old correction action');
    }

    const studentCorrection = new FormData();
    studentCorrection.set('_csrf', csrfFromHtml(studentDetailHtml));
    studentCorrection.set('document', new Blob([Buffer.from('%PDF-1.7\ncorrected')], { type: 'application/pdf' }), 'corrected.pdf');
    const correctedStudentWrite = await fetch(`${baseUrl}/documents/15/reupload`, {
      method: 'POST', headers: { cookie: studentCookie }, body: studentCorrection, redirect: 'manual'
    });
    assert.equal(correctedStudentWrite.status, 303);
    assert.equal(correctedStudentWrite.headers.get('location'), '/documents/17?notice=uploaded');
    assert.equal(processingCalls.at(-1), 'scheduled', 'student correction schedules background OCR');

    const financeCookie = await login(baseUrl, 'finance@example.edu');
    const beforeDeniedList = calls.filter(([action]) => action === 'list').length;
    assert.equal((await fetch(`${baseUrl}/documents`, { headers: { cookie: financeCookie } })).status, 403);
    assert.equal(calls.filter(([action]) => action === 'list').length, beforeDeniedList);
    const financeScan = new FormData();
    financeScan.set('form137Scan', new Blob([Buffer.from('%PDF-1.7\nphysical paper')], { type: 'application/pdf' }), 'physical.pdf');
    assert.equal((await fetch(`${baseUrl}/documents/students/44/form137-scan`, {
      method: 'POST', headers: { cookie: financeCookie }, body: financeScan, redirect: 'manual'
    })).status, 403);
    assert.equal(scanCalls.length, 0, 'finance cannot invoke the temporary scan service');

    const registrarCookie = await login(baseUrl, 'registrar@example.edu');
    const staffPage = await fetch(`${baseUrl}/documents/students/44`, { headers: { cookie: registrarCookie } });
    assert.equal(staffPage.status, 200);
    const staffPageHtml = await staffPage.text();
    assert.match(staffPageHtml, /PSA birth certificate/);
    assert.doesNotMatch(staffPageHtml, /option value="form_137"/);
    assert.match(staffPageHtml, /option value="psa_birth_certificate"/);
    assert.match(staffPageHtml, /Not recorded/);
    assert.match(staffPageHtml, /form137-scan/);
    assert.match(staffPageHtml, /temporary file is deleted after processing/);

    const deniedCsrfScan = new FormData();
    deniedCsrfScan.set('_csrf', 'wrong');
    deniedCsrfScan.set('form137Scan', new Blob([Buffer.from('%PDF-1.7\nphysical paper')], { type: 'application/pdf' }), 'physical.pdf');
    const deniedScan = await fetch(`${baseUrl}/documents/students/44/form137-scan`, {
      method: 'POST', headers: { cookie: registrarCookie }, body: deniedCsrfScan, redirect: 'manual'
    });
    assert.equal(deniedScan.status, 403);
    assert.match(deniedScan.headers.get('cache-control'), /no-store/);
    assert.equal(scanCalls.length, 0, 'CSRF failure prevents OCR');

    const staffScan = new FormData();
    staffScan.set('_csrf', csrfFromHtml(staffPageHtml));
    staffScan.set('form137Scan', new Blob([Buffer.from('%PDF-1.7\nphysical paper')], { type: 'application/pdf' }), 'physical.pdf');
    const scanResponse = await fetch(`${baseUrl}/documents/students/44/form137-scan`, {
      method: 'POST', headers: { cookie: registrarCookie }, body: staffScan, redirect: 'manual'
    });
    const scanHtml = await scanResponse.text();
    assert.equal(scanResponse.status, 200);
    assert.match(scanResponse.headers.get('cache-control'), /private, no-store/);
    assert.equal(scanResponse.headers.get('pragma'), 'no-cache');
    assert.match(scanHtml, /Temporary OCR suggestions/);
    assert.match(scanHtml, /Academy &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(scanHtml, /Academy <script>alert\(1\)<\/script>/);
    assert.deepEqual(scanCalls[0], ['scan', 2, 44, 'physical.pdf']);
    assert.ok(scanBuffers[0].every((byte) => byte === 0), 'the scan route clears the multipart buffer after the scan service returns');

    const failedScan = new FormData();
    failedScan.set('_csrf', csrfFromHtml(scanHtml));
    failedScan.set('form137Scan', new Blob([Buffer.from('%PDF-1.7\nphysical paper')], { type: 'application/pdf' }), 'physical.pdf');
    const failedScanResponse = await fetch(`${baseUrl}/documents/students/44/form137-scan`, {
      method: 'POST', headers: { cookie: registrarCookie }, body: failedScan, redirect: 'manual'
    });
    const failedScanHtml = await failedScanResponse.text();
    assert.equal(failedScanResponse.status, 200);
    assert.match(failedScanResponse.headers.get('cache-control'), /no-store/);
    assert.match(failedScanHtml, /OCR scan timed out/);
    assert.match(failedScanHtml, /Save Form 137 status/);
    assert.deepEqual(scanCalls[1], ['scan', 2, 44, 'physical.pdf']);

    const statusWrite = await fetch(`${baseUrl}/documents/students/44/form137-status`, {
      method: 'POST',
      headers: { cookie: registrarCookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrfFromHtml(failedScanHtml), status: 'verified', instruction: '' }),
      redirect: 'manual'
    });
    assert.equal(statusWrite.status, 303);
    assert.equal(calls.some(([action, actorId, studentId, status]) => action === 'form137' && actorId === 2 && studentId === 44 && status === 'verified'), true);
    assert.equal(processingCalls.length, 2, 'physical status updates do not schedule OCR');

    const staffUpload = new FormData();
    staffUpload.set('_csrf', csrfFromHtml(staffPageHtml));
    staffUpload.set('documentType', 'psa_birth_certificate');
    staffUpload.set('document', new Blob([Buffer.from('%PDF-1.7\nstaff source')], { type: 'application/pdf' }), 'psa.pdf');
    const acceptedStaffWrite = await fetch(`${baseUrl}/documents/students/44`, {
      method: 'POST', headers: { cookie: registrarCookie }, body: staffUpload, redirect: 'manual'
    });
    assert.equal(acceptedStaffWrite.status, 303);
    assert.equal(acceptedStaffWrite.headers.get('location'), '/documents/students/44?notice=uploaded');
    assert.equal(processingCalls.at(-1), 'scheduled', 'staff upload schedules background OCR');

    const restrictedStaffDetail = await fetch(`${baseUrl}/documents/16`, { headers: { cookie: registrarCookie } });
    const restrictedStaffDetailHtml = await restrictedStaffDetail.text();
    assert.equal(restrictedStaffDetail.status, 200);
    assert.match(restrictedStaffDetailHtml, /Correction instruction for staff/);
    assert.match(restrictedStaffDetailHtml, /action="\/documents\/16\/reupload"/);
    assert.doesNotMatch(restrictedStaffDetailHtml, /Follow the instruction from staff, then upload the corrected file as a new submission/);
    const correctedStaffUpload = new FormData();
    correctedStaffUpload.set('_csrf', csrfFromHtml(restrictedStaffDetailHtml));
    correctedStaffUpload.set('document', new Blob([Buffer.from('%PDF-1.7\nstaff correction')], { type: 'application/pdf' }), 'corrected-137.pdf');
    const correctedStaffWrite = await fetch(`${baseUrl}/documents/16/reupload`, {
      method: 'POST', headers: { cookie: registrarCookie }, body: correctedStaffUpload, redirect: 'manual'
    });
    assert.equal(correctedStaffWrite.status, 303);
    assert.equal(correctedStaffWrite.headers.get('location'), '/documents/19?notice=uploaded');
    assert.equal(processingCalls.at(-1), 'scheduled', 'staff correction schedules background OCR');
    assert.equal(calls.some(([action, actorId, studentId]) => action === 'student' && actorId === 2 && studentId === 44), true);

    const staffDetail = await fetch(`${baseUrl}/documents/15`, { headers: { cookie: registrarCookie } });
    const staffDetailHtml = await staffDetail.text();
    assert.equal(staffDetail.status, 200);
    assert.match(staffDetailHtml, /action="\/documents\/15\/decision"/);
    assert.match(staffDetailHtml, /action="\/documents\/15\/correction"/);
    assert.match(staffDetailHtml, /Required source-inspection checklist/);
    assert.match(staffDetailHtml, /name="linkedStudentNameLegible" value="yes" type="checkbox" required/);
    assert.match(staffDetailHtml, /name="schoolNameLegible" value="yes" type="checkbox" required/);
    assert.match(staffDetailHtml, /name="selectedDocumentTypeCorrect" value="yes" type="checkbox" required/);
    assert.match(staffDetailHtml, /name="allSubmittedPagesReadableComplete" value="yes" type="checkbox" required/);
    assert.match(staffDetailHtml, /Possible Academy/);
    assert.match(staffDetailHtml, /Possible linked student-name match/);
    assert.match(staffDetailHtml, /does not confirm that the document belongs to the linked student/);
    assert.match(staffDetailHtml, /Possible text identified/);
    assert.match(staffDetailHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(staffDetailHtml, /<img src=x onerror=alert\(1\)>/);
    assert.doesNotMatch(staffDetailHtml, /opaque-stored-name/);

    const registrarDecision = new URLSearchParams({
      _csrf: csrfFromHtml(staffDetailHtml), decision: 'verified', reason: 'I inspected the source.',
      linkedStudentNameLegible: 'yes', schoolNameLegible: 'yes',
      selectedDocumentTypeCorrect: 'yes', allSubmittedPagesReadableComplete: 'yes'
    });
    const registrarDecisionResponse = await fetch(`${baseUrl}/documents/15/decision`, {
      method: 'POST', headers: { cookie: registrarCookie, 'content-type': 'application/x-www-form-urlencoded' }, body: registrarDecision, redirect: 'manual'
    });
    assert.equal(registrarDecisionResponse.status, 303);
    assert.equal(decisionCalls.length, 1);
    assert.equal(decisionCalls[0][4].schoolNameLegible, 'yes', 'the route forwards checklist fields to the server validator');

    const databaseAdminCookie = await login(baseUrl, 'database_admin@example.edu');
    const psaDetail = await fetch(`${baseUrl}/documents/16`, { headers: { cookie: databaseAdminCookie } });
    const psaDetailHtml = await psaDetail.text();
    assert.equal(psaDetail.status, 200);
    assert.match(psaDetailHtml, /name="linkedStudentNameLegible" value="yes" type="checkbox" required/);
    assert.doesNotMatch(psaDetailHtml, /name="schoolNameLegible"/);
    const psaDecision = new URLSearchParams({
      _csrf: csrfFromHtml(psaDetailHtml), decision: 'verified', linkedStudentNameLegible: 'yes',
      selectedDocumentTypeCorrect: 'yes', allSubmittedPagesReadableComplete: 'yes'
    });
    const psaDecisionResponse = await fetch(`${baseUrl}/documents/16/decision`, {
      method: 'POST', headers: { cookie: databaseAdminCookie, 'content-type': 'application/x-www-form-urlencoded' }, body: psaDecision, redirect: 'manual'
    });
    assert.equal(psaDecisionResponse.status, 303);
    assert.equal(decisionCalls.length, 2);
    assert.equal(decisionCalls[1][0], 4, 'database administrators can record digital review decisions');
    assert.equal(Object.hasOwn(decisionCalls[1][4], 'schoolNameLegible'), false, 'PSA does not submit a school-name attestation');

    const studentDecision = new URLSearchParams({ _csrf: csrfFromHtml(studentDetailHtml), decision: 'verified' });
    const deniedStudentDecision = await fetch(`${baseUrl}/documents/15/decision`, {
      method: 'POST', headers: { cookie: studentCookie, 'content-type': 'application/x-www-form-urlencoded' }, body: studentDecision, redirect: 'manual'
    });
    assert.equal(deniedStudentDecision.status, 403);
    assert.equal(decisionCalls.length, 2, 'students cannot invoke the decision service');

    const historicalForm137Detail = await fetch(`${baseUrl}/documents/22`, { headers: { cookie: registrarCookie } });
    const historicalForm137Html = await historicalForm137Detail.text();
    assert.equal(historicalForm137Detail.status, 200);
    assert.match(historicalForm137Html, /authorized staff may scan the paper for temporary local OCR suggestions/);
    assert.match(historicalForm137Html, /Scans and OCR results are not retained in that workflow/);
    assert.match(historicalForm137Html, /temporary staff scan suggestions are returned only for inspection and are not saved as OCR data/);
    assert.doesNotMatch(historicalForm137Html, /without uploads or OCR/);

    const privateStatic = await fetch(`${baseUrl}/storage/uploads/anything.pdf`);
    assert.equal(privateStatic.status, 404);
  });
});

test('document routes stream authorized downloads and hide upload, re-upload, and download failures', async () => {
  const passwordHash = await bcrypt.hash('Correct-Horse-Battery-12', 4);
  const users = ['student', 'finance'].map((role, index) => ({
    id: index + 1,
    email: `${role}@example.edu`,
    password_hash: passwordHash,
    role,
    is_active: true
  }));
  const uploadBuffers = [];
  const reuploadBuffers = [];
  const downloadCalls = [];
  const contents = Buffer.from('%PDF-1.7\nprivate test report');
  const directory = await temporaryDirectory();
  const filePath = path.join(directory, 'opaque-stored-name.pdf');

  try {
    await fs.writeFile(filePath, contents, { mode: 0o600 });
    const documentService = {
      async listDocuments(actorId) {
        return {
          documents: [], searchTerm: '', isStaff: actorId !== 1,
          form137Status: { status: 'not_recorded', instruction: null, created_at: null }
        };
      },
      async upload(_actorId, _body, file) {
        uploadBuffers.push(file.buffer);
        throw new Error('database connection secret');
      },
      async reupload(_actorId, _documentId, file) {
        reuploadBuffers.push(file.buffer);
        throw new Error('database connection secret');
      },
      async openDownload(actorId, documentId) {
        downloadCalls.push([actorId, documentId]);
        if (documentId === '404') throw new DocumentServiceError('Document not found.', 404);
        if (documentId !== '88') throw new Error('database connection secret');
        return {
          document: { original_filename: 'Quarter 1 report.pdf', mime_type: 'application/pdf' },
          fileHandle: await fs.open(filePath, 'r'),
          size: contents.length
        };
      }
    };
    const app = createApp({
      databasePool: authPool(users),
      environment: { nodeEnv: 'development', devPasswordOnlyLogin: true, sessionSecret: 'phase-thirteen-document-route-test-secret' },
      documentService,
      documentProcessingService: { schedulePendingProcessing() {} },
      form137ScanService: { async scan() { throw new Error('Form 137 scan is outside this test.'); } }
    });

    await withServer(app, async (baseUrl) => {
      const studentCookie = await login(baseUrl, 'student@example.edu');
      const listResponse = await fetch(`${baseUrl}/documents`, { headers: { cookie: studentCookie } });
      assert.equal(listResponse.status, 200);
      const csrfToken = csrfFromHtml(await listResponse.text());

      const upload = new FormData();
      upload.set('_csrf', csrfToken);
      upload.set('documentType', 'report_card');
      upload.set('document', new Blob([Buffer.from('%PDF-1.7\nupload')], { type: 'application/pdf' }), 'report.pdf');
      const failedUpload = await fetch(`${baseUrl}/documents`, {
        method: 'POST', headers: { cookie: studentCookie }, body: upload, redirect: 'manual'
      });
      const failedUploadHtml = await failedUpload.text();
      assert.equal(failedUpload.status, 503);
      assert.match(failedUploadHtml, /The document could not be uploaded\./);
      assert.doesNotMatch(failedUploadHtml, /database connection secret/);
      assert.ok(uploadBuffers[0].every((byte) => byte === 0), 'failed uploads clear the multipart buffer');

      const correction = new FormData();
      correction.set('_csrf', csrfToken);
      correction.set('document', new Blob([Buffer.from('%PDF-1.7\ncorrected')], { type: 'application/pdf' }), 'corrected.pdf');
      const failedReupload = await fetch(`${baseUrl}/documents/88/reupload`, {
        method: 'POST', headers: { cookie: studentCookie }, body: correction, redirect: 'manual'
      });
      const failedReuploadHtml = await failedReupload.text();
      assert.equal(failedReupload.status, 503);
      assert.match(failedReuploadHtml, /The corrected document could not be uploaded\./);
      assert.doesNotMatch(failedReuploadHtml, /database connection secret/);
      assert.ok(reuploadBuffers[0].every((byte) => byte === 0), 'failed re-uploads clear the multipart buffer');

      const financeCookie = await login(baseUrl, 'finance@example.edu');
      const deniedDownload = await fetch(`${baseUrl}/documents/88/download`, { headers: { cookie: financeCookie } });
      assert.equal(deniedDownload.status, 403);
      assert.deepEqual(downloadCalls, [], 'finance is denied before the file service is called');

      const downloaded = await fetch(`${baseUrl}/documents/88/download`, { headers: { cookie: studentCookie } });
      assert.equal(downloaded.status, 200);
      assert.equal(downloaded.headers.get('content-type'), 'application/pdf');
      assert.equal(downloaded.headers.get('content-length'), String(contents.length));
      assert.match(downloaded.headers.get('content-disposition'), /filename="document\.pdf"/);
      assert.match(downloaded.headers.get('content-disposition'), /filename\*=UTF-8''Quarter%201%20report\.pdf/);
      assert.equal(downloaded.headers.get('cache-control'), 'private, no-store');
      assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), contents);

      const missing = await fetch(`${baseUrl}/documents/404/download`, { headers: { cookie: studentCookie } });
      assert.equal(missing.status, 404);
      assert.match(await missing.text(), /Document not found\./);

      const failedDownload = await fetch(`${baseUrl}/documents/500/download`, { headers: { cookie: studentCookie } });
      const failedDownloadHtml = await failedDownload.text();
      assert.equal(failedDownload.status, 503);
      assert.match(failedDownloadHtml, /The document could not be downloaded\./);
      assert.doesNotMatch(failedDownloadHtml, /database connection secret/);
      assert.deepEqual(downloadCalls, [[1, '88'], [1, '404'], [1, '500']]);
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('download authorization hides missing or non-owned document identifiers', async () => {
  const calls = [];
  const pool = async () => ({
    request() {
      const values = {};
      return {
        input(name, _type, value) { values[name] = value; return this; },
        async query(statement) {
          calls.push({ statement, values: { ...values } });
          if (statement.includes('FROM dbo.documents AS d') && statement.includes('WHERE d.id = @documentId')) return { recordset: [] };
          if (statement.includes('FROM dbo.users WHERE id = @actorId')) return { recordset: [{ id: 7, role: 'student' }] };
          throw new Error(`Unexpected read SQL: ${statement}`);
        }
      };
    }
  });
  const directory = await temporaryDirectory();
  try {
    const service = createDocumentService({ getPool: pool, sql: fakeSql(), storageDirectory: directory, maxUploadBytes: 100 });
    await assert.rejects(service.openDownload(7, '88'), (error) => error instanceof DocumentServiceError && error.status === 404);
    assert.equal(calls.some(({ statement }) => statement.includes('s.user_id = @actorId')), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('authorized student download opens the opaque private file only after current ownership lookup', async () => {
  const directory = await temporaryDirectory();
  const storedFilename = `${crypto.randomUUID()}.pdf`;
  const contents = Buffer.from('%PDF-1.7\nprivate');
  const document = {
    id: 88,
    student_id: 44,
    document_type: 'report_card',
    original_filename: 'my report.pdf',
    stored_filename: storedFilename,
    mime_type: 'application/pdf',
    file_size_bytes: contents.length,
    uploaded_by: 7,
    upload_source: 'student',
    status: 'pending',
    supersedes_document_id: null,
    created_at: new Date(),
    student_user_id: 7,
    student_no: 'S-44',
    first_name: 'Test',
    middle_name: null,
    last_name: 'Student',
    uploader_role: 'student'
  };
  const calls = [];
  const pool = async () => ({
    request() {
      const values = {};
      return {
        input(name, _type, value) { values[name] = value; return this; },
        async query(statement) {
          calls.push(statement);
          if (statement.includes('FROM dbo.documents AS d') && statement.includes('WHERE d.id = @documentId')) {
            return { recordset: values.actorId === 7 && values.documentId === 88 ? [{ ...document }] : [] };
          }
          if (statement.includes('FROM dbo.users WHERE id = @actorId')) return { recordset: [{ id: 7, role: 'student' }] };
          if (statement.includes('FROM dbo.documents WHERE student_id = @studentId')) return { recordset: [] };
          if (statement.includes('FROM dbo.document_review_events AS e')) return { recordset: [] };
          if (statement.includes('FROM dbo.document_decision_events AS e')) return { recordset: [] };
          throw new Error(`Unexpected read SQL: ${statement}`);
        }
      };
    }
  });
  try {
    await fs.writeFile(path.join(directory, storedFilename), contents, { mode: 0o600 });
    const service = createDocumentService({ getPool: pool, sql: fakeSql(), storageDirectory: directory, maxUploadBytes: 100 });
    const opened = await service.openDownload(7, '88');
    try {
      assert.equal((await opened.fileHandle.readFile()).toString(), contents.toString());
      assert.equal(opened.document.original_filename, 'my report.pdf');
      assert.equal(opened.size, contents.length);
      assert.match(calls.find((statement) => statement.includes('FROM dbo.documents AS d')), /s\.user_id = @actorId/);
    } finally {
      await opened.fileHandle.close();
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('student PSA reads depend on immutable staff upload source and own student link', async () => {
  const calls = [];
  const pool = {
    request() {
      const values = {};
      return {
        input(name, _type, value) { values[name] = value; return this; },
        async query(statement) {
          calls.push({ statement, values: { ...values } });
          if (statement.startsWith('SELECT id, role FROM dbo.users')) return { recordset: [{ id: 7, role: 'student' }] };
          if (statement.includes('FROM dbo.documents AS d') && statement.includes('WHERE d.id = @documentId')) {
            const rows = {
              88: { id: 88, document_type: 'psa_birth_certificate', upload_source: 'registrar', student_user_id: 7, uploader_role: 'student' },
              89: { id: 89, document_type: 'psa_birth_certificate', upload_source: 'student', student_user_id: 7, uploader_role: 'registrar' },
              90: { id: 90, document_type: 'psa_birth_certificate', upload_source: 'registrar', student_user_id: 8, uploader_role: 'registrar' }
            };
            const row = rows[values.documentId];
            return { recordset: row?.student_user_id === values.actorId && row.upload_source !== 'student' ? [row] : [] };
          }
          if (statement.includes('FROM dbo.documents AS history_document')) return { recordset: [] };
          if (statement.includes('FROM dbo.documents AS d') && statement.includes('WHERE d.student_id = @studentId')) return { recordset: [] };
          if (statement.includes('FROM dbo.document_review_events AS e')) return { recordset: [] };
          if (statement.includes('FROM dbo.document_decision_events AS e')) return { recordset: [] };
          throw new Error(`Unexpected PSA read SQL: ${statement}`);
        }
      };
    }
  };
  const service = createDocumentService({ getPool: async () => pool, sql: fakeSql() });
  assert.equal((await service.getDocument(7, '88')).upload_source, 'registrar');
  assert.equal(await service.getDocument(7, '89'), null, 'student-uploaded PSA is not exposed');
  assert.equal(await service.getDocument(7, '90'), null, 'another student PSA is not exposed');
  const documentQuery = calls.find(({ statement }) => statement.includes('WHERE d.id = @documentId'));
  assert.match(documentQuery.statement, /d\.upload_source IN \('registrar', 'database_admin'\)/);
});
