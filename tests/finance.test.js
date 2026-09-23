const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const bcrypt = require('bcrypt');
const { createApp } = require('../src/app');
const {
  FinanceServiceError,
  createFinanceService,
  parseMoneyCents,
  formatMoneyCents,
  validateTransaction
} = require('../src/services/financeService');

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
  return {
    service: createFinanceService({ getPool: async () => ({}), sql: fakeSql(), transactionFactory }),
    log
  };
}

function transactionFixture({ actorRole = 'finance', balance = '10.00', duplicate = false, failAt = null, studentExists = true, accountExists = false, transactionAccountExists = true } = {}) {
  let stateBalance = balance;
  const { service, log } = transactionalService(({ statement, values }) => {
    if (statement.includes('FROM dbo.users')) return { recordset: actorRole ? [{ id: 7, role: actorRole }] : [] };
    if (statement.includes('FROM dbo.students WITH')) return { recordset: studentExists ? [{ id: 22 }] : [] };
    if (statement.includes('FROM dbo.financial_accounts WITH')) return { recordset: accountExists ? [{ id: 30 }] : [] };
    if (statement.includes('FROM dbo.financial_accounts AS a')) return { recordset: transactionAccountExists ? [{ financial_account_id: 30, balance: stateBalance }] : [] };
    if (statement.includes('FROM dbo.financial_transactions WITH')) return { recordset: duplicate ? [{ id: 90 }] : [] };
    if (statement.includes('UPDATE dbo.financial_accounts')) {
      if (failAt === 'update') throw new Error('simulated account update failure');
      stateBalance = values.balance;
      return { recordset: [] };
    }
    if (statement.includes('INSERT INTO dbo.financial_accounts')) {
      if (failAt === 'account_insert') throw new Error('simulated account insert failure');
      return { recordset: [{ id: 30 }] };
    }
    if (statement.includes('INSERT INTO dbo.financial_transactions')) {
      if (failAt === 'transaction_insert') throw new Error('simulated transaction insert failure');
      return { recordset: [{ id: 91 }] };
    }
    if (statement.includes('INSERT INTO dbo.audit_logs')) {
      if (failAt === 'audit') throw new Error('simulated audit failure');
      return { recordset: [] };
    }
    throw new Error(`Unexpected query: ${statement}`);
  });
  return { service, log, getBalance: () => stateBalance };
}

test('money parsing and financial transaction fields enforce DECIMAL(12,2) limits and signs', () => {
  assert.equal(parseMoneyCents('9999999999.99'), 999999999999n);
  assert.equal(parseMoneyCents('-0.01', { allowNegative: true }), -1n);
  assert.equal(formatMoneyCents(-1n), '-0.01');
  assert.deepEqual(validateTransaction({ transactionType: 'charge', amount: '12.3' }), {
    transactionType: 'charge', amountCents: 1230n, amount: '12.30', description: null, referenceNo: null
  });
  assert.deepEqual(validateTransaction({ transactionType: 'adjustment', amount: '-2.50', description: 'Correction' }), {
    transactionType: 'adjustment', amountCents: -250n, amount: '-2.50', description: 'Correction', referenceNo: null
  });
  assert.throws(() => validateTransaction({ transactionType: 'charge', amount: '-1' }), FinanceServiceError);
  assert.throws(() => validateTransaction({ transactionType: 'payment', amount: '0' }), /must not be zero/);
  assert.throws(() => validateTransaction({ transactionType: 'adjustment', amount: '0.00', description: 'Correction' }), /must not be zero/);
  assert.throws(() => validateTransaction({ transactionType: 'adjustment', amount: '1.00' }), /reason for the balance adjustment/);
  assert.throws(() => validateTransaction({ transactionType: 'adjustment', amount: '1.00', description: 'x'.repeat(501) }), /Description must be/);
  assert.throws(() => validateTransaction({ transactionType: 'charge', amount: '10000000000.00' }), /10 whole digits/);
  assert.throws(() => validateTransaction({ transactionType: 'charge', amount: '1.001' }), /10 whole digits/);
  assert.throws(() => validateTransaction({ transactionType: 'unknown', amount: '1.00' }), /Choose a charge/);
  assert.throws(() => validateTransaction({ transactionType: 'charge', amount: '1.00', referenceNo: 'x'.repeat(101) }), /Reference number must be/);
});

test('finance student search is parameterized, escaped, bounded, and limited to finance identifiers', async () => {
  const calls = [];
  const pool = {
    request() {
      const values = {};
      return {
        input(name, _type, value) { values[name] = value; return this; },
        async query(statement) { calls.push({ statement, values: { ...values } }); return { recordset: [{ student_id: 22, student_no: 'S-22' }] }; }
      };
    }
  };
  const service = createFinanceService({ getPool: async () => pool, sql: fakeSql() });
  assert.deepEqual(await service.searchStudents(' S_%[1]~ '), { students: [{ student_id: 22, student_no: 'S-22' }], searchTerm: 'S_%[1]~' });
  assert.equal(calls[0].values.searchPattern, '%S~_~%~[1~]~~%');
  assert.match(calls[0].statement, /SELECT TOP \(100\)/);
  assert.doesNotMatch(calls[0].statement, /enrollments|grades|birth_date|address/);
  assert.deepEqual(await service.searchStudents(''), { students: [], searchTerm: '' });
  assert.equal(calls.length, 1, 'empty search should not enumerate student accounts');
  await assert.rejects(service.searchStudents('x'.repeat(101)), /100 printable characters or fewer/);
});

test('account and transaction history read paths return only the selected student finance record', async () => {
  const calls = [];
  const pool = {
    request() {
      const values = {};
      return {
        input(name, _type, value) { values[name] = value; return this; },
        async query(statement) {
          calls.push({ statement, values: { ...values } });
          if (statement.includes('FROM dbo.students')) return { recordset: [{ student_id: 22, student_no: 'S-22', first_name: 'Alex', last_name: 'Kim' }] };
          if (statement.includes('FROM dbo.financial_accounts')) return { recordset: [{ financial_account_id: 30, balance: '-2.50' }] };
          if (statement.includes('FROM dbo.financial_transactions')) return { recordset: [{ id: 90, transaction_type: 'adjustment', amount: '-2.50' }] };
          throw new Error(`Unexpected query: ${statement}`);
        }
      };
    }
  };
  const service = createFinanceService({ getPool: async () => pool, sql: fakeSql() });
  const record = await service.getStudentAccount('22');
  assert.equal(record.student.student_no, 'S-22');
  assert.equal(record.account.balance, '-2.50');
  assert.equal(record.transactions[0].transaction_type, 'adjustment');
  assert.deepEqual(calls.map(({ values }) => Object.values(values)), [[22], [22], [30]]);
  assert.doesNotMatch(calls.map(({ statement }) => statement).join('\n'), /grade|enrollment|document|birth_date|address/);
  await assert.rejects(service.getStudentAccount('../22'), /not found/);
});

test('account creation is finance-checked, student-owned, serializable, and audited atomically', async () => {
  const { service, log } = transactionFixture();
  const accountId = await service.createAccount(7, '22');
  assert.equal(accountId, 30);
  assert.equal(log.isolation, 'SERIALIZABLE');
  assert.equal(log.committed, true);
  const studentLock = log.queries.find(({ statement }) => statement.includes('FROM dbo.students WITH'));
  assert.match(studentLock.statement, /UPDLOCK, HOLDLOCK/);
  assert.equal(studentLock.values.studentId, 22);
  const insert = log.queries.find(({ statement }) => statement.includes('INSERT INTO dbo.financial_accounts'));
  assert.equal(insert.values.studentId, 22);
  const audit = log.queries.find(({ statement }) => statement.includes('INSERT INTO dbo.audit_logs'));
  assert.equal(audit.values.action, 'finance.account_created');
  assert.equal(JSON.parse(audit.values.detailsJson).studentId, 22);
});

test('non-finance or inactive finance actors cannot create accounts or record transactions', async () => {
  const deniedAccount = transactionFixture({ actorRole: 'registrar' });
  await assert.rejects(deniedAccount.service.createAccount(7, '22'), /finance access is no longer active/i);
  assert.equal(deniedAccount.log.rolledBack, true);
  assert.equal(deniedAccount.log.queries.some(({ statement }) => statement.includes('INSERT INTO dbo.financial_accounts')), false);
  assert.equal(deniedAccount.log.queries.some(({ statement }) => statement.includes('INSERT INTO dbo.audit_logs')), false);

  const deniedTransaction = transactionFixture({ actorRole: 'database_admin' });
  await assert.rejects(deniedTransaction.service.recordTransaction(7, '22', { transactionType: 'charge', amount: '1.00' }), /finance access is no longer active/i);
  assert.equal(deniedTransaction.log.rolledBack, true);
  assert.equal(deniedTransaction.log.queries.some(({ statement }) => statement.includes('UPDATE dbo.financial_accounts')), false);
});

test('account creation rejects missing students and existing accounts without writes', async () => {
  const missingStudent = transactionFixture({ studentExists: false });
  await assert.rejects(missingStudent.service.createAccount(7, '22'), /Student record not found/);
  assert.equal(missingStudent.log.rolledBack, true);
  assert.equal(missingStudent.log.queries.some(({ statement }) => statement.includes('INSERT INTO dbo.financial_accounts')), false);

  const existing = transactionFixture({ accountExists: true });
  await assert.rejects(existing.service.createAccount(7, '22'), /already has a financial account/);
  assert.equal(existing.log.rolledBack, true);
  assert.equal(existing.log.queries.some(({ statement }) => statement.includes('INSERT INTO dbo.financial_accounts')), false);
});

test('charges, payments, and signed adjustments update balance in the correct direction', async () => {
  const entries = [
    [{ transactionType: 'charge', amount: '5.00' }, '15.00'],
    [{ transactionType: 'payment', amount: '7.00' }, '3.00'],
    [{ transactionType: 'adjustment', amount: '-12.50', description: 'Credit correction' }, '-2.50']
  ];
  for (const [input, expectedBalance] of entries) {
    const fixture = transactionFixture();
    const result = await fixture.service.recordTransaction(7, '22', input);
    assert.equal(result.balance, expectedBalance);
    assert.equal(fixture.getBalance(), expectedBalance);
    const accountLookup = fixture.log.queries.find(({ statement }) => statement.includes('FROM dbo.financial_accounts AS a'));
    assert.match(accountLookup.statement, /a\.student_id/);
    assert.equal(accountLookup.values.studentId, 22);
    const update = fixture.log.queries.find(({ statement }) => statement.includes('UPDATE dbo.financial_accounts'));
    assert.equal(update.values.balance, expectedBalance);
    const insert = fixture.log.queries.find(({ statement }) => statement.includes('INSERT INTO dbo.financial_transactions'));
    assert.equal(insert.values.amount, input.amount === '7.00' ? '7.00' : input.amount);
    assert.equal(fixture.log.queries.at(-1).values.action, 'finance.transaction_recorded');
    assert.equal(fixture.log.committed, true);
  }
});

test('duplicate references are rejected for the owned account before balance, transaction, or audit writes', async () => {
  const fixture = transactionFixture({ duplicate: true });
  await assert.rejects(fixture.service.recordTransaction(7, '22', {
    transactionType: 'charge', amount: '5.00', referenceNo: 'REF-7'
  }), /already used for this account/);
  const duplicate = fixture.log.queries.find(({ statement }) => statement.includes('FROM dbo.financial_transactions WITH'));
  assert.deepEqual(duplicate.values, { accountId: 30, referenceNo: 'REF-7' });
  assert.match(duplicate.statement, /financial_account_id = @accountId AND reference_no = @referenceNo/);
  assert.equal(fixture.log.rolledBack, true);
  assert.equal(fixture.log.queries.some(({ statement }) => statement.includes('UPDATE dbo.financial_accounts')), false);
  assert.equal(fixture.log.queries.some(({ statement }) => statement.includes('INSERT INTO dbo.financial_transactions')), false);
  assert.equal(fixture.log.queries.some(({ statement }) => statement.includes('INSERT INTO dbo.audit_logs')), false);
});

test('transactions require an existing account and reject balance overflow before updates', async () => {
  const absent = transactionFixture({ balance: '10.00', transactionAccountExists: false });
  await assert.rejects(absent.service.recordTransaction(7, '22', { transactionType: 'payment', amount: '1.00' }), /account not found/);
  assert.equal(absent.log.rolledBack, true);

  const overflow = transactionFixture({ balance: '9999999999.99' });
  await assert.rejects(overflow.service.recordTransaction(7, '22', { transactionType: 'charge', amount: '0.01' }), /exceed the supported balance limit/);
  assert.equal(overflow.log.rolledBack, true);
  assert.equal(overflow.log.queries.some(({ statement }) => statement.includes('UPDATE dbo.financial_accounts')), false);
});

test('a transaction insert or audit failure rolls back the balance update and transaction as one unit', async () => {
  for (const failAt of ['transaction_insert', 'audit']) {
    const fixture = transactionFixture({ failAt });
    await assert.rejects(fixture.service.recordTransaction(7, '22', {
      transactionType: 'charge', amount: '2.00', referenceNo: 'REF-1'
    }), /simulated/);
    assert.equal(fixture.log.rolledBack, true);
    assert.equal(fixture.log.committed, false);
    assert.ok(fixture.log.queries.some(({ statement }) => statement.includes('UPDATE dbo.financial_accounts')));
    if (failAt === 'audit') assert.ok(fixture.log.queries.some(({ statement }) => statement.includes('INSERT INTO dbo.financial_transactions')));
  }
});

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
          throw new Error(`Unexpected authentication query: ${statement}`);
        }
      };
    }
  });
}

const environment = {
  nodeEnv: 'development',
  devPasswordOnlyLogin: true,
  sessionSecret: 'phase-seven-finance-test-session-secret'
};

function cookieFrom(response) {
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie);
  return cookie.split(';', 1)[0];
}

function csrfFrom(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  assert.ok(match);
  return match[1];
}

async function withServer(app, callback) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function signIn(baseUrl, role) {
  const page = await fetch(`${baseUrl}/login`);
  const cookie = cookieFrom(page);
  const token = csrfFrom(await page.text());
  const response = await fetch(`${baseUrl}/login`, {
    method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: token, email: `${role}@example.edu`, password: 'Correct-Horse-Battery-12' })
  });
  assert.equal(response.status, 303);
  return cookieFrom(response);
}

test('finance routes permit finance staff only and protect all writes with CSRF', async () => {
  const calls = [];
  const financeService = {
    async searchStudents(searchTerm) { calls.push(['search', searchTerm]); return { students: [], searchTerm }; },
    async getStudentAccount(studentId) {
      calls.push(['read', studentId]);
      return { student: { student_id: studentId, student_no: 'S-22', first_name: 'Alex', last_name: 'Kim' }, account: null, transactions: [] };
    },
    async createAccount(actorId, studentId) { calls.push(['create', actorId, studentId]); return 30; },
    async recordTransaction(actorId, studentId, input) { calls.push(['record', actorId, studentId, input]); return {}; }
  };
  await withServer(createApp({ databasePool: makeAuthPool('finance'), environment, financeService }), async (baseUrl) => {
    const cookie = await signIn(baseUrl, 'finance');
    const redirect = await fetch(`${baseUrl}/dashboard`, { headers: { cookie }, redirect: 'manual' });
    assert.equal(redirect.headers.get('location'), '/finance');
    const workspace = await fetch(`${baseUrl}/finance`, { headers: { cookie } });
    assert.equal(workspace.status, 200);
    assert.match(await workspace.text(), /Finance workspace/);
    assert.equal(calls[0][0], 'search');

    const accountPage = await fetch(`${baseUrl}/finance/students/22`, { headers: { cookie } });
    const accountHtml = await accountPage.text();
    assert.equal(accountPage.status, 200);
    assert.match(accountHtml, /Create financial account/);
    const missingCsrf = await fetch(`${baseUrl}/finance/students/22/account`, {
      method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: ''
    });
    assert.equal(missingCsrf.status, 403);
    assert.equal(calls.some(([name]) => name === 'create'), false);
    const missingTransactionCsrf = await fetch(`${baseUrl}/finance/students/22/transactions`, {
      method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: ''
    });
    assert.equal(missingTransactionCsrf.status, 403);
    assert.equal(calls.some(([name]) => name === 'record'), false);

    const createResponse = await fetch(`${baseUrl}/finance/students/22/account`, {
      method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrfFrom(accountHtml) })
    });
    assert.equal(createResponse.status, 303);
    assert.equal(createResponse.headers.get('location'), '/finance/students/22?notice=accountCreated');
  });

  const serviceCallsBeforeDeniedRequests = calls.length;
  for (const role of ['student', 'registrar', 'database_admin']) {
    const app = createApp({ databasePool: makeAuthPool(role), environment, financeService });
    await withServer(app, async (baseUrl) => {
      const cookie = await signIn(baseUrl, role);
      const response = await fetch(`${baseUrl}/finance`, { headers: { cookie }, redirect: 'manual' });
      assert.equal(response.status, 403, `${role} must be denied finance access`);
      const write = await fetch(`${baseUrl}/finance/students/22/transactions`, {
        method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: ''
      });
      assert.equal(write.status, 403, `${role} must be denied finance writes`);
    });
  }
  assert.equal(calls.length, serviceCallsBeforeDeniedRequests, 'denied roles must not load or mutate finance records');
});
