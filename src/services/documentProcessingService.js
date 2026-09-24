const path = require('node:path');
const fs = require('node:fs/promises');
const { getPool: defaultGetPool, sql: defaultSql } = require('../config/database');
const defaultEnvironment = require('../config/environment');
const documentAIService = require('./documentAIService');

const MIME_BY_EXTENSION = new Map([
  ['.pdf', 'application/pdf'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png']
]);
const STORED_NAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$/i;
const TIMEOUT_ERROR_CODE = 'DOCUMENT_AI_TIMEOUT';
const PROCESSING_RECOVERY_GRACE_MS = 30000;
const PROCESSING_RECOVERY_INTERVAL_MS = 30000;
const PROCESSING_RECOVERY_BATCH_SIZE = 100;
const PROCESSING_RECOVERY_MESSAGE = 'OCR processing did not finish within the recovery window. Staff review is required.';

class DocumentProcessingError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.name = 'DocumentProcessingError';
    this.status = status;
  }
}

function normalizeOcrDocument(document) {
  if (!document || typeof document !== 'object' || typeof document.text !== 'string') {
    return { outcome: 'malformed_response', extractedText: null };
  }
  const extractedText = document.text.replaceAll('\u0000', '').replace(/\r\n?/g, '\n').trim();
  if (!extractedText) return { outcome: 'empty_ocr', extractedText: '' };
  return { outcome: 'extracted', extractedText };
}

function withTimeout(promise, timeoutMs) {
  let timeout;
  const timeoutPromise = new Promise((resolve, reject) => {
    timeout = setTimeout(() => {
      const error = new Error('Document AI request timed out.');
      error.code = TIMEOUT_ERROR_CODE;
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

function createDocumentProcessingService({
  getPool = defaultGetPool,
  sql = defaultSql,
  transactionFactory = (pool) => new sql.Transaction(pool),
  documentAI = documentAIService,
  documentAIConfig = defaultEnvironment.documentAI,
  storageDirectory = defaultEnvironment.upload.storageDirectory,
  timeoutMs = defaultEnvironment.documentAI.timeoutMs,
  recoveryGraceMs = PROCESSING_RECOVERY_GRACE_MS,
  recoveryBatchSize = PROCESSING_RECOVERY_BATCH_SIZE,
  fileSystem = fs
} = {}) {
  const storageRoot = path.resolve(storageDirectory);
  const publicRoot = path.resolve(__dirname, '../../public');
  if (storageRoot === publicRoot || storageRoot.startsWith(`${publicRoot}${path.sep}`)) {
    throw new Error('DOCUMENT_STORAGE_DIR must be outside the public web directory.');
  }
  const requestTimeoutMs = Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 120000
    ? timeoutMs
    : 30000;
  const staleAfterMs = requestTimeoutMs + (Number.isSafeInteger(recoveryGraceMs) && recoveryGraceMs >= 1000 && recoveryGraceMs <= 300000
    ? recoveryGraceMs
    : PROCESSING_RECOVERY_GRACE_MS);
  const recoveryLimit = Number.isSafeInteger(recoveryBatchSize) && recoveryBatchSize >= 1 && recoveryBatchSize <= 1000
    ? recoveryBatchSize
    : PROCESSING_RECOVERY_BATCH_SIZE;

  async function runTransaction(callback) {
    const pool = await getPool();
    const transaction = transactionFactory(pool);
    let started = false;
    try {
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      started = true;
      const result = await callback(transaction);
      await transaction.commit();
      started = false;
      return result;
    } catch (error) {
      if (started) {
        try {
          await transaction.rollback();
        } catch {
          // Preserve the original failure without exposing database details.
        }
      }
      throw error;
    }
  }

  async function startProcessing(documentId) {
    return runTransaction(async (transaction) => {
      const result = await transaction.request()
        .input('documentId', sql.Int, documentId)
        .query(`UPDATE dbo.documents
          SET status = 'processing', processing_started_at = SYSUTCDATETIME()
          OUTPUT INSERTED.id AS id, INSERTED.stored_filename AS stored_filename,
            INSERTED.mime_type AS mime_type, INSERTED.document_type AS document_type
          WHERE id = @documentId AND status = 'pending'`);
      return result.recordset?.[0] || null;
    });
  }

  async function ensurePrivateStorageRoot() {
    const realStorageRoot = await fileSystem.realpath(storageRoot);
    const realPublicRoot = await fileSystem.realpath(publicRoot);
    if (realStorageRoot === realPublicRoot || realStorageRoot.startsWith(`${realPublicRoot}${path.sep}`)) {
      throw new DocumentProcessingError('Document storage is not configured as a private location.');
    }
  }

  function resolveStoredPath(storedFilename, mimeType) {
    if (typeof storedFilename !== 'string' || !STORED_NAME_PATTERN.test(storedFilename)) {
      throw new DocumentProcessingError('The stored document is unavailable.', 404);
    }
    const extension = path.extname(storedFilename).toLowerCase();
    if (MIME_BY_EXTENSION.get(extension) !== mimeType) {
      throw new DocumentProcessingError('The stored document is unavailable.', 404);
    }
    const resolved = path.resolve(storageRoot, storedFilename);
    const relative = path.relative(storageRoot, resolved);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new DocumentProcessingError('The stored document is unavailable.', 404);
    }
    return resolved;
  }

  function failureOutcome(code, message) {
    return {
      documentStatus: 'failed',
      resultStatus: 'failed',
      extractedText: null,
      code,
      message
    };
  }

  function normalizeOutcome(document) {
    const normalized = normalizeOcrDocument(document);
    if (normalized.outcome === 'malformed_response') {
      return failureOutcome('malformed_response', 'The OCR service returned an unreadable result. Staff review is required.');
    }
    if (normalized.outcome === 'empty_ocr') {
      return {
        documentStatus: 'needs_review',
        resultStatus: 'needs_review',
        extractedText: '',
        code: 'empty_ocr',
        message: 'No readable text was extracted. Staff review is required.'
      };
    }
    return {
      documentStatus: 'needs_review',
      resultStatus: 'needs_review',
      extractedText: normalized.extractedText,
      code: 'extracted',
      message: 'OCR text was extracted. Required-field and format checks are not configured; staff review is required.'
    };
  }

  async function saveOutcome(documentId, outcome) {
    return runTransaction(async (transaction) => {
      const updateResult = await transaction.request()
        .input('documentId', sql.Int, documentId)
        .input('documentStatus', sql.NVarChar(30), outcome.documentStatus)
        .query(`UPDATE dbo.documents
          SET status = @documentStatus, processing_started_at = NULL
          OUTPUT INSERTED.id AS id
          WHERE id = @documentId AND status = 'processing'`);
      if (!updateResult.recordset?.length) return false;

      const validationJson = JSON.stringify({
        stage: 'ocr',
        outcome: outcome.code,
        message: outcome.message
      });
      await transaction.request()
        .input('documentId', sql.Int, documentId)
        .input('processor', sql.NVarChar(100), 'Google Document AI')
        .input('extractedText', sql.NVarChar(sql.MAX), outcome.extractedText)
        .input('validationJson', sql.NVarChar(sql.MAX), validationJson)
        .input('resultStatus', sql.NVarChar(30), outcome.resultStatus)
        .query(`INSERT INTO dbo.document_validations
          (document_id, processor, extracted_text, validation_json,
            completeness_passed, format_passed, result_status)
          VALUES (@documentId, @processor, @extractedText, @validationJson, NULL, NULL, @resultStatus)`);
      return true;
    });
  }

  async function recoverStaleProcessing() {
    return runTransaction(async (transaction) => {
      const result = await transaction.request()
        .input('staleAfterMs', sql.Int, staleAfterMs)
        .input('batchSize', sql.Int, recoveryLimit)
        .input('processor', sql.NVarChar(100), 'Google Document AI')
        .input('validationJson', sql.NVarChar(sql.MAX), JSON.stringify({
          stage: 'ocr',
          outcome: 'processing_recovered',
          message: PROCESSING_RECOVERY_MESSAGE
        }))
        .query(`DECLARE @recovered TABLE (id INT NOT NULL PRIMARY KEY);
          ;WITH stale_documents AS (
            SELECT TOP (@batchSize) id
            FROM dbo.documents WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
            WHERE status = 'processing'
              AND (processing_started_at IS NULL
                OR processing_started_at < DATEADD(MILLISECOND, -@staleAfterMs, SYSUTCDATETIME()))
            ORDER BY CASE WHEN processing_started_at IS NULL THEN 0 ELSE 1 END,
              processing_started_at, id
          )
          UPDATE d
          SET status = 'failed', processing_started_at = NULL
          OUTPUT INSERTED.id INTO @recovered (id)
          FROM dbo.documents AS d
          INNER JOIN stale_documents AS stale ON stale.id = d.id;

          INSERT INTO dbo.document_validations
            (document_id, processor, extracted_text, validation_json,
              completeness_passed, format_passed, result_status)
          SELECT id, @processor, NULL, @validationJson, NULL, NULL, 'failed'
          FROM @recovered;

          SELECT COUNT(*) AS recovered_count FROM @recovered;`);
      const count = Number(result.recordset?.[0]?.recovered_count);
      return Number.isSafeInteger(count) && count > 0 ? count : 0;
    });
  }

  async function processPendingDocument(documentInput) {
    const documentId = Number(documentInput);
    if (!Number.isSafeInteger(documentId) || documentId < 1 || documentId > 2147483647) {
      throw new DocumentProcessingError('Document processing is unavailable.', 404);
    }

    const document = await startProcessing(documentId);
    if (!document) return { documentId, status: 'not_pending' };

    let outcome;
    if (!documentAIConfig?.projectId || !documentAIConfig?.processorId) {
      outcome = failureOutcome('processor_not_configured', 'Document processing is not configured. Staff review is required.');
    } else {
      try {
        await ensurePrivateStorageRoot();
        const filePath = resolveStoredPath(document.stored_filename, document.mime_type);
        const documentResult = await withTimeout(
          documentAI.processDocument(filePath, document.mime_type, { timeoutMs: requestTimeoutMs }),
          requestTimeoutMs
        );
        outcome = normalizeOutcome(documentResult);
      } catch (error) {
        if (error?.code === TIMEOUT_ERROR_CODE) {
          outcome = failureOutcome('processor_timeout', 'OCR processing timed out. Staff review is required.');
        } else if (error instanceof DocumentProcessingError && error.status === 404) {
          outcome = failureOutcome('stored_file_unavailable', 'The stored file could not be read. Staff review is required.');
        } else {
          outcome = failureOutcome('processor_error', 'The OCR service could not process this file. Staff review is required.');
        }
      }
    }

    let saved;
    try {
      saved = await saveOutcome(documentId, outcome);
    } catch {
      throw new DocumentProcessingError('The upload was saved, but its processing result could not be recorded. Contact a registrar.');
    }
    if (!saved) {
      throw new DocumentProcessingError('The processing result could not be recorded because the submission state changed. Contact a registrar.');
    }
    return { documentId, status: outcome.documentStatus, resultStatus: outcome.resultStatus, code: outcome.code };
  }

  return { processPendingDocument, recoverStaleProcessing };
}

function startProcessingRecoveryScheduler(processingService, {
  intervalMs = PROCESSING_RECOVERY_INTERVAL_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  logger = console
} = {}) {
  const scanIntervalMs = Number.isSafeInteger(intervalMs) && intervalMs >= 1000 && intervalMs <= 300000
    ? intervalMs
    : PROCESSING_RECOVERY_INTERVAL_MS;
  let activeRun = null;

  function run() {
    if (activeRun) return activeRun;
    activeRun = Promise.resolve()
      .then(() => processingService.recoverStaleProcessing())
      .catch(() => {
        logger.error('Stale document processing recovery failed.');
        return null;
      })
      .finally(() => { activeRun = null; });
    return activeRun;
  }

  const timer = setIntervalFn(() => { void run(); }, scanIntervalMs);
  timer.unref?.();
  void run();
  return {
    run,
    stop() { clearIntervalFn(timer); }
  };
}

module.exports = {
  DocumentProcessingError,
  PROCESSING_RECOVERY_GRACE_MS,
  PROCESSING_RECOVERY_INTERVAL_MS,
  PROCESSING_RECOVERY_MESSAGE,
  startProcessingRecoveryScheduler,
  createDocumentProcessingService,
  normalizeOcrDocument,
  withTimeout
};
