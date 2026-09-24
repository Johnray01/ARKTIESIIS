const path = require('node:path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const nodeEnv = process.env.NODE_ENV || 'development';

function parsePort(name, value, defaultValue) {
  const rawValue = value === undefined || value === '' ? String(defaultValue) : String(value);
  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${name} must be a valid TCP port number.`);
  }

  const port = Number(rawValue);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a valid TCP port number.`);
  }

  return port;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseUploadMegabytes(value) {
  const rawValue = value === undefined || value === '' ? '10' : String(value);
  const megabytes = Number(rawValue);
  const bytes = Math.floor(megabytes * 1024 * 1024);
  if (!Number.isFinite(megabytes) || megabytes <= 0 || !Number.isSafeInteger(bytes) || bytes < 1) {
    throw new Error('MAX_UPLOAD_MB must be a positive number that fits within the supported upload size.');
  }
  return megabytes;
}

function parseDocumentAITimeout(value) {
  const rawValue = value === undefined || value === '' ? '30000' : String(value);
  if (!/^\d+$/.test(rawValue)) {
    throw new Error('DOCUMENT_AI_TIMEOUT_MS must be an integer between 1000 and 120000.');
  }

  const timeoutMs = Number(rawValue);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    throw new Error('DOCUMENT_AI_TIMEOUT_MS must be an integer between 1000 and 120000.');
  }
  return timeoutMs;
}

const configuredSessionSecret = process.env.SESSION_SECRET;
const normalizedSessionSecret = configuredSessionSecret?.trim();
if (nodeEnv === 'production') {
  if (!normalizedSessionSecret || normalizedSessionSecret.length < 32 || normalizedSessionSecret === 'replace-with-a-long-random-secret') {
    throw new Error('SESSION_SECRET must be set to a random value with at least 32 characters in production.');
  }
}

module.exports = {
  nodeEnv,
  devPasswordOnlyLogin: process.env.DEV_PASSWORD_ONLY_LOGIN === 'true',
  port: parsePort('PORT', process.env.PORT, 3000),
  sessionSecret: normalizedSessionSecret || 'dev-only-change-me',
  database: {
    server: process.env.DB_SERVER || 'localhost',
    port: parsePort('DB_PORT', process.env.DB_PORT, 1433),
    database: process.env.DB_NAME || 'ARKTIESIIS',
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    encrypt: String(process.env.DB_ENCRYPT || 'false') === 'true',
    trustServerCertificate: String(process.env.DB_TRUST_SERVER_CERTIFICATE || 'true') === 'true'
  },
  smtp: {
    host: process.env.SMTP_HOST,
    port: parsePort('SMTP_PORT', process.env.SMTP_PORT, 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || 'ARKTIESIIS <no-reply@example.com>'
  },
  documentAI: {
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    location: process.env.GOOGLE_CLOUD_LOCATION || 'us',
    processorId: process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID,
    timeoutMs: parseDocumentAITimeout(process.env.DOCUMENT_AI_TIMEOUT_MS)
  },
  upload: {
    maxMb: parseUploadMegabytes(process.env.MAX_UPLOAD_MB),
    storageDirectory: path.resolve(__dirname, '../../', process.env.DOCUMENT_STORAGE_DIR || 'storage/uploads')
  },
  required
};
