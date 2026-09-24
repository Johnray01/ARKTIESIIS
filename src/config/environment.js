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

function parseOcrTimeout(value) {
  const rawValue = value === undefined || value === '' ? '60000' : String(value);
  if (!/^\d+$/.test(rawValue)) {
    throw new Error('OCR_TIMEOUT_MS must be an integer between 1000 and 120000.');
  }

  const timeoutMs = Number(rawValue);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    throw new Error('OCR_TIMEOUT_MS must be an integer between 1000 and 120000.');
  }
  return timeoutMs;
}

function configuredExecutable(name, fallback) {
  const value = process.env[name];
  const executable = value === undefined || value.trim() === '' ? fallback : value;
  if (executable.includes('\u0000')) throw new Error(`${name} contains an invalid character.`);
  return executable;
}

function configuredOcrLanguage(value) {
  const language = value === undefined || value.trim() === '' ? 'eng' : value;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_+-]{0,63}$/.test(language)) throw new Error('OCR_LANGUAGE is invalid.');
  return language;
}

function parseOcrConcurrency(value) {
  const rawValue = value === undefined || value === '' ? '2' : String(value);
  if (!/^[1-4]$/.test(rawValue)) throw new Error('OCR_CONCURRENCY must be an integer between 1 and 4.');
  return Number(rawValue);
}

function parseOcrMaxPdfPages(value) {
  const rawValue = value === undefined || value === '' ? '20' : String(value);
  if (!/^(?:[1-9]|1\d|20)$/.test(rawValue)) throw new Error('OCR_MAX_PDF_PAGES must be an integer between 1 and 20.');
  return Number(rawValue);
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
  ocr: {
    tesseractPath: configuredExecutable('TESSERACT_PATH', 'tesseract'),
    pdfinfoPath: configuredExecutable('PDFINFO_PATH', 'pdfinfo'),
    pdftoppmPath: configuredExecutable('PDFTOPPM_PATH', 'pdftoppm'),
    language: configuredOcrLanguage(process.env.OCR_LANGUAGE),
    timeoutMs: parseOcrTimeout(process.env.OCR_TIMEOUT_MS),
    concurrency: parseOcrConcurrency(process.env.OCR_CONCURRENCY),
    maxPdfPages: parseOcrMaxPdfPages(process.env.OCR_MAX_PDF_PAGES)
  },
  upload: {
    maxMb: parseUploadMegabytes(process.env.MAX_UPLOAD_MB),
    storageDirectory: path.resolve(__dirname, '../../', process.env.DOCUMENT_STORAGE_DIR || 'storage/uploads')
  },
  required
};
