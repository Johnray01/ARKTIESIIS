const crypto = require('node:crypto');
const { getPool: defaultGetPool, sql: defaultSql } = require('../config/database');
const defaultEnvironment = require('../config/environment');

function isDevelopmentPasswordLoginEnabled(environment = defaultEnvironment) {
  return environment.nodeEnv === 'development' && environment.devPasswordOnlyLogin === true;
}

function createCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = createCsrfToken();
  return req.session.csrfToken;
}

function hasValidCsrfToken(req) {
  const expected = req.session?.csrfToken;
  const supplied = req.body?._csrf;
  if (typeof expected !== 'string' || typeof supplied !== 'string') return false;

  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length
    && crypto.timingSafeEqual(expectedBytes, suppliedBytes);
}

function createAuthFingerprint(user, environment = defaultEnvironment) {
  if (!user || typeof user.role !== 'string' || typeof user.password_hash !== 'string' || !user.password_hash) return null;
  const updatedAt = typeof user.updated_at_fingerprint === 'string' ? user.updated_at_fingerprint : '';
  return crypto.createHmac('sha256', environment.sessionSecret)
    .update(`${user.role}\u0000${user.password_hash}\u0000${updatedAt}`)
    .digest('hex');
}

function hasMatchingAuthFingerprint(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && crypto.timingSafeEqual(expectedBytes, actualBytes);
}

function clearSessionCookie(res, environment = defaultEnvironment) {
  res.clearCookie('connect.sid', {
    httpOnly: true,
    sameSite: 'lax',
    secure: environment.nodeEnv === 'production',
    path: '/'
  });
}

function destroySession(req, res, environment, callback) {
  req.session.destroy((error) => {
    clearSessionCookie(res, environment);
    callback(error);
  });
}

function createRequireAuth({ getPool = defaultGetPool, sql = defaultSql, environment = defaultEnvironment } = {}) {
  return async function requireAuth(req, res, next) {
    const userId = req.session?.userId;
    if (!Number.isSafeInteger(userId) || userId < 1) return res.redirect('/login');

    const developmentLogin = req.session.authLevel === 'password_only_dev';
    const emailTwoFactorLogin = req.session.authLevel === 'email_2fa';
    if (developmentLogin && !isDevelopmentPasswordLoginEnabled(environment)) {
      return destroySession(req, res, environment, () => res.redirect('/login'));
    }
    if (!developmentLogin && !emailTwoFactorLogin) return res.redirect('/login');

    try {
      const pool = await getPool();
      const result = await pool.request()
        .input('userId', sql.Int, userId)
        .query('SELECT id, email, role, is_active, password_hash, CONVERT(NVARCHAR(33), updated_at, 126) AS updated_at_fingerprint FROM dbo.users WHERE id = @userId');
      const user = result.recordset?.[0];

      if (!user || !(user.is_active === true || user.is_active === 1)) {
        return destroySession(req, res, environment, () => res.redirect('/login'));
      }

      const expectedFingerprint = createAuthFingerprint(user, environment);
      if (!hasMatchingAuthFingerprint(expectedFingerprint, req.session.authFingerprint)) {
        return destroySession(req, res, environment, () => res.redirect('/login'));
      }

      req.authUser = { id: user.id, email: user.email, role: user.role };
      return next();
    } catch {
      return res.status(503).render('error', {
        title: 'Service Unavailable',
        message: 'Authentication is temporarily unavailable.'
      });
    }
  };
}

module.exports = {
  ensureCsrfToken,
  hasValidCsrfToken,
  createAuthFingerprint,
  hasMatchingAuthFingerprint,
  isDevelopmentPasswordLoginEnabled,
  createRequireAuth,
  destroySession,
  clearSessionCookie
};
