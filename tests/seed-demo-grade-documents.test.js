const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  DemoSeedError,
  parseOptions,
  buildGradeDemoPlan,
  ensurePrivateStorageDirectory,
  seedGradeDemoData
} = require('../scripts/seed-demo-grade-documents');

function fakeSql() {
  return {
    MAX: 'MAX',
    Int: 'Int',
    BigInt: 'BigInt',
    ISOLATION_LEVEL: { SERIALIZABLE: 'SERIALIZABLE' },
    NVarChar: (length) => `NVarChar(${length})`,
    Decimal: (precision, scale) => `Decimal(${precision},${scale})`
  };
}

function makeHarness({ markerExists = false, studentConflict = 0, failOnAudit = false } = {}) {
  const state = {
    markerExists,
    queries: [],
    commits: 0,
    rollbacks: 0,
    writes: [],
    unlinks: [],
    nextId: 1
  };
  const fileSystem = {
    async readFile(filename) {
      return filename.endsWith('.pdf')
        ? Buffer.from('%PDF-1.4 synthetic demo fixture')
        : Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
    },
    async mkdir() {},
    async realpath(filename) { return path.resolve(filename); },
    async chmod() {},
    async writeFile(filename, contents, options) { state.writes.push({ filename, contents, options }); },
    async unlink(filename) { state.unlinks.push(filename); }
  };
  const transactionFactory = () => ({
    async begin(isolation) { state.isolation = isolation; },
    request() {
      const values = {};
      return {
        input(name, _type, value) { values[name] = value; return this; },
        async query(statement) {
          state.queries.push({ statement, values: { ...values } });
          if (statement.includes('WHERE action = @action')) return { recordset: state.markerExists ? [{ id: 1 }] : [] };
          if (statement.includes('AS registrar_count')) {
            return { recordset: [{ registrar_count: 1, student_conflict_count: studentConflict, term_conflict_count: 0, subject_conflict_count: 0, document_conflict_count: 0 }] };
          }
          if (statement.includes('SELECT account.id FROM dbo.staff_profiles')) return { recordset: [{ id: 20 }] };
          if (statement.includes('INSERT INTO dbo.audit_logs')) {
            if (failOnAudit) throw new Error('test failure');
            state.markerExists = true;
            return { recordset: [] };
          }
          if (statement.includes('OUTPUT INSERTED.id')) return { recordset: [{ id: state.nextId++ }] };
          return { recordset: [] };
        }
      };
    },
    async commit() { state.commits += 1; },
    async rollback() { state.rollbacks += 1; }
  });
  return {
    state,
    fileSystem,
    options: {
      getDatabasePool: async () => ({}),
      sqlTypes: fakeSql(),
      transactionFactory,
      runtime: {
        nodeEnv: 'development',
        database: { server: 'localhost', database: 'ARKTIESIIS' },
        upload: { storageDirectory: path.join(path.sep, 'tmp', 'ark-demo-private') }
      },
      publicDirectory: path.join(path.sep, 'srv', 'arkt-public'),
      fileSystem,
      randomId: (() => { let index = 0; return () => `00000000-0000-4000-8000-${String(++index).padStart(12, '0')}`; })()
    }
  };
}

test('grade/document demo requires one explicit development-only mode', () => {
  assert.deepEqual(parseOptions(['--dry-run'], 'development'), { mode: 'dry-run' });
  assert.deepEqual(parseOptions(['--apply'], 'development'), { mode: 'apply' });
  assert.throws(() => parseOptions(['--apply'], 'production'), DemoSeedError);
  assert.throws(() => parseOptions([], 'development'), /exactly one option/);
  assert.throws(() => parseOptions(['--apply', '--dry-run'], 'development'), /exactly one option/);
});

test('plan matches the corrected SSHS fixture and labels documents as synthetic', () => {
  const plan = buildGradeDemoPlan();
  assert.deepEqual(plan.term, { schoolYear: '2026-2027', term: 'DEMO Grade Import' });
  assert.deepEqual(plan.section, { name: 'STEM A', gradeLevel: '11' });
  assert.deepEqual(plan.student, {
    studentNo: 'DEMO-GRADE-001', lrn: '123456789012', firstName: 'Jamie', lastName: 'Garcia'
  });
  assert.deepEqual(plan.subject, { code: 'DEMO-GRADE-OCOM-2026', name: 'Oral Communication', units: '3.00' });
  assert.ok(plan.documents.every(({ originalFilename }) => originalFilename.startsWith('DEMO-SAMPLE-') && originalFilename.includes('NOT-OFFICIAL')));
});

test('private storage rejects public paths and paths resolved through public symlinks', async () => {
  await assert.rejects(ensurePrivateStorageDirectory({
    storageDirectory: '/srv/arkt-public/uploads',
    publicDirectory: '/srv/arkt-public',
    fileSystem: { async mkdir() { throw new Error('must not create public storage'); } }
  }), /outside the public web directory/);

  const fileSystem = {
    async mkdir() {},
    async realpath(filename) { return filename.endsWith('storage-link') ? '/srv/arkt-public/uploads' : '/srv/arkt-public'; },
    async chmod() { throw new Error('must not chmod public storage'); }
  };
  await assert.rejects(ensurePrivateStorageDirectory({
    storageDirectory: '/srv/storage-link',
    publicDirectory: '/srv/arkt-public',
    fileSystem
  }), /outside the public web directory/);
});

test('seed creates one enrolled context and two unvalidated synthetic review submissions atomically', async () => {
  const fixture = makeHarness();
  const result = await seedGradeDemoData(fixture.options);
  assert.equal(result.alreadySeeded, false);
  assert.equal(result.contextCount, 1);
  assert.equal(result.studentCount, 1);
  assert.equal(result.documentCount, 2);
  assert.equal(fixture.state.isolation, 'SERIALIZABLE');
  assert.equal(fixture.state.commits, 1);
  assert.equal(fixture.state.rollbacks, 0);
  assert.equal(fixture.state.writes.length, 2);

  const studentInsert = fixture.state.queries.find(({ statement }) => statement.includes('INSERT INTO dbo.students'));
  assert.deepEqual({
    studentNo: studentInsert.values.studentNo,
    lrn: studentInsert.values.lrn,
    firstName: studentInsert.values.firstName,
    lastName: studentInsert.values.lastName
  }, { studentNo: 'DEMO-GRADE-001', lrn: '123456789012', firstName: 'Jamie', lastName: 'Garcia' });
  const sectionInsert = fixture.state.queries.find(({ statement }) => statement.includes('INSERT INTO dbo.sections'));
  assert.equal(sectionInsert.values.sectionName, 'STEM A');
  assert.equal(sectionInsert.values.gradeLevel, '11');
  const assignmentInsert = fixture.state.queries.find(({ statement }) => statement.includes('INSERT INTO dbo.student_subjects'));
  assert.ok(assignmentInsert);
  const documentInserts = fixture.state.queries.filter(({ statement }) => statement.includes('INSERT INTO dbo.documents'));
  assert.equal(documentInserts.length, 2);
  assert.ok(documentInserts.every(({ statement, values }) => statement.includes("N'needs_review'") && values.originalFilename.includes('NOT-OFFICIAL')));
  assert.equal(fixture.state.queries.some(({ statement }) => statement.includes('INSERT INTO dbo.document_validations')), false);
  assert.equal(fixture.state.queries.some(({ statement }) => statement.includes('INSERT INTO dbo.grades')), false);
});

test('seed reruns are no-ops and conflicts roll back before file or row creation', async () => {
  const already = makeHarness({ markerExists: true });
  assert.equal((await seedGradeDemoData(already.options)).alreadySeeded, true);
  assert.equal(already.state.writes.length, 0);
  assert.equal(already.state.queries.some(({ statement }) => statement.startsWith('INSERT INTO')), false);

  const conflict = makeHarness({ studentConflict: 1 });
  await assert.rejects(seedGradeDemoData(conflict.options), /already exists without its seed marker/);
  assert.equal(conflict.state.rollbacks, 1);
  assert.equal(conflict.state.commits, 0);
  assert.equal(conflict.state.writes.length, 0);
  assert.equal(conflict.state.queries.some(({ statement }) => statement.startsWith('INSERT INTO')), false);
});

test('failed database commit path removes newly written private sample files', async () => {
  const fixture = makeHarness({ failOnAudit: true });
  await assert.rejects(seedGradeDemoData(fixture.options), /test failure/);
  assert.equal(fixture.state.rollbacks, 1);
  assert.equal(fixture.state.writes.length, 2);
  assert.equal(fixture.state.unlinks.length, 2);
});
