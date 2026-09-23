const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const bcrypt = require('bcrypt');
const { createApp } = require('../src/app');

const passwordHash = bcrypt.hashSync('Correct-Horse-Battery-12', 4);
const environment = {
  nodeEnv: 'development',
  devPasswordOnlyLogin: true,
  sessionSecret: 'navigation-test-session-secret'
};

function createAuthPool(role) {
  const user = {
    id: 7,
    email: `${role}@example.edu`,
    password_hash: passwordHash,
    role,
    is_active: true,
    updated_at_fingerprint: ''
  };
  const getPool = async () => ({
    request() {
      const values = {};
      return {
        input(name, _type, value) { values[name] = value; return this; },
        async query(statement) {
          if (statement.includes('WHERE email = @email')) return { recordset: [user] };
          if (statement.includes('WHERE id = @userId')) return { recordset: [{ ...user }] };
          throw new Error(`Unexpected auth query: ${statement}`);
        }
      };
    }
  });
  getPool.user = user;
  return getPool;
}

function services() {
  return {
    adminService: {
      async listDashboard() { return { users: [], auditLogs: [], searchTerm: '' }; }
    },
    studentRecordsService: {
      async listWorkspace() { return { students: [], terms: [], sections: [], searchTerm: '', academicTermId: null }; },
      async getStudent(id) {
        return { student: { id, student_no: 'S-22', first_name: 'Alex', last_name: 'Kim', status: 'active' }, terms: [], sections: [], enrollments: [] };
      },
      async getOwnStudentRecord() { return null; }
    },
    academicRecordsService: {
      async listSubjects() { return []; },
      async getStudentAcademicRecord(id) {
        return { student: { id, student_no: 'S-22', first_name: 'Alex', last_name: 'Kim', status: 'active' }, enrollments: [], subjects: [] };
      },
      async getOwnGrades() { return []; }
    },
    financeService: {
      async searchStudents(searchTerm) { return { students: [], searchTerm }; },
      async getStudentAccount() {
        return {
          student: { student_id: 22, student_no: 'S-22', first_name: 'Alex', last_name: 'Kim' },
          account: null,
          transactions: []
        };
      }
    }
  };
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

function sessionCookie(response) {
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
  const loginPage = await fetch(`${baseUrl}/login`);
  const token = csrfFromHtml(await loginPage.text());
  const response = await postForm(baseUrl, '/login', sessionCookie(loginPage), {
    _csrf: token,
    email: `${role}@example.edu`,
    password: 'Correct-Horse-Battery-12'
  });
  assert.equal(response.status, 303);
  return sessionCookie(response);
}

function navigationLabels(html) {
  const nav = html.match(/<nav class="primary-nav"[\s\S]*?<\/nav>/);
  assert.ok(nav, 'expected authenticated primary navigation');
  return [...nav[0].matchAll(/class="primary-nav__link"[^>]*>([^<]+)<\/a>/g)].map((match) => match[1]);
}

test('authenticated navigation only exposes destinations available to each role', async () => {
  const cases = [
    { role: 'database_admin', path: '/admin', labels: ['Overview', 'Student records', 'Subject catalog', 'Finance'], forbidden: [] },
    { role: 'registrar', path: '/dashboard/registrar', labels: ['Overview', 'Student records', 'Subject catalog'], forbidden: ['/finance', '/admin'] },
    { role: 'finance', path: '/finance', labels: ['Finance workspace'], forbidden: ['/records', '/admin'] },
    { role: 'student', path: '/dashboard/student', labels: ['My record'], forbidden: ['/records', '/finance', '/admin'] }
  ];

  for (const scenario of cases) {
    const app = createApp({ databasePool: createAuthPool(scenario.role), environment, ...services() });
    await withServer(app, async (baseUrl) => {
      const cookie = await signIn(baseUrl, scenario.role);
      const response = await fetch(`${baseUrl}${scenario.path}`, { headers: { cookie } });
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.deepEqual(navigationLabels(html), scenario.labels);
      assert.match(html, /<a class="brand" href="\/dashboard" aria-label="ARKTIESIIS workspace">/);
      assert.match(html, /<a class="primary-nav__link"[^>]*aria-current="page"/);
      assert.match(html, /<form class="site-header__signout" method="post" action="\/logout">/);
      assert.equal((html.match(/action="\/logout"/g) || []).length, 1, 'sign-out appears only in the shared header');
      assert.ok(csrfFromHtml(html).length >= 32);
      for (const href of scenario.forbidden) assert.doesNotMatch(html, new RegExp(`href="${href.replace('/', '\\/')}`));
    });
  }
});

test('nested workspace pages mark the current destination and provide fixed parent links', async () => {
  const registrarApp = createApp({ databasePool: createAuthPool('registrar'), environment, ...services() });
  await withServer(registrarApp, async (baseUrl) => {
    const cookie = await signIn(baseUrl, 'registrar');
    const subjects = await fetch(`${baseUrl}/records/subjects`, { headers: { cookie } });
    const subjectsHtml = await subjects.text();
    assert.match(subjectsHtml, /href="\/records\/subjects" aria-current="page"/);
    assert.match(subjectsHtml, /class="context-back" href="\/records"/);

    const profile = await fetch(`${baseUrl}/records/students/22/edit`, { headers: { cookie } });
    const profileHtml = await profile.text();
    assert.match(profileHtml, /class="context-back" href="\/records"/);
    assert.match(profileHtml, /href="\/records\/students\/22\/academic"/);

    const academic = await fetch(`${baseUrl}/records/students/22/academic`, { headers: { cookie } });
    const academicHtml = await academic.text();
    assert.match(academicHtml, /class="context-back" href="\/records\/students\/22\/edit"/);
  });

  const adminApp = createApp({ databasePool: createAuthPool('database_admin'), environment, ...services() });
  await withServer(adminApp, async (baseUrl) => {
    const cookie = await signIn(baseUrl, 'database_admin');
    const accountForm = await fetch(`${baseUrl}/admin/users/new`, { headers: { cookie } });
    const html = await accountForm.text();
    assert.match(html, /class="primary-nav__link" href="\/dashboard" aria-current="page"/);
    assert.match(html, /class="context-back" href="\/admin#users-title"/);
  });

  const financeApp = createApp({ databasePool: createAuthPool('finance'), environment, ...services() });
  await withServer(financeApp, async (baseUrl) => {
    const cookie = await signIn(baseUrl, 'finance');
    const account = await fetch(`${baseUrl}/finance/students/22`, { headers: { cookie } });
    assert.match(await account.text(), /class="context-back" href="\/finance"/);
  });
});

test('shared sign-out rejects invalid CSRF and destroys the session with a valid token', async () => {
  const app = createApp({ databasePool: createAuthPool('student'), environment, ...services() });
  await withServer(app, async (baseUrl) => {
    const cookie = await signIn(baseUrl, 'student');
    const page = await fetch(`${baseUrl}/dashboard/student`, { headers: { cookie } });
    const html = await page.text();
    const token = csrfFromHtml(html);

    const missing = await postForm(baseUrl, '/logout', cookie, {});
    const invalid = await postForm(baseUrl, '/logout', cookie, { _csrf: 'invalid' });
    assert.equal(missing.status, 403);
    assert.equal(invalid.status, 403);

    const logout = await postForm(baseUrl, '/logout', cookie, { _csrf: token });
    assert.equal(logout.status, 303);
    assert.equal(logout.headers.get('location'), '/login');
    assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  });
});

test('using another account clears the pending verification session through a CSRF-protected post', async () => {
  const getPool = createAuthPool('registrar');
  const twoFactorService = {
    OTP_TTL_MINUTES: 5,
    async issueOtpChallenge() { return { allowed: true, codeId: 9 }; },
    async sendOtpEmail() {},
    async getActiveUser() { return { ...getPool.user }; }
  };
  const twoFactorEnvironment = {
    ...environment,
    devPasswordOnlyLogin: false,
    smtp: { host: 'mail.example.edu', from: 'noreply@example.edu' }
  };
  const app = createApp({ databasePool: getPool, environment: twoFactorEnvironment, twoFactorService, ...services() });
  await withServer(app, async (baseUrl) => {
    const loginPage = await fetch(`${baseUrl}/login`);
    const token = csrfFromHtml(await loginPage.text());
    const pending = await postForm(baseUrl, '/login', sessionCookie(loginPage), {
      _csrf: token,
      email: 'registrar@example.edu',
      password: 'Correct-Horse-Battery-12'
    });
    assert.equal(pending.headers.get('location'), '/login/verify');
    const pendingCookie = sessionCookie(pending);
    const verification = await fetch(`${baseUrl}/login/verify`, { headers: { cookie: pendingCookie } });
    const verificationHtml = await verification.text();
    assert.match(verificationHtml, /Use another account/);
    const cancelToken = csrfFromHtml(verificationHtml);

    const canceled = await postForm(baseUrl, '/login/verify/cancel', pendingCookie, { _csrf: cancelToken });
    assert.equal(canceled.status, 303);
    assert.equal(canceled.headers.get('location'), '/login');
    assert.match(canceled.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);

    const staleVerification = await fetch(`${baseUrl}/login/verify`, { headers: { cookie: pendingCookie }, redirect: 'manual' });
    assert.equal(staleVerification.status, 302);
    assert.equal(staleVerification.headers.get('location'), '/login');
  });
});
