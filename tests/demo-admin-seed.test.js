const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DEMO_VERSION,
  ADMIN_EMAIL_KEY,
  ADMIN_PASSWORD_KEY,
  parseOptions,
  loadOrCreateAdminCredentials,
  seedDemoAdminAccount
} = require('../scripts/seed-demo-admin');
const { DemoSeedError, deriveDemoEmails } = require('../scripts/seed-demo');

const smtpUser = 'prototype.user@gmail.com';
const credentials = {
  email: deriveDemoEmails(smtpUser).databaseAdmin,
  password: 'd'.repeat(40)
};

function fakeSql() {
  return {
    MAX: 'MAX',
    Int: 'Int',
    ISOLATION_LEVEL: { SERIALIZABLE: 'SERIALIZABLE' },
    NVarChar: (length) => `NVarChar(${length})`
  };
}

function makeSeedDatabase({ markerExists = false, emailConflict = false, employeeConflict = false } = {}) {
  const state = { markerExists, emailConflict, employeeConflict, queries: [], commits: 0, rollbacks: 0 };
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
          if (statement.includes('FROM dbo.staff_profiles WITH')) return { recordset: state.employeeConflict ? [{ id: 3 }] : [] };
          if (statement.includes('OUTPUT INSERTED.id')) return { recordset: [{ id: nextId++ }] };
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

test('dashboard admin demo requires one explicit local development mode', () => {
  assert.deepEqual(parseOptions(['--dry-run'], 'development'), { mode: 'dry-run' });
  assert.deepEqual(parseOptions(['--apply'], 'development'), { mode: 'apply' });
  assert.throws(() => parseOptions(['--apply'], 'production'), DemoSeedError);
  assert.throws(() => parseOptions([], 'development'), /exactly one option/);
  assert.throws(() => parseOptions(['--apply', '--dry-run'], 'development'), /exactly one option/);
});

test('dashboard admin demo credentials extend and preserve the owner-only .env.demo file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arktiesiis-demo-admin-'));
  const filePath = path.join(directory, '.env.demo');
  try {
    const first = loadOrCreateAdminCredentials({
      smtpUser,
      filePath,
      randomPassword: () => 'a'.repeat(40)
    });
    assert.equal(first.email, credentials.email);
    assert.equal(first.password, 'a'.repeat(40));
    const contents = fs.readFileSync(filePath, 'utf8');
    assert.ok(contents.split(/\r?\n/).includes(`${ADMIN_EMAIL_KEY}=${credentials.email}`));
    assert.ok(contents.split(/\r?\n/).includes(`${ADMIN_PASSWORD_KEY}=${'a'.repeat(40)}`));
    if (process.platform !== 'win32') assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);

    const beforeRerun = fs.readFileSync(filePath, 'utf8');
    const second = loadOrCreateAdminCredentials({ smtpUser, filePath, randomPassword: () => { throw new Error('must preserve existing credentials'); } });
    assert.deepEqual(second, first);
    assert.equal(fs.readFileSync(filePath, 'utf8'), beforeRerun);
    assert.throws(() => loadOrCreateAdminCredentials({ smtpUser: 'other@gmail.com', filePath }), /do not match SMTP_USER/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('dashboard admin seed inserts only its synthetic role account, records its marker, and is idempotent', async () => {
  const fixture = makeSeedDatabase();
  const result = await seedDemoAdminAccount(fixture.options);
  assert.deepEqual(result, { alreadySeeded: false });
  assert.equal(fixture.state.isolation, 'SERIALIZABLE');
  assert.equal(fixture.state.commits, 1);
  assert.equal(fixture.state.rollbacks, 0);

  const userInsert = fixture.state.queries.find(({ statement }) => statement.includes('INSERT INTO dbo.users'));
  assert.equal(userInsert.values.email, credentials.email);
  assert.equal(userInsert.values.passwordHash, `12:${credentials.password}`);
  assert.equal(userInsert.values.role, 'database_admin');
  const profileInsert = fixture.state.queries.find(({ statement }) => statement.includes('INSERT INTO dbo.staff_profiles'));
  assert.equal(profileInsert.values.employeeNo, 'DEMO-STAFF-ADMIN-001');
  const marker = fixture.state.queries.find(({ statement }) => statement.includes('INSERT INTO dbo.audit_logs'));
  assert.equal(marker.values.entityId, DEMO_VERSION);
  assert.deepEqual(JSON.parse(marker.values.detailsJson), { role: 'database_admin', synthetic: true });

  const rerun = makeSeedDatabase({ markerExists: true });
  assert.deepEqual(await seedDemoAdminAccount(rerun.options), { alreadySeeded: true });
  assert.equal(rerun.state.commits, 1);
  assert.equal(rerun.state.queries.some(({ statement }) => statement.startsWith('INSERT INTO')), false);
});

test('dashboard admin seed rolls back when its email or staff identifier already exists without a marker', async () => {
  for (const options of [{ emailConflict: true }, { employeeConflict: true }]) {
    const fixture = makeSeedDatabase(options);
    await assert.rejects(seedDemoAdminAccount(fixture.options), /already exists without its seed marker/);
    assert.equal(fixture.state.rollbacks, 1);
    assert.equal(fixture.state.commits, 0);
    assert.equal(fixture.state.queries.some(({ statement }) => statement.includes('INSERT INTO dbo.users')), false);
  }
});
