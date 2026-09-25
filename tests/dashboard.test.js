const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const bcrypt = require('bcrypt');
const { createApp } = require('../src/app');

const password = 'Correct-Horse-Battery-12';
const passwordHash = bcrypt.hashSync(password, 4);
const environment = {
  nodeEnv: 'development',
  devPasswordOnlyLogin: true,
  sessionSecret: 'phase-eleven-dashboard-test-session-secret'
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
  return async () => ({
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
}

function cookieFrom(response) {
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie);
  return cookie.split(';', 1)[0];
}

function csrfFromHtml(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  assert.ok(match);
  return match[1];
}

async function signIn(baseUrl, role) {
  const loginPage = await fetch(`${baseUrl}/login`);
  const cookie = cookieFrom(loginPage);
  const token = csrfFromHtml(await loginPage.text());
  const response = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: token, email: `${role}@example.edu`, password })
  });
  assert.equal(response.status, 303);
  return cookieFrom(response);
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

test('role dashboards load their own summaries using the authenticated actor id', async () => {
  const scenarios = [
    {
      role: 'student', path: '/dashboard/student', label: /Permitted documents/,
      summary: { enrollment_count: 2, grade_entry_count: 4, document_count: 3, documents_in_progress_count: 1 }
    },
    {
      role: 'registrar', path: '/dashboard/registrar', label: /Current enrollments/,
      summary: { active_student_count: 8, archived_student_count: 1, current_enrollment_count: 6, documents_awaiting_review_count: 2, documents_processing_count: 1 }
    },
    {
      role: 'finance', path: '/finance', label: /Settled accounts/,
      summary: { account_count: 10, accounts_due_count: 4, accounts_settled_count: 5, accounts_credit_count: 1, charge_count: 12, payment_count: 8 }
    },
    {
      role: 'database_admin', path: '/admin', label: /Inactive accounts/,
      summary: { active_user_count: 10, inactive_user_count: 2, active_student_count: 8, archived_student_count: 1, documents_awaiting_review_count: 2 }
    }
  ];

  for (const scenario of scenarios) {
    const actorIds = [];
    const services = {
      adminService: {
        async listDashboard() { return { users: [], auditLogs: [], searchTerm: '' }; },
        async getDashboardSummary(actorId) { actorIds.push(actorId); return scenario.summary; }
      },
      studentRecordsService: {
        async getOwnStudentRecord() { return { student: { student_no: 'S-7' }, enrollments: [] }; },
        async getStudentDashboardSummary(actorId) { actorIds.push(actorId); return scenario.summary; },
        async getRegistrarDashboardSummary(actorId) { actorIds.push(actorId); return scenario.summary; }
      },
      academicRecordsService: { async getOwnGrades() { return []; } },
      financeService: {
        async searchStudents(searchTerm) { return { students: [], searchTerm }; },
        async getDashboardSummary(actorId) { actorIds.push(actorId); return scenario.summary; }
      }
    };
    await withServer(createApp({ databasePool: createAuthPool(scenario.role), environment, ...services }), async (baseUrl) => {
      const cookie = await signIn(baseUrl, scenario.role);
      const response = await fetch(`${baseUrl}${scenario.path}`, { headers: { cookie } });
      assert.equal(response.status, 200, scenario.role);
      const html = await response.text();
      assert.match(html, scenario.label, scenario.role);
      assert.match(html, /<dd>\d+<\/dd>/, scenario.role);
      assert.deepEqual(actorIds, [7], scenario.role);
    });
  }
});
