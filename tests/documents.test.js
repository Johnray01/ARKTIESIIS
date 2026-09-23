const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const bcrypt = require('bcrypt');
const { createApp } = require('../src/app');
const { configuredMaxBytes } = require('../src/routes/documents');
const {
  DocumentServiceError,
  createDocumentService,
  validateUpload
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

function transactionHarness({ actorRole = 'student', ownStudentId = 44, previousOwnerId = 7, previousDocumentType = 'good_moral', failAt = null, correctionAction = 'correction_requested', hasRevision = false, fileSystem } = {}) {
  const state = { queries: [], inserted: [], events: [], committed: false, rolledBack: false, id: 90 };
  const transactionFactory = () => ({
    async begin(isolation) { state.isolation = isolation; },
    request() {
      const values = {};
      return {
        input(name, _type, value) { values[name] = value; return this; },
        async query(statement) {
          const call = { statement, values: { ...values } };
          state.queries.push(call);
          if (statement.includes('FROM dbo.users')) return { recordset: actorRole ? [{ id: 7, role: actorRole }] : [] };
          if (statement.includes('FROM dbo.students') && statement.includes('WHERE user_id = @actorId')) return { recordset: ownStudentId ? [{ id: ownStudentId }] : [] };
          if (statement.includes('FROM dbo.students') && statement.includes('WHERE id = @studentId')) return { recordset: [{ id: values.studentId }] };
          if (statement.includes('FROM dbo.documents AS d')) return { recordset: [{ id: values.documentId, student_id: 44, document_type: previousDocumentType, status: 'needs_review', student_user_id: previousOwnerId }] };
          if (statement.includes('FROM dbo.documents WITH')) return { recordset: [{ id: values.documentId, student_id: 44, document_type: 'good_moral' }] };
          if (statement.includes('FROM dbo.document_review_events')) return { recordset: correctionAction ? [{ action_type: correctionAction }] : [] };
          if (statement.includes('SELECT TOP (1) id FROM dbo.documents')) return { recordset: hasRevision ? [{ id: 91 }] : [] };
          if (statement.includes('INSERT INTO dbo.documents')) {
            if (failAt === 'insert') throw new Error('database details are private');
            state.inserted.push(call);
            return { recordset: [{ id: state.id++ }] };
          }
          if (statement.includes('INSERT INTO dbo.document_review_events')) { state.events.push(call); return { recordset: [] }; }
          if (statement.includes('UPDATE dbo.documents')) return { recordset: [] };
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
    async rollback() { state.rolledBack = true; }
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

test('student upload derives the linked student record, uses opaque private storage, and audits without file contents', async () => {
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
    assert.equal((await fs.stat(storedPath)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
    assert.match(path.relative(directory, storedPath), /^[-0-9a-f]+\.pdf$/i);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('students cannot upload staff-only document types or access a student record without an account link', async () => {
  const directory = await temporaryDirectory();
  try {
    const restricted = transactionHarness();
    await assert.rejects(serviceWithStorage(restricted, directory).upload(7, { documentType: 'form_137', studentId: '44' }, makeFile()), /Students may upload only/);
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
    { id: 4, document_type: 'psa_birth_certificate' }
  ];
  let listSql = '';
  const pool = {
    request() {
      const values = {};
      return {
        input(name, _type, value) { values[name] = value; return this; },
        async query(statement) {
          if (statement.startsWith('SELECT id, role FROM dbo.users')) return { recordset: [{ id: values.actorId, role: 'student' }] };
          listSql = statement;
          const allowedTypeFilter = statement.includes("d.document_type IN ('good_moral', 'report_card')");
          return { recordset: allowedTypeFilter ? rows.filter((row) => ['good_moral', 'report_card'].includes(row.document_type)) : rows };
        }
      };
    }
  };
  const service = createDocumentService({ getPool: async () => pool, sql: fakeSql() });
  const result = await service.listDocuments(7);
  assert.deepEqual(result.documents.map(({ document_type }) => document_type), ['good_moral', 'report_card']);
  assert.match(listSql, /s\.user_id = @actorId AND d\.document_type IN \('good_moral', 'report_card'\)/);
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
    assert.ok(reviewHarness.state.queries.some(({ statement }) => statement.includes("SET status = 'needs_review'")));
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
  const users = ['student', 'registrar', 'finance'].map((role, index) => ({
    id: index + 1,
    email: `${role}@example.edu`,
    password_hash: passwordHash,
    role,
    is_active: true
  }));
  const calls = [];
  const documentService = {
    async listDocuments(actorId) {
      calls.push(['list', actorId]);
      return { documents: [], searchTerm: '', isStaff: actorId !== 1 };
    },
    async getStudentDocuments(actorId, studentId) {
      calls.push(['student', actorId, studentId]);
      return { student: { id: studentId, student_no: 'S-1', first_name: 'Test', last_name: 'Student' }, documents: [] };
    },
    async upload(actorId, body, file) {
      calls.push(['upload', actorId, body.documentType, file?.originalname]);
      return { id: 15 };
    },
    async getDocument(actorId, documentId) {
      calls.push(['detail', actorId, documentId]);
      const isRestrictedDocumentType = Number(documentId) === 16;
      return {
        id: Number(documentId), student_id: 44, student_user_id: 1, student_no: 'S-1',
        first_name: 'Test', middle_name: null, last_name: 'Student', document_type: isRestrictedDocumentType ? 'psa_birth_certificate' : 'good_moral',
        original_filename: 'moral.pdf', stored_filename: 'opaque-stored-name.pdf', mime_type: 'application/pdf',
        file_size_bytes: 1000, uploaded_by: 1, uploader_role: 'student', upload_source: 'student',
        status: 'needs_review', supersedes_document_id: null, created_at: new Date(),
        history: [{ id: Number(documentId), original_filename: 'moral.pdf', status: 'needs_review', supersedes_document_id: null, created_at: new Date() }],
        reviewEvents: [{ id: 1, action_type: 'correction_requested', instruction: 'Upload a clearer file <script>alert(1)</script>', created_at: new Date(), reviewer_name: 'Registrar' }],
        isStaff: actorId !== 1
      };
    }
  };
  const app = createApp({
    databasePool: authPool(users),
    environment: { nodeEnv: 'development', devPasswordOnlyLogin: true, sessionSecret: 'phase-eight-document-http-test-secret' },
    documentService
  });

  await withServer(app, async (baseUrl) => {
    const studentCookie = await login(baseUrl, 'student@example.edu');
    const studentPage = await fetch(`${baseUrl}/documents`, { headers: { cookie: studentCookie } });
    const studentHtml = await studentPage.text();
    assert.equal(studentPage.status, 200, JSON.stringify(calls));
    assert.match(studentHtml, /Good Moral Certificate/);
    assert.match(studentHtml, /Report card/);
    assert.doesNotMatch(studentHtml, /Form 137|PSA birth certificate/);
    assert.doesNotMatch(studentHtml, /OCR output|extracted text/i);
    assert.equal((await fetch(`${baseUrl}/documents/students/44`, { headers: { cookie: studentCookie } })).status, 403);

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

    const studentDetail = await fetch(`${baseUrl}/documents/15`, { headers: { cookie: studentCookie } });
    const studentDetailHtml = await studentDetail.text();
    assert.equal(studentDetail.status, 200);
    assert.match(studentDetailHtml, /Upload a clearer file &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(studentDetailHtml, /action="\/documents\/15\/reupload"/);
    assert.doesNotMatch(studentDetailHtml, /opaque-stored-name|extracted text|OCR output/i);

    const financeCookie = await login(baseUrl, 'finance@example.edu');
    const beforeDeniedList = calls.filter(([action]) => action === 'list').length;
    assert.equal((await fetch(`${baseUrl}/documents`, { headers: { cookie: financeCookie } })).status, 403);
    assert.equal(calls.filter(([action]) => action === 'list').length, beforeDeniedList);

    const registrarCookie = await login(baseUrl, 'registrar@example.edu');
    const staffPage = await fetch(`${baseUrl}/documents/students/44`, { headers: { cookie: registrarCookie } });
    assert.equal(staffPage.status, 200);
    assert.match(await staffPage.text(), /PSA birth certificate/);

    const restrictedStaffDetail = await fetch(`${baseUrl}/documents/16`, { headers: { cookie: registrarCookie } });
    const restrictedStaffDetailHtml = await restrictedStaffDetail.text();
    assert.equal(restrictedStaffDetail.status, 200);
    assert.match(restrictedStaffDetailHtml, /Students cannot re-upload Form 137 or PSA birth certificates, so staff must supply corrections/);
    assert.match(restrictedStaffDetailHtml, /action="\/documents\/16\/reupload"/);
    assert.doesNotMatch(restrictedStaffDetailHtml, /Follow the instruction from staff, then upload the corrected file as a new submission/);
    assert.equal(calls.some(([action, actorId, studentId]) => action === 'student' && actorId === 2 && studentId === 44), true);

    const staffDetail = await fetch(`${baseUrl}/documents/15`, { headers: { cookie: registrarCookie } });
    const staffDetailHtml = await staffDetail.text();
    assert.equal(staffDetail.status, 200);
    assert.match(staffDetailHtml, /action="\/documents\/15\/review"/);
    assert.match(staffDetailHtml, /action="\/documents\/15\/correction"/);
    assert.doesNotMatch(staffDetailHtml, /opaque-stored-name/);

    const privateStatic = await fetch(`${baseUrl}/storage/uploads/anything.pdf`);
    assert.equal(privateStatic.status, 404);
  });
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
