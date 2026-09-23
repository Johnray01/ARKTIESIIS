const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { getPool: defaultGetPool, sql: defaultSql } = require('../config/database');
const defaultEnvironment = require('../config/environment');
const {
  ensureCsrfToken,
  hasValidCsrfToken,
  isDevelopmentPasswordLoginEnabled,
  createRequireAuth,
  destroySession
} = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const credentialError = 'Invalid email or password.';
// Fixed cost-12 hash for timing equalization; no account uses its discarded random source value.
const DUMMY_PASSWORD_HASH = '$2b$12$2GN3Hm/rogpWV12Ve9rA..0pPmX1b0nzDXo16QFiqYwSNc/bRiMb2';
const dashboardViews = {
  database_admin: { path: '/dashboard/database-admin', view: 'dashboards/database-admin', title: 'Database Admin Dashboard' },
  registrar: { path: '/dashboard/registrar', view: 'dashboards/registrar', title: 'Registrar Dashboard' },
  finance: { path: '/dashboard/finance', view: 'dashboards/finance', title: 'Finance Dashboard' },
  student: { path: '/dashboard/student', view: 'dashboards/student', title: 'Student Dashboard' }
};

function normalizeCredentials(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (!password || Buffer.byteLength(password, 'utf8') > 72) return null;
  return { email, password };
}

async function verifyPassword(user, password, comparePassword = bcrypt.compare) {
  const active = user && (user.is_active === true || user.is_active === 1);
  const candidateHash = active ? user.password_hash : DUMMY_PASSWORD_HASH;
  const passwordMatches = await comparePassword(password, candidateHash);
  return Boolean(active && passwordMatches);
}

function createRouter({ getPool = defaultGetPool, sql = defaultSql, environment = defaultEnvironment } = {}) {
  const router = express.Router();
  const requireAuth = createRequireAuth({ getPool, sql, environment });
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => res.status(429).render('error', {
      title: 'Too Many Attempts',
      message: 'Too many login attempts. Try again later.'
    })
  });

  router.get('/', (req, res) => {
    res.render('home', { title: 'ARKTIESIIS' });
  });

  router.get('/health', async (req, res) => {
    try {
      const pool = await getPool();
      await pool.request().query('SELECT 1 AS ok');
      res.json({ ok: true, database: 'connected' });
    } catch {
      res.status(503).json({ ok: false, database: 'disconnected' });
    }
  });

  router.get('/login', (req, res) => {
    if (!isDevelopmentPasswordLoginEnabled(environment)) {
      return res.status(503).render('error', {
        title: 'Login Unavailable',
        message: 'Password-only login is unavailable in this environment.'
      });
    }
    res.render('auth/login', { title: 'Login', csrfToken: ensureCsrfToken(req), error: null });
  });

  router.post('/login', loginLimiter, async (req, res) => {
    if (!hasValidCsrfToken(req)) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'The form session expired. Reload the page and try again.' });
    }

    if (!isDevelopmentPasswordLoginEnabled(environment)) {
      return res.status(403).render('error', { title: 'Login Unavailable', message: 'Password-only login is available only in the configured development environment.' });
    }

    const credentials = normalizeCredentials(req.body);
    if (!credentials) {
      return res.status(401).render('auth/login', { title: 'Login', csrfToken: ensureCsrfToken(req), error: credentialError });
    }

    try {
      const pool = await getPool();
      const result = await pool.request()
        .input('email', sql.NVarChar(255), credentials.email)
        .query('SELECT id, email, password_hash, role, is_active FROM dbo.users WHERE email = @email');
      const user = result.recordset?.[0];
      const passwordMatches = await verifyPassword(user, credentials.password);

      if (!passwordMatches) {
        return res.status(401).render('auth/login', { title: 'Login', csrfToken: ensureCsrfToken(req), error: credentialError });
      }

      req.session.regenerate((regenerateError) => {
        if (regenerateError) {
          return res.status(500).render('error', { title: 'Error', message: 'Authentication could not be completed.' });
        }

        req.session.userId = user.id;
        req.session.authLevel = 'password_only_dev';
        req.session.save((saveError) => {
          if (saveError) {
            return res.status(500).render('error', { title: 'Error', message: 'Authentication could not be completed.' });
          }
          return res.redirect(303, '/dashboard');
        });
      });
    } catch {
      return res.status(503).render('error', { title: 'Service Unavailable', message: 'Authentication is temporarily unavailable.' });
    }
  });

  router.post('/logout', (req, res) => {
    if (!hasValidCsrfToken(req)) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'The form session expired. Reload the page and try again.' });
    }

    destroySession(req, res, environment, (error) => {
      if (error) {
        return res.status(500).render('error', { title: 'Error', message: 'Logout could not be completed.' });
      }
      return res.redirect(303, '/login');
    });
  });

  router.get('/dashboard', requireAuth, (req, res) => {
    const dashboard = dashboardViews[req.authUser.role];
    if (!dashboard) return res.status(403).send('Forbidden');
    return res.redirect(303, dashboard.path);
  });

  for (const [role, dashboard] of Object.entries(dashboardViews)) {
    router.get(dashboard.path, requireAuth, requireRole(role), (req, res) => {
      res.render(dashboard.view, {
        title: dashboard.title,
        csrfToken: ensureCsrfToken(req)
      });
    });
  }

  return router;
}

module.exports = { createRouter, normalizeCredentials, verifyPassword };
