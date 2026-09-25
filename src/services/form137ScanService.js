const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { DocumentServiceError, normalizeId, validateUpload } = require('./documentService');
const { MAX_DOCUMENT_TEXT_BYTES } = require('./localOcrService');
const { form137AdvisoryChecks } = require('./documentValidationService');

const OCR_FAILURE_MESSAGES = new Map([
  ['OCR_TIMEOUT', 'The local OCR scan timed out. Inspect the physical paper and record its status manually.'],
  ['ETIMEDOUT', 'The local OCR scan timed out. Inspect the physical paper and record its status manually.'],
  ['ABORT_ERR', 'The local OCR scan timed out. Inspect the physical paper and record its status manually.'],
  ['OCR_BINARY_UNAVAILABLE', 'A local OCR utility is unavailable. Inspect the physical paper and record its status manually.'],
  ['ENOENT', 'A local OCR utility is unavailable. Inspect the physical paper and record its status manually.'],
  ['OCR_PAGE_LIMIT', 'The PDF exceeds the configured page limit. Inspect the physical paper and record its status manually.'],
  ['OCR_INVALID_DOCUMENT', 'The selected file could not be read. Inspect the physical paper and record its status manually.'],
  ['OCR_OUTPUT_LIMIT', 'The OCR output exceeded the supported size. Inspect the physical paper and record its status manually.']
]);

class Form137ScanError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.name = 'Form137ScanError';
    this.status = status;
  }
}

function createForm137ScanService({
  getStudentDocuments,
  localOcr,
  temporaryDirectory = os.tmpdir(),
  fileSystem = fs,
  maxUploadBytes = 10 * 1024 * 1024,
  timeoutMs = 60000,
  concurrency = 2
} = {}) {
  if (typeof getStudentDocuments !== 'function') throw new TypeError('A staff-scoped student lookup is required.');
  if (!localOcr || typeof localOcr.processDocument !== 'function') throw new TypeError('A local OCR service is required.');
  const maximumConcurrentScans = Number.isSafeInteger(concurrency) && concurrency >= 1 && concurrency <= 4 ? concurrency : 2;
  let activeScans = 0;

  async function scan(actorInput, studentInput, file) {
    try {
      return await processScan(actorInput, studentInput, file);
    } finally {
      if (Buffer.isBuffer(file?.buffer)) file.buffer.fill(0);
    }
  }

  async function processScan(actorInput, studentInput, file) {
    const studentId = normalizeId(studentInput);
    if (!studentId) throw new DocumentServiceError('Student record not found.', 404);
    const metadata = validateUpload(file, maxUploadBytes);
    if (activeScans >= maximumConcurrentScans) {
      throw new Form137ScanError('The temporary scan service is busy. Try again shortly.', 429);
    }

    activeScans += 1;
    let workDirectory;
    try {
      const workspace = await getStudentDocuments(actorInput, studentId);
      if (!workspace) throw new DocumentServiceError('Student record not found.', 404);

      try {
        workDirectory = await fileSystem.mkdtemp(path.join(temporaryDirectory, 'arktiesiis-form137-'));
        if (process.platform !== 'win32') await fileSystem.chmod?.(workDirectory, 0o700);
        const filePath = path.join(workDirectory, `physical-scan${metadata.extension}`);
        const handle = await fileSystem.open(filePath, 'wx', 0o600);
        try {
          await handle.writeFile(file.buffer);
        } finally {
          await handle.close();
        }

        let extractedText;
        try {
          const result = await localOcr.processDocument(filePath, metadata.mimeType, { timeoutMs });
          extractedText = typeof result?.text === 'string' ? result.text : null;
          if (extractedText === null || Buffer.byteLength(extractedText, 'utf8') > MAX_DOCUMENT_TEXT_BYTES) {
            throw Object.assign(new Error('Invalid local OCR result.'), { code: 'OCR_OUTPUT_LIMIT' });
          }
        } catch (error) {
          return {
            status: 'failed',
            message: OCR_FAILURE_MESSAGES.get(error?.code) || 'The local OCR utility could not process this scan. Inspect the physical paper and record its status manually.',
            suggestions: []
          };
        }

        return {
          status: extractedText.trim() ? 'completed' : 'empty',
          message: extractedText.trim()
            ? 'OCR suggestions are ready for staff inspection. They do not establish that the paper is authentic or accepted.'
            : 'No readable text was extracted. Inspect the physical paper and record its status manually.',
          suggestions: extractedText.trim() ? form137AdvisoryChecks(extractedText, workspace.student) : []
        };
      } catch (error) {
        if (error instanceof DocumentServiceError) throw error;
        throw new Form137ScanError('The temporary scan could not be prepared. Inspect the physical paper and record its status manually.');
      } finally {
        if (workDirectory) {
          try {
            await fileSystem.rm(workDirectory, { recursive: true, force: true });
          } catch {
            throw new Form137ScanError('The temporary scan could not be removed. Contact an administrator before continuing.');
          }
        }
      }
    } finally {
      activeScans -= 1;
    }
  }

  return { scan };
}

module.exports = { Form137ScanError, createForm137ScanService };
