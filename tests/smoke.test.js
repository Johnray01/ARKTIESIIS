const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const bcrypt = require('bcrypt');
const { createApp } = require('../src/app');
const { validateRequiredText } = require('../src/services/documentValidationService');
const { bootstrapAdmin, validateBootstrapInput } = require('../scripts/bootstrap-admin');

async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

const developmentEnvironment = () => ({
  nodeEnv: 'development',
  devPasswordOnlyLogin: true,
  sessionSecret: 'phase-two-test-session-secret'
});

function createAuthDatabase(userRows) {
  const queries = [];
  return {
    queries,
    getPool: async () => ({
      request() {
        const values = {};
        return {
          input(name, type, value) {
            values[name] = value;
            return this;
          },
          async query(statement) {
            queries.push({ statement, values });
            if (statement.includes('WHERE email = @email')) {
              const user = userRows.find((row) => row.email === values.email);
              return { recordset: user ? [{ ...user }] : [] };
            }
            if (statement.includes('WHERE id = @userId')) {
              const user = userRows.find((row) => row.id === values.userId);
              return { recordset: user ? [{ id: user.id, email: user.email, role: user.role, is_active: user.is_active }] : [] };
            }
            throw new Error(`Unexpected SQL in auth test: ${statement}`);
          }
        };
      }
    })
  };
}

function getSessionCookie(response) {
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie, 'expected the server to set a session cookie');
  return cookie.split(';', 1)[0];
}

function csrfFromHtml(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  assert.ok(match, 'expected a session CSRF token in the form');
  return match[1];
}

async function postForm(baseUrl, path, cookie, values, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(values),
    ...options
  });
}

async function loginForCookie(baseUrl, email = 'registrar@example.edu') {
  const loginPage = await fetch(`${baseUrl}/login`);
  const anonymousCookie = getSessionCookie(loginPage);
  const csrfToken = csrfFromHtml(await loginPage.text());
  const response = await postForm(baseUrl, '/login', anonymousCookie, {
    _csrf: csrfToken,
    email,
    password: 'Correct-Horse-Battery-12'
  });
  assert.equal(response.status, 303);
  return getSessionCookie(response);
}

test('required text validator passes when all configured keywords exist', () => {
  const result = validateRequiredText('Juan Dela Cruz School Year 2026', [
    { key: 'student_name', label: 'Student Name', keywords: ['Juan Dela Cruz'] },
    { key: 'school_year', label: 'School Year', keywords: ['School Year'] }
  ]);
  assert.equal(result.complete, true);
});

test('home page renders with Helmet default content security policy', async () => {
  await withServer(createApp({ databasePool: async () => { throw new Error('Database not used'); } }), async (baseUrl) => {
    const response = await fetch(baseUrl);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /ARKTIESIIS/);
    assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  });
});

test('login page renders', async () => {
  await withServer(createApp({ environment: developmentEnvironment() }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/login`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /<h1>Login<\/h1>/);
  });
});

test('login page is unavailable without the dev gate and does not create a session', async () => {
  const disabledEnvironments = [
    { nodeEnv: 'development', devPasswordOnlyLogin: false },
    { nodeEnv: 'test', devPasswordOnlyLogin: true },
    { nodeEnv: 'production', devPasswordOnlyLogin: true }
  ];

  for (const [index, environment] of disabledEnvironments.entries()) {
    await withServer(createApp({
      environment: { ...environment, sessionSecret: `login-unavailable-session-secret-${index}` }
    }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/login`);
      const html = await response.text();

      assert.equal(response.status, 503);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.match(html, /Password-only login is unavailable in this environment\./);
    });
  }
});

test('unknown routes render a 404 page', async () => {
  await withServer(createApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/missing`);
    const html = await response.text();

    assert.equal(response.status, 404);
    assert.match(html, /Page not found\./);
  });
});

test('health route reports a successful database check', async () => {
  let query;
  const databasePool = async () => ({
    request: () => ({
      query: async (sql) => {
        query = sql;
        return { recordset: [{ ok: 1 }] };
      }
    })
  });

  await withServer(createApp({ databasePool }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, database: 'connected' });
    assert.equal(query, 'SELECT 1 AS ok');
  });
});

test('health route reports database failure without exposing SQL details', async () => {
  const databasePool = async () => {
    throw new Error('SQL login failed for secret-host.internal with password=secret');
  };

  await withServer(createApp({ databasePool }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.text();

    assert.equal(response.status, 503);
    assert.deepEqual(JSON.parse(body), { ok: false, database: 'disconnected' });
    assert.doesNotMatch(body, /secret-host|password=secret|SQL login/);
  });
});

test('environment rejects invalid ports and a missing production session secret', () => {
  const baseEnv = { PATH: process.env.PATH, NODE_ENV: 'development' };
  const loadEnvironment = (overrides) => spawnSync(
    process.execPath,
    ['-e', "require('./src/config/environment')"],
    { cwd: process.cwd(), env: { ...baseEnv, ...overrides }, encoding: 'utf8' }
  );

  assert.notEqual(loadEnvironment({ PORT: 'not-a-port' }).status, 0);
  assert.notEqual(loadEnvironment({ DB_PORT: '65536' }).status, 0);
  assert.notEqual(loadEnvironment({ NODE_ENV: 'production', SESSION_SECRET: '' }).status, 0);
  assert.equal(loadEnvironment({ NODE_ENV: 'production', SESSION_SECRET: 'a'.repeat(32) }).status, 0);
});

test('development login regenerates the session and redirects to the database-backed role dashboard', async () => {
  const passwordHash = await bcrypt.hash('Correct-Horse-Battery-12', 4);
  const database = createAuthDatabase([{
    id: 21,
    email: 'registrar@example.edu',
    password_hash: passwordHash,
    role: 'registrar',
    is_active: true
  }]);

  await withServer(createApp({ databasePool: database.getPool, environment: developmentEnvironment() }), async (baseUrl) => {
    const loginPage = await fetch(`${baseUrl}/login`);
    const anonymousCookie = getSessionCookie(loginPage);
    const csrfToken = csrfFromHtml(await loginPage.text());
    const response = await postForm(baseUrl, '/login', anonymousCookie, {
      _csrf: csrfToken,
      email: 'Registrar@Example.edu',
      password: 'Correct-Horse-Battery-12'
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/dashboard');
    const authenticatedCookie = getSessionCookie(response);
    assert.notEqual(authenticatedCookie, anonymousCookie);

    const staleSessionResponse = await fetch(`${baseUrl}/dashboard`, { headers: { cookie: anonymousCookie }, redirect: 'manual' });
    assert.equal(staleSessionResponse.status, 302);
    assert.equal(staleSessionResponse.headers.get('location'), '/login');

    const dashboardRedirect = await fetch(`${baseUrl}/dashboard`, { headers: { cookie: authenticatedCookie }, redirect: 'manual' });
    assert.equal(dashboardRedirect.status, 303);
    assert.equal(dashboardRedirect.headers.get('location'), '/dashboard/registrar');

    const rolePage = await fetch(`${baseUrl}/dashboard/registrar`, { headers: { cookie: authenticatedCookie } });
    assert.equal(rolePage.status, 200);
    assert.match(await rolePage.text(), /Registrar Dashboard/);

    const deniedPage = await fetch(`${baseUrl}/dashboard/finance`, { headers: { cookie: authenticatedCookie } });
    assert.equal(deniedPage.status, 403);
    assert.ok(database.queries.some(({ statement, values }) => statement.includes('WHERE email = @email') && values.email === 'registrar@example.edu'));
    assert.ok(database.queries.filter(({ statement }) => statement.includes('WHERE id = @userId')).length >= 3);
  });
});

test('login and logout reject missing or invalid session CSRF tokens and valid logout clears the session', async () => {
  const passwordHash = await bcrypt.hash('Correct-Horse-Battery-12', 4);
  const database = createAuthDatabase([{
    id: 3,
    email: 'student@example.edu',
    password_hash: passwordHash,
    role: 'student',
    is_active: true
  }]);

  await withServer(createApp({ databasePool: database.getPool, environment: developmentEnvironment() }), async (baseUrl) => {
    const page = await fetch(`${baseUrl}/login`);
    const anonymousCookie = getSessionCookie(page);
    const token = csrfFromHtml(await page.text());

    const missingLoginCsrf = await postForm(baseUrl, '/login', anonymousCookie, { email: 'student@example.edu', password: 'bad' });
    const badLoginCsrf = await postForm(baseUrl, '/login', anonymousCookie, { _csrf: 'wrong', email: 'student@example.edu', password: 'bad' });
    assert.equal(missingLoginCsrf.status, 403);
    assert.equal(badLoginCsrf.status, 403);

    const authenticatedCookie = await loginForCookie(baseUrl, 'student@example.edu');
    const dashboard = await fetch(`${baseUrl}/dashboard/student`, { headers: { cookie: authenticatedCookie } });
    const logoutCsrf = csrfFromHtml(await dashboard.text());

    const missingLogoutCsrf = await postForm(baseUrl, '/logout', authenticatedCookie, {});
    const badLogoutCsrf = await postForm(baseUrl, '/logout', authenticatedCookie, { _csrf: 'wrong' });
    assert.equal(missingLogoutCsrf.status, 403);
    assert.equal(badLogoutCsrf.status, 403);

    const logout = await postForm(baseUrl, '/logout', authenticatedCookie, { _csrf: logoutCsrf });
    assert.equal(logout.status, 303);
    assert.equal(logout.headers.get('location'), '/login');
    assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);

    const afterLogout = await fetch(`${baseUrl}/dashboard`, { headers: { cookie: authenticatedCookie }, redirect: 'manual' });
    assert.equal(afterLogout.status, 302);
    assert.equal(afterLogout.headers.get('location'), '/login');
    assert.ok(token.length >= 32);
  });
});

test('login returns the same credential error for missing, inactive, and wrong-password accounts', async () => {
  const passwordHash = await bcrypt.hash('Correct-Horse-Battery-12', 4);
  const database = createAuthDatabase([
    { id: 1, email: 'active@example.edu', password_hash: passwordHash, role: 'student', is_active: true },
    { id: 2, email: 'inactive@example.edu', password_hash: passwordHash, role: 'student', is_active: false }
  ]);

  await withServer(createApp({ databasePool: database.getPool, environment: developmentEnvironment() }), async (baseUrl) => {
    const results = [];
    for (const email of ['missing@example.edu', 'inactive@example.edu', 'active@example.edu']) {
      const page = await fetch(`${baseUrl}/login`);
      const cookie = getSessionCookie(page);
      const token = csrfFromHtml(await page.text());
      const response = await postForm(baseUrl, '/login', cookie, {
        _csrf: token,
        email,
        password: email === 'active@example.edu' ? 'wrong-password' : 'Correct-Horse-Battery-12'
      });
      results.push({ status: response.status, body: await response.text() });
    }

    assert.deepEqual(results.map((result) => result.status), [401, 401, 401]);
    assert.ok(results.every((result) => /<p role="alert">Invalid email or password\.<\/p>/.test(result.body)));
  });
});

test('inactive users lose protected access after their account is deactivated', async () => {
  const passwordHash = await bcrypt.hash('Correct-Horse-Battery-12', 4);
  const user = { id: 14, email: 'registrar@example.edu', password_hash: passwordHash, role: 'registrar', is_active: true };
  const database = createAuthDatabase([user]);

  await withServer(createApp({ databasePool: database.getPool, environment: developmentEnvironment() }), async (baseUrl) => {
    const cookie = await loginForCookie(baseUrl, 'registrar@example.edu');
    user.is_active = false;
    const response = await fetch(`${baseUrl}/dashboard/registrar`, { headers: { cookie }, redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');
    assert.match(response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  });
});

test('password-only login is denied outside development and a dev session is destroyed if the environment changes', async () => {
  const passwordHash = await bcrypt.hash('Correct-Horse-Battery-12', 4);
  const user = { id: 8, email: 'student@example.edu', password_hash: passwordHash, role: 'student', is_active: true };
  const database = createAuthDatabase([user]);

  const mutableEnvironment = developmentEnvironment();
  await withServer(createApp({ databasePool: database.getPool, environment: mutableEnvironment }), async (baseUrl) => {
    const page = await fetch(`${baseUrl}/login`);
    const cookie = getSessionCookie(page);
    const token = csrfFromHtml(await page.text());
    mutableEnvironment.nodeEnv = 'test';
    const deniedPost = await postForm(baseUrl, '/login', cookie, {
      _csrf: token,
      email: 'student@example.edu',
      password: 'Correct-Horse-Battery-12'
    });
    assert.equal(deniedPost.status, 403);
    assert.equal(database.queries.length, 0);

    mutableEnvironment.nodeEnv = 'development';
    const login = await postForm(baseUrl, '/login', cookie, {
      _csrf: token,
      email: 'student@example.edu',
      password: 'Correct-Horse-Battery-12'
    });
    assert.equal(login.status, 303);
    const authenticatedCookie = getSessionCookie(login);

    mutableEnvironment.nodeEnv = 'production';
    const response = await fetch(`${baseUrl}/dashboard/student`, { headers: { cookie: authenticatedCookie }, redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');
    assert.match(response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  });
});

test('login limiter allows ten attempts per IP and rejects the next attempt', async () => {
  const database = createAuthDatabase([]);
  await withServer(createApp({ databasePool: database.getPool, environment: developmentEnvironment() }), async (baseUrl) => {
    const page = await fetch(`${baseUrl}/login`);
    const cookie = getSessionCookie(page);
    const token = csrfFromHtml(await page.text());
    const statuses = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await postForm(baseUrl, '/login', cookie, {
        _csrf: token,
        email: 'nobody@example.edu',
        password: 'not-the-password'
      });
      statuses.push(response.status);
      await response.arrayBuffer();
    }
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 429]);
  });
});

test('admin bootstrap validates fields and creates user, staff profile, and audit event in one transaction', async () => {
  assert.throws(() => validateBootstrapInput({ email: 'bad', firstName: 'Admin', lastName: 'User', password: 'short' }));
  const statements = [];
  const transactionState = { beginLevel: null, committed: false, rolledBack: false };
  const sqlTypes = {
    MAX: -1,
    Int: 'Int',
    NVarChar: (length) => `NVarChar(${length})`,
    ISOLATION_LEVEL: { SERIALIZABLE: 'serializable' },
    Transaction: class {
      constructor() {}
      async begin(level) { transactionState.beginLevel = level; }
      request() {
        const values = {};
        return {
          input(name, type, value) { values[name] = value; return this; },
          async query(statement) {
            statements.push({ statement, values });
            if (statement.startsWith('SELECT TOP')) return { recordset: [] };
            if (statement.startsWith('INSERT INTO dbo.users')) return { recordset: [{ id: 91 }] };
            return { recordset: [] };
          }
        };
      }
      async commit() { transactionState.committed = true; }
      async rollback() { transactionState.rolledBack = true; }
    }
  };
  const result = await bootstrapAdmin({
    email: 'admin@example.edu',
    firstName: 'Ada',
    lastName: 'Lovelace',
    password: 'Correct-Horse-Battery-12'
  }, {
    getDatabasePool: async () => ({}),
    sqlTypes,
    hashPassword: async (password, rounds) => {
      assert.equal(password, 'Correct-Horse-Battery-12');
      assert.equal(rounds, 12);
      return 'bcrypt-hash-value';
    }
  });

  assert.equal(result, 91);
  assert.equal(transactionState.beginLevel, 'serializable');
  assert.equal(transactionState.committed, true);
  assert.equal(transactionState.rolledBack, false);
  assert.equal(statements.length, 4);
  assert.ok(statements.every(({ statement }) => statement.includes('@')));
  assert.ok(statements.some(({ statement, values }) => statement.includes('dbo.staff_profiles') && values.firstName === 'Ada'));
  assert.ok(statements.some(({ statement, values }) => statement.includes('dbo.audit_logs') && values.action === 'admin.bootstrap'));
});

test('admin bootstrap refuses to create a second database administrator', async () => {
  let committed = false;
  let rolledBack = false;
  let queryCount = 0;
  const sqlTypes = {
    MAX: -1,
    Int: 'Int',
    NVarChar: (length) => `NVarChar(${length})`,
    ISOLATION_LEVEL: { SERIALIZABLE: 'serializable' },
    Transaction: class {
      constructor() {}
      async begin() {}
      request() {
        return {
          input() { return this; },
          async query() { queryCount += 1; return { recordset: [{ id: 1 }] }; }
        };
      }
      async commit() { committed = true; }
      async rollback() { rolledBack = true; }
    }
  };

  await assert.rejects(bootstrapAdmin({
    email: 'admin@example.edu',
    firstName: 'Ada',
    lastName: 'Lovelace',
    password: 'Correct-Horse-Battery-12'
  }, {
    getDatabasePool: async () => ({}),
    sqlTypes,
    hashPassword: async () => 'bcrypt-hash-value'
  }), /A database administrator already exists\./);

  assert.equal(queryCount, 1);
  assert.equal(committed, false);
  assert.equal(rolledBack, true);
});
