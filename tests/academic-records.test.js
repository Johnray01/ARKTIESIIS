const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const bcrypt = require('bcrypt');
const { createApp } = require('../src/app');
const {
  AcademicRecordsError,
  createAcademicRecordsService,
  validateSubject,
  validateAssignment,
  validateGrade,
  normalizeGradeValue
} = require('../src/services/academicRecordsService');

function fakeSql() {
  return {
    MAX: 'MAX',
    Int: 'Int',
    ISOLATION_LEVEL: { SERIALIZABLE: 'SERIALIZABLE' },
    NVarChar: (length) => `NVarChar(${length})`,
    Decimal: (precision, scale) => `Decimal(${precision},${scale})`
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
  const service = createAcademicRecordsService({ getPool: async () => ({}), sql: fakeSql(), transactionFactory });
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
  return async () => ({
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
}

const environment = {
  nodeEnv: 'development',
  devPasswordOnlyLogin: true,
  sessionSecret: 'phase-six-academic-records-test-session-secret'
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

async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('subject, enrollment assignment, grading period, remarks, and provisional grade range are validated', () => {
  assert.deepEqual(validateSubject({ subjectCode: ' cs-101 ', subjectName: 'Computer Science', units: '3.00' }), {
    subjectCode: 'CS-101', subjectName: 'Computer Science', units: 3
  });
  assert.equal(validateSubject({ subjectCode: 'MATH 1', subjectName: 'Mathematics', units: '' }).units, null);
  assert.throws(() => validateSubject({ subjectCode: 'CS<1>', subjectName: 'Computer Science' }), AcademicRecordsError);
  assert.throws(() => validateSubject({ subjectCode: 'BIO-1', subjectName: 'x'.repeat(201) }), /Subject name is required/);
  assert.throws(() => validateSubject({ subjectCode: 'BIO-1', subjectName: 'Biology', units: '1000' }), /between 0.01 and 999.99/);
  assert.throws(() => validateSubject(null), /Subject code is required/);
  assert.deepEqual(validateAssignment({ studentId: '10', enrollmentId: '22', subjectId: '4' }), { studentId: 10, enrollmentId: 22, subjectId: 4 });
  assert.throws(() => validateAssignment({ studentId: '10', enrollmentId: 'bad', subjectId: '4' }), /valid enrollment/);
  assert.throws(() => validateAssignment(null), /valid student/);
  assert.equal(validateGrade({ studentId: '10', studentSubjectId: '22', gradingPeriod: 'Quarter A', gradeValue: '100', remarks: 'Complete' }).gradeValue, 100);
  assert.equal(validateGrade({ studentId: '10', studentSubjectId: '22', gradingPeriod: 'Term supplied by registrar' }).gradeValue, null);
  assert.throws(() => validateGrade({ studentId: '10', studentSubjectId: '22', gradingPeriod: 'x'.repeat(51) }), /Grading period is required/);
  assert.throws(() => validateGrade({ studentId: '10', studentSubjectId: '22', gradingPeriod: 'Quarter A', gradeValue: '100.01' }), /between 0 and 100/);
  assert.throws(() => validateGrade({ studentId: '10', studentSubjectId: '22', gradingPeriod: 'Quarter A', remarks: 'x'.repeat(101) }), /Remarks must be/);
  assert.throws(() => validateGrade(null), /valid student/);
  assert.equal(normalizeGradeValue('0'), 0);
  assert.throws(() => normalizeGradeValue('-1'), /number from 0 to 100/);
});

test('subject creation is parameterized, registrar-checked, serializable, and audited in its transaction', async () => {
  const { service, log } = transactionalService(({ statement }) => {
    if (statement.includes('FROM dbo.users')) return { recordset: [{ id: 7, role: 'registrar' }] };
    if (statement.includes('FROM dbo.subjects')) return { recordset: [] };
    if (statement.includes('INSERT INTO dbo.subjects')) return { recordset: [{ id: 31 }] };
    if (statement.includes('INSERT INTO dbo.audit_logs')) return { recordset: [] };
    throw new Error(`Unexpected query: ${statement}`);
  });

  const subjectId = await service.saveSubject(7, null, { subjectCode: 'eng-101', subjectName: 'English', units: '3' });
  assert.equal(subjectId, 31);
  assert.equal(log.isolation, 'SERIALIZABLE');
  assert.equal(log.committed, true);
  const insert = log.queries.find(({ statement }) => statement.includes('INSERT INTO dbo.subjects'));
  assert.equal(insert.values.subjectCode, 'ENG-101');
  assert.equal(insert.values.subjectName, 'English');
  assert.equal(insert.values.units, 3);
  assert.doesNotMatch(insert.statement, /ENG-101/);
  const audit = log.queries.find(({ statement }) => statement.includes('INSERT INTO dbo.audit_logs'));
  assert.equal(audit.values.action, 'registrar.subject_created');
  assert.equal(audit.values.entityId, '31');
});

test('academic writes reject non-registrar actors and duplicate catalog keys without audit writes', async () => {
  const denied = transactionalService(({ statement }) => {
    if (statement.includes('FROM dbo.users')) return { recordset: [{ id: 7, role: 'database_admin' }] };
    throw new Error(`Unexpected query: ${statement}`);
  });
  await assert.rejects(denied.service.saveSubject(7, null, { subjectCode: 'CS1', subjectName: 'Computer Science' }), /Registrar access is no longer active/);
  assert.equal(denied.log.rolledBack, true);
  assert.equal(denied.log.queries.some(({ statement }) => statement.includes('INSERT INTO dbo.subjects')), false);
  assert.equal(denied.log.queries.some(({ statement }) => statement.includes('INSERT INTO dbo.audit_logs')), false);

  const duplicate = transactionalService(({ statement }) => {
    if (statement.includes('FROM dbo.users')) return { recordset: [{ id: 7, role: 'registrar' }] };
    if (statement.includes('FROM dbo.subjects')) return { recordset: [{ id: 9 }] };
    throw new Error(`Unexpected query: ${statement}`);
  });
  await assert.rejects(duplicate.service.saveSubject(7, null, { subjectCode: 'CS1', subjectName: 'Computer Science' }), /already in use/);
  assert.equal(duplicate.log.rolledBack, true);
  assert.equal(duplicate.log.queries.some(({ statement }) => statement.includes('INSERT INTO dbo.subjects')), false);
  assert.equal(duplicate.log.queries.some(({ statement }) => statement.includes('INSERT INTO dbo.audit_logs')), false);
});

test('subject assignment verifies the student owns the enrollment and records audit atomically', async () => {
  const { service, log } = transactionalService(({ statement }) => {
    if (statement.includes('FROM dbo.users')) return { recordset: [{ id: 7, role: 'registrar' }] };
    if (statement.includes('FROM dbo.enrollments')) return { recordset: [{ id: 22, student_id: 10 }] };
    if (statement.includes('FROM dbo.subjects')) return { recordset: [{ id: 4 }] };
    if (statement.includes('FROM dbo.student_subjects')) return { recordset: [] };
    if (statement.includes('INSERT INTO dbo.student_subjects')) return { recordset: [{ id: 80 }] };
    if (statement.includes('INSERT INTO dbo.audit_logs')) return { recordset: [] };
    throw new Error(`Unexpected query: ${statement}`);
  });

  const studentId = await service.assignSubject(7, { studentId: '10', enrollmentId: '22', subjectId: '4' });
  assert.equal(studentId, 10);
  const enrollmentCheck = log.queries.find(({ statement }) => statement.includes('FROM dbo.enrollments'));
  assert.match(enrollmentCheck.statement, /e\.id = @enrollmentId AND e\.student_id = @studentId/);
  assert.deepEqual(enrollmentCheck.values, { enrollmentId: 22, studentId: 10 });
  assert.equal(log.queries.at(-1).values.action, 'registrar.subject_assigned');
  assert.equal(log.committed, true);
});

test('grade upsert binds the staff period and requires an enrollment subject belonging to that student', async () => {
  const { service, log } = transactionalService(({ statement }) => {
    if (statement.includes('FROM dbo.users')) return { recordset: [{ id: 7, role: 'registrar' }] };
    if (statement.includes('FROM dbo.student_subjects')) return { recordset: [{ id: 80, student_id: 10 }] };
    if (statement.includes('FROM dbo.grades') && statement.includes('id <> @gradeId')) return { recordset: [] };
    if (statement.includes('FROM dbo.grades')) return { recordset: [{ id: 91 }] };
    if (statement.includes('UPDATE dbo.grades')) return { recordset: [] };
    if (statement.includes('INSERT INTO dbo.audit_logs')) return { recordset: [] };
    throw new Error(`Unexpected query: ${statement}`);
  });

  const studentId = await service.saveGrade(7, {
    studentId: '10', studentSubjectId: '80', gradeId: '91', gradingPeriod: 'Quarter A', gradeValue: '92.50', remarks: 'Good progress'
  });
  assert.equal(studentId, 10);
  const associationCheck = log.queries.find(({ statement }) => statement.includes('FROM dbo.student_subjects'));
  assert.match(associationCheck.statement, /ss\.id = @studentSubjectId AND e\.student_id = @studentId/);
  assert.deepEqual(associationCheck.values, { studentSubjectId: 80, studentId: 10 });
  const periodQuery = log.queries.find(({ statement }) => statement.includes('FROM dbo.grades') && statement.includes('@gradingPeriod'));
  assert.equal(periodQuery.values.gradingPeriod, 'Quarter A');
  assert.ok(log.queries.some(({ statement }) => statement.includes('UPDATE dbo.grades')));
  assert.equal(log.queries.at(-1).values.action, 'registrar.grade_updated');
  assert.equal(log.committed, true);
});

test('grade update rejects a duplicate period key before update or audit', async () => {
  const { service, log } = transactionalService(({ statement }) => {
    if (statement.includes('FROM dbo.users')) return { recordset: [{ id: 7, role: 'registrar' }] };
    if (statement.includes('FROM dbo.student_subjects')) return { recordset: [{ id: 80, student_id: 10 }] };
    if (statement.includes('FROM dbo.grades') && statement.includes('id <> @gradeId')) return { recordset: [{ id: 92 }] };
    if (statement.includes('FROM dbo.grades')) return { recordset: [{ id: 91 }] };
    throw new Error(`Unexpected query: ${statement}`);
  });

  await assert.rejects(service.saveGrade(7, {
    studentId: '10', studentSubjectId: '80', gradeId: '91', gradingPeriod: 'Quarter A', gradeValue: '92'
  }), /already exists/);
  assert.equal(log.rolledBack, true);
  assert.equal(log.queries.some(({ statement }) => statement.includes('UPDATE dbo.grades')), false);
  assert.equal(log.queries.some(({ statement }) => statement.includes('INSERT INTO dbo.audit_logs')), false);
});

test('own grades query is scoped through the authenticated account-to-student link', async () => {
  const calls = [];
  const pool = {
    request() {
      const values = {};
      return {
        input(name, _type, value) { values[name] = value; return this; },
        async query(statement) {
          calls.push({ statement, values: { ...values } });
          return { recordset: [{ subject_code: 'CS1', grade_value: 95 }] };
        }
      };
    }
  };
  const service = createAcademicRecordsService({ getPool: async () => pool, sql: fakeSql() });
  const grades = await service.getOwnGrades(7);
  assert.equal(grades[0].subject_code, 'CS1');
  assert.equal(calls[0].values.userId, 7);
  assert.match(calls[0].statement, /WHERE st\.user_id = @userId/);
  assert.match(calls[0].statement, /JOIN dbo\.grades AS g ON g\.student_subject_id = ss\.id/);
  assert.doesNotMatch(calls[0].statement, /studentId/);
});

test('catalog reads follow role rules, mutations require CSRF, and rendered catalog values are escaped', async () => {
  let listReads = 0;
  const writes = [];
  const academicRecordsService = {
    async listSubjects() {
      listReads += 1;
      return [{ id: 4, subject_code: 'CS1', subject_name: '<script>alert(1)</script>', units: 3 }];
    },
    async saveSubject(...args) { writes.push(args); return 4; }
  };
  await withServer(createApp({
    databasePool: makeAuthPool('registrar'), environment, academicRecordsService,
    studentRecordsService: { async listWorkspace() { return {}; } }
  }), async (baseUrl) => {
    const cookie = await signIn(baseUrl, 'registrar');
    const page = await fetch(`${baseUrl}/records/subjects`, { headers: { cookie } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    const denied = await postForm(baseUrl, '/records/subjects', cookie, { subjectCode: 'X1', subjectName: 'Test' });
    assert.equal(denied.status, 403);
    assert.equal(writes.length, 0);
    const saved = await postForm(baseUrl, '/records/grades', cookie, { studentId: '10', studentSubjectId: '80', gradingPeriod: 'P1' });
    assert.equal(saved.status, 403);
    assert.equal(writes.length, 0);
  });

  await withServer(createApp({
    databasePool: makeAuthPool('finance'), environment, academicRecordsService,
    studentRecordsService: { async listWorkspace() { return {}; } }
  }), async (baseUrl) => {
    const cookie = await signIn(baseUrl, 'finance');
    const page = await fetch(`${baseUrl}/records/subjects`, { headers: { cookie } });
    assert.equal(page.status, 403);
  });

  await withServer(createApp({
    databasePool: makeAuthPool('database_admin'), environment, academicRecordsService,
    studentRecordsService: { async listWorkspace() { return {}; } }
  }), async (baseUrl) => {
    const cookie = await signIn(baseUrl, 'database_admin');
    const page = await fetch(`${baseUrl}/records/subjects`, { headers: { cookie } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    const denied = await postForm(baseUrl, '/records/subjects', cookie, { subjectCode: 'X1', subjectName: 'Test' });
    assert.equal(denied.status, 403);
  });
  assert.equal(writes.length, 0);
});

test('academic student view renders enrollment subjects and grades with registrar-only forms', async () => {
  const academicRecordsService = {
    async getStudentAcademicRecord() {
      return {
        student: { id: 10, student_no: 'S-10', first_name: 'Ari', last_name: 'Lee', status: 'active' },
        subjects: [{ id: 4, subject_code: 'CS1', subject_name: 'Computer Science', units: 3 }],
        enrollments: [{
          id: 22, school_year: '2026-2027', term: 'Registrar label', is_current: true,
          section_name: 'Section A', enrollment_status: 'enrolled',
          subjects: [{ id: 80, subjectId: 4, subjectCode: 'CS1', subjectName: 'Computer Science', units: 3,
            grades: [{ id: 91, gradingPeriod: 'Quarter A', gradeValue: 92.5, remarks: 'Good progress' }] }]
        }]
      };
    }
  };
  const studentRecordsService = { async listWorkspace() { return {}; } };
  await withServer(createApp({ databasePool: makeAuthPool('registrar'), environment, studentRecordsService, academicRecordsService }), async (baseUrl) => {
    const cookie = await signIn(baseUrl, 'registrar');
    const page = await fetch(`${baseUrl}/records/students/10/academic`, { headers: { cookie } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Enrollment history/);
    assert.match(html, /Registrar label/);
    assert.match(html, /Quarter A/);
    assert.match(html, /action="\/records\/grades"/);
    assert.match(html, /action="\/records\/student-subjects"/);
  });

  await withServer(createApp({ databasePool: makeAuthPool('database_admin'), environment, studentRecordsService, academicRecordsService }), async (baseUrl) => {
    const cookie = await signIn(baseUrl, 'database_admin');
    const page = await fetch(`${baseUrl}/records/students/10/academic`, { headers: { cookie } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Quarter A/);
    assert.doesNotMatch(html, /action="\/records\/grades"/);
    assert.doesNotMatch(html, /action="\/records\/student-subjects"/);
  });
});

test('registrar subject create requires a valid CSRF token before invoking writes', async () => {
  const writes = [];
  const academicRecordsService = {
    async listSubjects() { return []; },
    async saveSubject(...args) { writes.push(args); return 4; }
  };
  await withServer(createApp({
    databasePool: makeAuthPool('registrar'), environment, academicRecordsService,
    studentRecordsService: { async listWorkspace() { return {}; } }
  }), async (baseUrl) => {
    const cookie = await signIn(baseUrl, 'registrar');
    const page = await fetch(`${baseUrl}/records/subjects`, { headers: { cookie } });
    const csrfToken = csrfFromHtml(await page.text());
    const response = await postForm(baseUrl, '/records/subjects', cookie, {
      _csrf: csrfToken, subjectCode: 'CS1', subjectName: 'Computer Science', units: '3'
    });
    assert.equal(response.status, 303);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0], 7);
  });
});

test('student dashboard requests grades only with the session user id, ignoring query-supplied student ids', async () => {
  const gradeUserIds = [];
  const studentRecordsService = {
    async getOwnStudentRecord(userId) {
      assert.equal(userId, 7);
      return { student: { student_no: 'S-7', first_name: 'Rae', last_name: 'Student' }, enrollments: [] };
    }
  };
  const academicRecordsService = {
    async getOwnGrades(userId) {
      gradeUserIds.push(userId);
      return [{ subject_code: 'CS1', subject_name: 'Computer Science', grading_period: 'Quarter A', grade_value: 97 }];
    }
  };
  await withServer(createApp({ databasePool: makeAuthPool('student'), environment, studentRecordsService, academicRecordsService }), async (baseUrl) => {
    const cookie = await signIn(baseUrl, 'student');
    const page = await fetch(`${baseUrl}/dashboard/student?studentId=999&userId=888`, { headers: { cookie } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /CS1 · Computer Science/);
    assert.deepEqual(gradeUserIds, [7]);
  });
});
