const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const bcrypt = require('bcrypt');
const { createApp } = require('../src/app');
const {
  StudentRecordsError,
  createStudentRecordsService,
  validateStudent,
  normalizeLrn,
  validateTerm,
  validateSection,
  validateEnrollment
} = require('../src/services/studentRecordsService');

async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function fakeSql() {
  return {
    MAX: 'MAX',
    Date: 'Date',
    ISOLATION_LEVEL: { SERIALIZABLE: 'SERIALIZABLE' },
    Int: 'Int',
    Bit: 'Bit',
    NVarChar: (length) => `NVarChar(${length})`
  };
}

function transactionalService(onQuery) {
  const log = { queries: [], isolation: null, committed: false, rolledBack: false };
  const transactionFactory = () => ({
    async begin(isolation) { log.isolation = isolation; },
    request() {
      const values = {};
      return {
        input(name, _type, value) { values[name] = value; return this; },
        async query(statement) {
          const call = { statement, values: { ...values } };
          log.queries.push(call);
          return onQuery(call);
        }
      };
    },
    async commit() { log.committed = true; },
    async rollback() { log.rolledBack = true; }
  });
  const service = createStudentRecordsService({ getPool: async () => ({}), sql: fakeSql(), transactionFactory });
  return { service, log };
}

function makeAuthPool(role) {
  const user = {
    id: 7,
    email: `${role}@example.edu`,
    password_hash: bcrypt.hashSync('Correct-Horse-Battery-12', 4),
    role,
    is_active: true,
    updated_at_fingerprint: ''
  };
  const getPool = async () => ({
    request() {
      return {
        input() { return this; },
        async query(statement) {
          if (statement.includes('WHERE email = @email')) return { recordset: [user] };
          if (statement.includes('WHERE id = @userId')) return { recordset: [{ ...user }] };
          throw new Error(`Unexpected auth query: ${statement}`);
        }
      };
    }
  });
  return getPool;
}

const environment = {
  nodeEnv: 'development',
  devPasswordOnlyLogin: true,
  sessionSecret: 'phase-five-student-records-test-session-secret'
};

function getCookie(response) {
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie, 'expected a session cookie');
  return cookie.split(';', 1)[0];
}

function csrfFromHtml(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  assert.ok(match, 'expected a CSRF token');
  return match[1];
}

async function postForm(baseUrl, path, cookie, values) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values)
  });
}

async function signIn(baseUrl, role) {
  const page = await fetch(`${baseUrl}/login`);
  const cookie = getCookie(page);
  const csrfToken = csrfFromHtml(await page.text());
  const response = await postForm(baseUrl, '/login', cookie, {
    _csrf: csrfToken,
    email: `${role}@example.edu`,
    password: 'Correct-Horse-Battery-12'
  });
  assert.equal(response.status, 303);
  return getCookie(response);
}

test('student record, term, section, and enrollment inputs are bounded and validated', () => {
  assert.equal(validateStudent({ studentNo: ' S-1 ', lrn: '123456789012', firstName: 'Jamie', lastName: 'Lee', birthDate: '2008-02-29' }).studentNo, 'S-1');
  assert.throws(() => normalizeLrn('12345678901'), /exactly 12 digits/);
  assert.throws(() => normalizeLrn('12345678901 '), /exactly 12 digits/);
  assert.equal(validateStudent({ studentNo: 'S-OLD', firstName: 'Jamie', lastName: 'Lee' }, { requireLrn: false }).lrn, null);
  assert.throws(() => validateStudent({ studentNo: 'S-NEW', firstName: 'Jamie', lastName: 'Lee' }), /LRN must contain exactly 12 digits/);
  assert.throws(() => validateStudent({ studentNo: 'S-1', lrn: '123456789012', firstName: 'Jamie', lastName: 'Lee', birthDate: '2007-02-29' }), /valid birth date/);
  assert.throws(() => validateStudent({ studentNo: 'S-1', firstName: 'Jamie\nLee', lastName: 'Lee' }), /First name is required/);
  assert.throws(() => validateTerm({ schoolYear: '2026', term: 'A'.repeat(31) }), StudentRecordsError);
  assert.throws(() => validateSection({ name: 'Grade 7', academicTermId: '3x' }), /valid academic term/);
  assert.throws(() => validateEnrollment({ studentId: '0', academicTermId: '4' }), /valid student/);
  assert.deepEqual(validateEnrollment({ studentId: '5', academicTermId: '4', sectionId: '' }), { studentId: 5, academicTermId: 4, sectionId: null });
});

test('LRN is required for new students, registrars can backfill blanks, and only database administrators can change a recorded LRN', async () => {
  const input = { studentNo: 'S-13', lrn: '123456789012', firstName: 'Jamie', lastName: 'Lee' };
  const registrarEdit = transactionalService(({ statement }) => {
    if (statement.includes('FROM dbo.users')) return { recordset: [{ id: 7, role: 'registrar' }] };
    if (statement.includes('FROM dbo.students WITH')) return { recordset: [{ id: 12, status: 'active', student_no: 'S-12', lrn: input.lrn }] };
    throw new Error(`Unexpected query: ${statement}`);
  });
  await assert.rejects(registrarEdit.service.saveStudent(7, 12, input), (error) => {
    assert.ok(error instanceof StudentRecordsError);
    assert.equal(error.status, 403);
    assert.match(error.message, /Only database administrators can change a student number/);
    return true;
  });
  assert.equal(registrarEdit.log.rolledBack, true);
  assert.equal(registrarEdit.log.queries.some(({ statement }) => statement.includes('UPDATE dbo.students')), false);
  assert.equal(registrarEdit.log.queries.some(({ statement }) => statement.includes('INSERT INTO dbo.audit_logs')), false);

  const registrarCreate = transactionalService(({ statement, values }) => {
    if (statement.includes('FROM dbo.users')) return { recordset: [{ id: 7, role: 'registrar' }] };
    if (statement.includes('INSERT INTO dbo.students')) return { recordset: [{ id: 13 }] };
    if (statement.includes('INSERT INTO dbo.audit_logs')) return { recordset: [] };
    throw new Error(`Unexpected query: ${statement}`);
  });
  assert.equal(await registrarCreate.service.saveStudent(7, null, input), 13);
  assert.equal(registrarCreate.log.queries.find(({ statement }) => statement.includes('INSERT INTO dbo.students')).values.studentNo, 'S-13');
  assert.equal(registrarCreate.log.queries.find(({ statement }) => statement.includes('INSERT INTO dbo.students')).values.lrn, input.lrn);
  assert.equal(registrarCreate.log.committed, true);

  const registrarBackfill = transactionalService(({ statement }) => {
    if (statement.includes('FROM dbo.users')) return { recordset: [{ id: 7, role: 'registrar' }] };
    if (statement.includes('FROM dbo.students WITH')) return { recordset: [{ id: 12, status: 'active', student_no: 'S-13', lrn: null }] };
    if (statement.includes('UPDATE dbo.students')) return { recordset: [] };
    if (statement.includes('INSERT INTO dbo.audit_logs')) return { recordset: [] };
    throw new Error(`Unexpected query: ${statement}`);
  });
  assert.equal(await registrarBackfill.service.saveStudent(7, 12, input), 12);
  assert.equal(registrarBackfill.log.queries.find(({ statement }) => statement.includes('UPDATE dbo.students')).values.lrn, input.lrn);

  const registrarLrnChange = transactionalService(({ statement }) => {
    if (statement.includes('FROM dbo.users')) return { recordset: [{ id: 7, role: 'registrar' }] };
    if (statement.includes('FROM dbo.students WITH')) return { recordset: [{ id: 12, status: 'active', student_no: 'S-13', lrn: '123456789011' }] };
    throw new Error(`Unexpected query: ${statement}`);
  });
  await assert.rejects(registrarLrnChange.service.saveStudent(7, 12, input), /Only database administrators can change a recorded LRN/);
  assert.equal(registrarLrnChange.log.queries.some(({ statement }) => statement.includes('UPDATE dbo.students')), false);

  const databaseAdminEdit = transactionalService(({ statement }) => {
    if (statement.includes('FROM dbo.users')) return { recordset: [{ id: 7, role: 'database_admin' }] };
    if (statement.includes('FROM dbo.students WITH')) return { recordset: [{ id: 12, status: 'active', student_no: 'S-12', lrn: '123456789011' }] };
    if (statement.includes('UPDATE dbo.students')) return { recordset: [] };
    if (statement.includes('INSERT INTO dbo.audit_logs')) return { recordset: [] };
    throw new Error(`Unexpected query: ${statement}`);
  });
  assert.equal(await databaseAdminEdit.service.saveStudent(7, 12, input), 12);
  const update = databaseAdminEdit.log.queries.find(({ statement }) => statement.includes('UPDATE dbo.students'));
  assert.equal(update.values.studentNo, 'S-13');
  assert.equal(update.values.lrn, input.lrn);
  assert.equal(databaseAdminEdit.log.queries.at(-1).values.action, 'database_admin.student_updated');
  assert.equal(databaseAdminEdit.log.committed, true);
});

test('master list search binds escaped input, applies term filter, and bounds returned rows', async () => {
  const calls = [];
  const pool = {
    request() {
      const values = {};
      return {
        input(name, _type, value) { values[name] = value; return this; },
        async query(statement) {
          calls.push({ statement, values: { ...values } });
          if (statement.includes('FROM dbo.academic_terms')) return { recordset: [{ id: 3, school_year: '2026-2027', term: 'First', is_current: true }] };
          if (statement.includes('FROM dbo.sections')) return { recordset: [] };
          return { recordset: [] };
        }
      };
    }
  };
  const service = createStudentRecordsService({ getPool: async () => pool, sql: fakeSql() });
  const result = await service.listWorkspace('A_%[b]~', '3');
  const studentsCall = calls.at(-1);
  assert.equal(result.searchTerm, 'A_%[b]~');
  assert.equal(result.academicTermId, 3);
  assert.equal(studentsCall.values.searchPattern, '%A~_~%~[b~]~~%');
  assert.equal(studentsCall.values.academicTermId, 3);
  assert.match(studentsCall.statement, /OUTER APPLY/);
  assert.match(studentsCall.statement, /@academicTermId IS NULL OR EXISTS \([\s\S]*filtered_enrollment\.academic_term_id = @academicTermId/);
  assert.match(studentsCall.statement, /SELECT TOP \(250\)/);
  assert.doesNotMatch(studentsCall.statement, /A_%\[b\]/);
  await assert.rejects(service.listWorkspace('x'.repeat(101), ''), /100 printable characters or fewer/);
});

test('own student view queries only the student linked to the authenticated user id', async () => {
  const calls = [];
  const pool = {
    request() {
      const values = {};
      return {
        input(name, _type, value) { values[name] = value; return this; },
        async query(statement) {
          calls.push({ statement, values: { ...values } });
          if (statement.includes('FROM dbo.students WHERE user_id = @userId')) {
            return { recordset: [{ id: 21, student_no: 'S-21', first_name: 'Ari', last_name: 'Lee' }] };
          }
          return { recordset: [{ id: 91, school_year: '2026-2027', term: 'First' }] };
        }
      };
    }
  };
  const service = createStudentRecordsService({ getPool: async () => pool, sql: fakeSql() });
  const result = await service.getOwnStudentRecord(7);
  assert.equal(result.student.student_no, 'S-21');
  assert.equal(calls[0].values.userId, 7);
  assert.match(calls[0].statement, /WHERE user_id = @userId/);
  assert.equal(calls[1].values.studentId, 21);
  assert.match(calls[1].statement, /WHERE e\.student_id = @studentId/);
});

test('a section from another academic term is rejected before enrollment writes', async () => {
  const { service, log } = transactionalService(({ statement }) => {
    if (statement.includes('FROM dbo.users')) return { recordset: [{ id: 7, role: 'registrar' }] };
    if (statement.includes('FROM dbo.students')) return { recordset: [{ id: 12 }] };
    if (statement.includes('FROM dbo.academic_terms')) return { recordset: [{ id: 5 }] };
    if (statement.includes('FROM dbo.sections')) return { recordset: [] };
    throw new Error(`Unexpected query: ${statement}`);
  });

  await assert.rejects(service.saveEnrollment(7, { studentId: '12', academicTermId: '5', sectionId: '9' }), /belongs to the selected academic term/);
  assert.equal(log.committed, false);
  assert.equal(log.rolledBack, true);
  assert.equal(log.queries.some(({ statement }) => statement.includes('INSERT INTO dbo.enrollments')), false);
  assert.equal(log.queries.some(({ statement }) => statement.includes('INSERT INTO dbo.audit_logs')), false);
});

test('setting the current term clears the previous value and audits inside one transaction', async () => {
  const { service, log } = transactionalService(({ statement }) => {
    if (statement.includes('FROM dbo.users')) return { recordset: [{ id: 7, role: 'database_admin' }] };
    if (statement.includes('FROM dbo.academic_terms WITH (UPDLOCK')) return { recordset: [{ id: 4 }] };
    return { recordset: [] };
  });
  await service.setCurrentTerm(7, '4');
  assert.equal(log.committed, true);
  assert.equal(log.rolledBack, false);
  assert.equal(log.isolation, 'SERIALIZABLE');
  const clearIndex = log.queries.findIndex(({ statement }) => statement === 'UPDATE dbo.academic_terms SET is_current = 0 WHERE is_current = 1');
  const setIndex = log.queries.findIndex(({ statement }) => statement.includes('SET is_current = 1'));
  const auditIndex = log.queries.findIndex(({ statement }) => statement.includes('INSERT INTO dbo.audit_logs'));
  assert.ok(clearIndex >= 0 && clearIndex < setIndex && setIndex < auditIndex);
  assert.equal(log.queries[auditIndex].values.entityType, 'academic_term');
});

test('enrollment update changes only the section and keeps the schema-managed enrollment status', async () => {
  const { service, log } = transactionalService(({ statement }) => {
    if (statement.includes('FROM dbo.users')) return { recordset: [{ id: 7, role: 'registrar' }] };
    if (statement.includes('FROM dbo.students')) return { recordset: [{ id: 12 }] };
    if (statement.includes('FROM dbo.academic_terms')) return { recordset: [{ id: 5 }] };
    if (statement.includes('FROM dbo.sections')) return { recordset: [{ id: 9 }] };
    if (statement.includes('FROM dbo.enrollments')) return { recordset: [{ id: 44, enrollment_status: 'enrolled' }] };
    return { recordset: [] };
  });
  const enrollmentId = await service.saveEnrollment(7, { studentId: '12', academicTermId: '5', sectionId: '9' });
  const update = log.queries.find(({ statement }) => statement.includes('UPDATE dbo.enrollments'));
  assert.equal(enrollmentId, 44);
  assert.equal(update.values.sectionId, 9);
  assert.doesNotMatch(update.statement, /enrollment_status/);
  assert.equal(log.committed, true);
  assert.ok(log.queries.some(({ statement }) => statement.includes('INSERT INTO dbo.audit_logs')));
});

test('database administrator archives a student, disables the linked account, consumes OTPs, and audits atomically', async () => {
  const { service, log } = transactionalService(({ statement }) => {
    if (statement.includes('FROM dbo.users')) return { recordset: [{ id: 7, role: 'database_admin' }] };
    if (statement.includes('FROM dbo.students WITH')) return { recordset: [{ id: 12, user_id: 44, student_no: 'S-12', status: 'active' }] };
    return { recordset: [] };
  });
  assert.equal(await service.archiveStudent(7, '12', 'S-12'), 12);
  const archive = log.queries.find(({ statement }) => statement.includes("SET status = N'archived'"));
  const deactivate = log.queries.find(({ statement }) => statement.includes('UPDATE dbo.users SET is_active = 0'));
  const invalidate = log.queries.find(({ statement }) => statement.includes('UPDATE dbo.two_factor_codes'));
  const audit = log.queries.find(({ statement }) => statement.includes('INSERT INTO dbo.audit_logs'));
  assert.ok(archive && deactivate && invalidate && audit);
  assert.ok(log.queries.indexOf(archive) < log.queries.indexOf(deactivate));
  assert.equal(deactivate.values.userId, 44);
  assert.equal(audit.values.action, 'database_admin.student_archived');
  assert.deepEqual(JSON.parse(audit.values.detailsJson), { studentNo: 'S-12', loginDeactivated: true });
  assert.equal(log.isolation, 'SERIALIZABLE');
  assert.equal(log.committed, true);
});

test('student archival requires matching confirmation and an active database administrator', async () => {
  const mismatch = transactionalService(({ statement }) => {
    if (statement.includes('FROM dbo.users')) return { recordset: [{ id: 7, role: 'database_admin' }] };
    if (statement.includes('FROM dbo.students WITH')) return { recordset: [{ id: 12, user_id: null, student_no: 'S-12', status: 'active' }] };
    throw new Error(`Unexpected query: ${statement}`);
  });
  await assert.rejects(mismatch.service.archiveStudent(7, '12', 'S-13'), /Type this student’s number/);
  assert.equal(mismatch.log.rolledBack, true);
  assert.equal(mismatch.log.queries.some(({ statement }) => statement.includes('UPDATE dbo.students')), false);
  assert.equal(mismatch.log.queries.some(({ statement }) => statement.includes('INSERT INTO dbo.audit_logs')), false);

  const registrar = transactionalService(({ statement }) => {
    if (statement.includes('FROM dbo.users')) return { recordset: [{ id: 7, role: 'registrar' }] };
    throw new Error(`Unexpected query: ${statement}`);
  });
  await assert.rejects(registrar.service.archiveStudent(7, '12', 'S-12'), /Only database administrators/);
  assert.equal(registrar.log.rolledBack, true);
  assert.equal(registrar.log.queries.some(({ statement }) => statement.includes('FROM dbo.students')), false);
});

test('registrar deactivates only an active linked student login and preserves the master record', async () => {
  const { service, log } = transactionalService(({ statement }) => {
    if (statement.includes('FROM dbo.users') && statement.includes('actorId')) return { recordset: [{ id: 7, role: 'registrar' }] };
    if (statement.includes('FROM dbo.students WITH')) return { recordset: [{ id: 12, user_id: 44, status: 'active' }] };
    if (statement.includes('FROM dbo.users WITH') && statement.includes('userId')) return { recordset: [{ id: 44, is_active: true }] };
    return { recordset: [] };
  });
  assert.equal(await service.deactivateStudentLogin(7, '12', 'DEACTIVATE'), 12);
  const deactivate = log.queries.find(({ statement }) => statement.includes('UPDATE dbo.users SET is_active = 0'));
  const audit = log.queries.find(({ statement }) => statement.includes('INSERT INTO dbo.audit_logs'));
  assert.ok(deactivate);
  assert.equal(deactivate.values.userId, 44);
  assert.equal(log.queries.some(({ statement }) => statement.includes('UPDATE dbo.students')), false);
  assert.equal(log.queries.some(({ statement }) => statement.includes('UPDATE dbo.two_factor_codes')), true);
  assert.equal(audit.values.action, 'registrar.student_login_deactivated');
  assert.equal(log.committed, true);
});

test('finance cannot access the student master list and denied requests do not load academic data', async () => {
  let listReads = 0;
  const studentRecordsService = {
    async listWorkspace() { listReads += 1; return { students: [], terms: [], sections: [], searchTerm: '', academicTermId: null }; }
  };
  await withServer(createApp({ databasePool: makeAuthPool('finance'), environment, studentRecordsService }), async (baseUrl) => {
    const cookie = await signIn(baseUrl, 'finance');
    const response = await fetch(`${baseUrl}/records`, { headers: { cookie } });
    assert.equal(response.status, 403);
    assert.equal(listReads, 0);
  });
});

test('student dashboard resolves the own profile from session identity and rejects staff workspace access', async () => {
  const ownUserIds = [];
  const ownGradeUserIds = [];
  const summaryUserIds = [];
  const studentRecordsService = {
    async getOwnStudentRecord(userId) {
      ownUserIds.push(userId);
      return { student: { student_no: 'S-7', first_name: 'Rae', last_name: 'Student' }, enrollments: [] };
    },
    async getStudentDashboardSummary(userId) {
      summaryUserIds.push(userId);
      return { enrollment_count: 2, grade_entry_count: 1, document_count: 3, documents_in_progress_count: 1 };
    },
    async listWorkspace() { throw new Error('student should not read the staff list'); }
  };
  const academicRecordsService = {
    async getOwnGrades(userId) { ownGradeUserIds.push(userId); return []; }
  };
  await withServer(createApp({ databasePool: makeAuthPool('student'), environment, studentRecordsService, academicRecordsService }), async (baseUrl) => {
    const cookie = await signIn(baseUrl, 'student');
    const dashboard = await fetch(`${baseUrl}/dashboard/student?studentId=999`, { headers: { cookie } });
    assert.equal(dashboard.status, 200);
    const html = await dashboard.text();
    assert.match(html, /S-7/);
    assert.match(html, /Documents awaiting OCR or staff review[\s\S]*?<dd>1<\/dd>/);
    assert.deepEqual(ownUserIds, [7]);
    assert.deepEqual(summaryUserIds, [7]);
    assert.deepEqual(ownGradeUserIds, [7]);
    const records = await fetch(`${baseUrl}/records`, { headers: { cookie } });
    assert.equal(records.status, 403);
  });
});

test('records mutations reject missing CSRF tokens before calling the service', async () => {
  let createCalls = 0;
  const studentRecordsService = {
    async createTerm() { createCalls += 1; },
    async listWorkspace() { return {
      students: [{ id: 12, student_no: 'S-12', first_name: 'Jamie', last_name: 'Lee', status: 'active', enrollment_status: 'enrolled', school_year: '2026-2027', term: 'First' }],
      terms: [{ id: 2, school_year: '2026-2027', term: 'First', is_current: true }], sections: [], searchTerm: '', academicTermId: null
    }; },
    async getStudent(id) {
      return {
        student: { id, student_no: 'S-12', first_name: 'Jamie', last_name: 'Lee' },
        terms: [{ id: 2, school_year: '2026-2027', term: 'First', is_current: true }],
        sections: [], enrollments: []
      };
    }
  };
  await withServer(createApp({ databasePool: makeAuthPool('registrar'), environment, studentRecordsService }), async (baseUrl) => {
    const cookie = await signIn(baseUrl, 'registrar');
    const masterList = await fetch(`${baseUrl}/records`, { headers: { cookie } });
    assert.equal(masterList.status, 200);
    const masterListHtml = await masterList.text();
    assert.match(masterListHtml, /Student master list/);
    assert.match(masterListHtml, /record-status--active">Active/);
    assert.match(masterListHtml, /Edit profile/);
    assert.match(masterListHtml, /Academic record/);
    const newStudentForm = await fetch(`${baseUrl}/records/students/new`, { headers: { cookie } });
    assert.equal(newStudentForm.status, 200);
    assert.doesNotMatch(await newStudentForm.text(), /id="student-no"[^>]*readonly/);
    const editStudentForm = await fetch(`${baseUrl}/records/students/12/edit`, { headers: { cookie } });
    assert.equal(editStudentForm.status, 200);
    const editStudentHtml = await editStudentForm.text();
    assert.match(editStudentHtml, /Enrollment history/);
    assert.match(editStudentHtml, /id="student-no"[^>]*readonly aria-describedby="student-number-help"/);
    assert.match(editStudentHtml, /Only a database administrator can correct a student number/);
    const response = await postForm(baseUrl, '/records/terms', cookie, { schoolYear: '2026-2027', term: 'First' });
    assert.equal(response.status, 403);
    assert.equal(createCalls, 0);
  });
});

test('student archive is database-admin-only and registrar login deactivation is separate and CSRF protected', async () => {
  const calls = [];
  const studentRecordsService = {
    async getStudent(id) {
      return {
        student: { id, user_id: 44, linked_account_is_active: true, student_no: 'S-12', first_name: 'Jamie', last_name: 'Lee', status: 'active' },
        terms: [], sections: [], enrollments: []
      };
    },
    async listWorkspace() { return { students: [], terms: [], sections: [], searchTerm: '', academicTermId: null }; },
    async archiveStudent(...args) { calls.push(['archive', ...args]); return 12; },
    async deactivateStudentLogin(...args) { calls.push(['deactivate', ...args]); return 12; }
  };

  await withServer(createApp({ databasePool: makeAuthPool('database_admin'), environment, studentRecordsService }), async (baseUrl) => {
    const cookie = await signIn(baseUrl, 'database_admin');
    const page = await fetch(`${baseUrl}/records/students/12/edit`, { headers: { cookie } });
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /Type S-12 to confirm archiving/);
    assert.doesNotMatch(html, /id="student-no"[^>]*readonly/);
    assert.doesNotMatch(html, /login\/deactivate/);
    const response = await postForm(baseUrl, '/records/students/12/archive', cookie, {
      _csrf: csrfFromHtml(html), confirmation: 'S-12'
    });
    assert.equal(response.status, 303);
    assert.equal(calls[0][0], 'archive');
    assert.equal(calls[0][1], 7);
    const forbidden = await postForm(baseUrl, '/records/students/12/login/deactivate', cookie, {
      _csrf: csrfFromHtml(html), confirmation: 'DEACTIVATE'
    });
    assert.equal(forbidden.status, 403);
  });

  await withServer(createApp({ databasePool: makeAuthPool('registrar'), environment, studentRecordsService }), async (baseUrl) => {
    const cookie = await signIn(baseUrl, 'registrar');
    const page = await fetch(`${baseUrl}/records/students/12/edit`, { headers: { cookie } });
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /Type DEACTIVATE to disable this student login/);
    assert.doesNotMatch(html, /action="\/records\/students\/12\/archive"/);
    const response = await postForm(baseUrl, '/records/students/12/login/deactivate', cookie, {
      _csrf: csrfFromHtml(html), confirmation: 'DEACTIVATE'
    });
    assert.equal(response.status, 303);
    assert.equal(calls.at(-1)[0], 'deactivate');
    assert.equal(calls.at(-1)[1], 7);
    const forbidden = await postForm(baseUrl, '/records/students/12/archive', cookie, {
      _csrf: csrfFromHtml(html), confirmation: 'S-12'
    });
    assert.equal(forbidden.status, 403);
  });
  assert.equal(calls.filter(([action]) => action === 'archive').length, 1);
  assert.equal(calls.filter(([action]) => action === 'deactivate').length, 1);
});

test('archived student profiles explain that retained academic and finance history is review-only', async () => {
  const studentRecordsService = {
    async getStudent(id) {
      return {
        student: { id, user_id: null, student_no: 'S-12', first_name: 'Jamie', last_name: 'Lee', status: 'archived' },
        terms: [], sections: [], enrollments: []
      };
    },
    async listWorkspace() { return { students: [], terms: [], sections: [], searchTerm: '', academicTermId: null }; }
  };
  await withServer(createApp({ databasePool: makeAuthPool('registrar'), environment, studentRecordsService }), async (baseUrl) => {
    const cookie = await signIn(baseUrl, 'registrar');
    const page = await fetch(`${baseUrl}/records/students/12/edit`, { headers: { cookie } });
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /Existing academic and finance history remains available for review, but cannot be changed/);
    assert.match(html, /<fieldset disabled>/);
    assert.doesNotMatch(html, /authorized staff can continue maintaining/);
    assert.doesNotMatch(html, /action="\/records\/enrollments"/);
  });
});
