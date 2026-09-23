const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const { createApp } = require('../src/app');
const { validateRequiredText } = require('../src/services/documentValidationService');

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
  await withServer(createApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/login`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /<h1>Login<\/h1>/);
  });
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
