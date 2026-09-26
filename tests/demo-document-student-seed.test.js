const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DEMO_VERSION,
  STUDENT_EMAIL_KEY,
  STUDENT_PASSWORD_KEY,
  parseOptions,
  loadOrCreateDocumentStudentCredentials,
  seedDemoDocumentStudent
} = require('../scripts/seed-demo-document-student');
const { DemoSeedError, deriveDemoEmails } = require('../scripts/seed-demo');

const smtpUser = 'prototype.user@gmail.com';
const credentials = {
  email: deriveDemoEmails(smtpUser).documentStudent,
  password: 's'.repeat(40)
};

function fakeSql() {
  return {
    MAX: 'MAX',
    Int: 'Int',
    ISOLATION_LEVEL: { SERIALIZABLE: 'SERIALIZABLE' },
    NVarChar: (length) => `NVarChar(${length})`
  };
}

function makeSeedDatabase({ markerExists = false, emailConflict = false, student = { id: 10, user_id: null, status: 'active' }, documentCount = 2 } = {}) {
  const state = { markerExists, emailConflict, student, documentCount, queries: [], commits: 0, rollbacks: 0 };
  let nextId = 1;
  const transactionFactory = () => ({
    async begin(isolation) { state.isolation = isolation; },
    request() {
      const values = {};
      return {
        input(name, _type, value) { values[name] = value; return this; },
        async query(statement) {
          state.queries.push({ statement, values: { ...values } });
          if (statement.includes('WHERE action = @action')) return { recordset: state.markerExists ? [{ id: 1 }] : [] };
          if (statement.includes('FROM dbo.users WITH')) return { recordset: state.emailConflict ? [{ id: 2 }] : [] };
          if (statement.includes('FROM dbo.students WITH')) return { recordset: state.student ? [state.student] : [] };
          if (statement.includes('COUNT_BIG(*) AS document_count')) return { recordset: [{ document_count: state.documentCount }] };
          if (statement.includes('OUTPUT INSERTED.id AS id VALUES')) return { recordset: [{ id: nextId++ }] };
          if (statement.includes('OUTPUT INSERTED.id AS id WHERE')) return { recordset: [{ id: values.studentId }] };
          if (statement.includes('INSERT INTO dbo.audit_logs')) state.markerExists = true;
          return { recordset: [] };
        }
      };
    },
    async commit() { state.commits += 1; },
    async rollback() { state.rollbacks += 1; }
  });
  return {
    state,
    options: {
      getDatabasePool: async () => ({}),
      sqlTypes: fakeSql(),
      transactionFactory,
      credentials,
      runtime: {
        nodeEnv: 'development',
        database: { server: 'localhost', database: 'ARKTIESIIS' },
        smtp: { user: smtpUser }
      },
      hashPassword: async (password, rounds) => `${rounds}:${password}`
    }
  };
}

test('document-student demo requires one explicit local development mode', () => {
  assert.deepEqual(parseOptions(['--dry-run'], 'development'), { mode: 'dry-run' });
  assert.deepEqual(parseOptions(['--apply'], 'development'), { mode: 'apply' });
  assert.throws(() => parseOptions(['--apply'], 'production'), DemoSeedError);
  assert.throws(() => parseOptions([], 'development'), /exactly one option/);
  assert.throws(() => parseOptions(['--apply', '--dry-run'], 'development'), /exactly one option/);
});

test('document-student credentials extend and preserve the owner-only .env.demo file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arktiesiis-demo-document-student-'));
  const filePath = path.join(directory, '.env.demo');
  try {
    const first = loadOrCreateDocumentStudentCredentials({ smtpUser, filePath, randomPassword: () => 'x'.repeat(40) });
    assert.deepEqual(first, { email: credentials.email, password: 'x'.repeat(40) });
    const contents = fs.readFileSync(filePath, 'utf8');
    assert.ok(contents.split(/\r?\n/).includes(`${STUDENT_EMAIL_KEY}=${credentials.email}`));
    assert.ok(contents.split(/\r?\n/).includes(`${STUDENT_PASSWORD_KEY}=${'x'.repeat(40)}`));
    if (process.platform !== 'win32') assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);

    const beforeRerun = fs.readFileSync(filePath, 'utf8');
    const second = loadOrCreateDocumentStudentCredentials({ smtpUser, filePath, randomPassword: () => { throw new Error('must preserve existing credentials'); } });
    assert.deepEqual(second, first);
    assert.equal(fs.readFileSync(filePath, 'utf8'), beforeRerun);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('document-student seed links the existing samples and preserves review decisions', async () => {
  const fixture = makeSeedDatabase();
  const result = await seedDemoDocumentStudent(fixture.options);
  assert.deepEqual(result, { alreadySeeded: false });
  assert.equal(fixture.state.isolation, 'SERIALIZABLE');
  assert.equal(fixture.state.commits, 1);
  assert.equal(fixture.state.rollbacks, 0);

  const studentLookup = fixture.state.queries.find(({ statement }) => statement.includes('FROM dbo.students WITH'));
  assert.deepEqual(studentLookup.values, { studentNo: 'DEMO-GRADE-001', lrn: '123456789012' });
  const documentLookup = fixture.state.queries.find(({ statement }) => statement.includes('COUNT_BIG(*) AS document_count'));
  assert.deepEqual(documentLookup.values, { studentId: 10, documentName0: 'DEMO-SAMPLE-Good-Moral-NOT-OFFICIAL.pdf', documentName1: 'DEMO-SAMPLE-Report-Card-NOT-OFFICIAL.png' });
  assert.doesNotMatch(documentLookup.statement, /status\s*=\s*N'needs_review'/);
  const userInsert = fixture.state.queries.find(({ statement }) => statement.includes('INSERT INTO dbo.users'));
  assert.equal(userInsert.values.email, credentials.email);
  assert.equal(userInsert.values.role, 'student');
  const studentLink = fixture.state.queries.find(({ statement }) => statement.includes('UPDATE dbo.students SET user_id'));
  assert.equal(studentLink.values.studentId, 10);
  assert.match(studentLink.statement, /user_id IS NULL AND status <> N'archived'/);
  const marker = fixture.state.queries.find(({ statement }) => statement.includes('INSERT INTO dbo.audit_logs'));
  assert.equal(marker.values.entityId, DEMO_VERSION);
  assert.deepEqual(JSON.parse(marker.values.detailsJson), { role: 'student', studentNo: 'DEMO-GRADE-001', documents: 2, synthetic: true });

  const rerun = makeSeedDatabase({ markerExists: true });
  assert.deepEqual(await seedDemoDocumentStudent(rerun.options), { alreadySeeded: true });
  assert.equal(rerun.state.commits, 1);
  assert.equal(rerun.state.queries.some(({ statement }) => statement.startsWith('INSERT INTO')), false);
});

test('document-student seed stops before inserts if the login, student, or sample documents conflict', async () => {
  const scenarios = [
    { emailConflict: true },
    { student: { id: 10, user_id: 77, status: 'active' } },
    { student: { id: 10, user_id: null, status: 'archived' } },
    { documentCount: 1 },
    { student: null }
  ];
  for (const scenario of scenarios) {
    const fixture = makeSeedDatabase(scenario);
    await assert.rejects(seedDemoDocumentStudent(fixture.options), DemoSeedError);
    assert.equal(fixture.state.rollbacks, 1);
    assert.equal(fixture.state.commits, 0);
    assert.equal(fixture.state.queries.some(({ statement }) => statement.includes('INSERT INTO dbo.users')), false);
  }
});
