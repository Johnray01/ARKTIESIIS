const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { constants: fsConstants } = require('node:fs');
const { execFile } = require('node:child_process');
const defaultEnvironment = require('../config/environment');

const SUPPORTED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_PDF_PAGES = 20;
const MAX_IMAGE_DIMENSION = 1800;
const MAX_PAGE_TEXT_BYTES = 1024 * 1024;
const MAX_DOCUMENT_TEXT_BYTES = 4 * 1024 * 1024;

function createOcrError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createLocalOcrService({
  ocrConfig = defaultEnvironment.ocr,
  uploadConfig = defaultEnvironment.upload,
  fileSystem = fs,
  fileSystemConstants = fsConstants,
  temporaryDirectory = os.tmpdir(),
  execFileImpl = execFile
} = {}) {
  const timeoutMs = Number.isSafeInteger(ocrConfig?.timeoutMs) && ocrConfig.timeoutMs >= 1000 && ocrConfig.timeoutMs <= 120000
    ? ocrConfig.timeoutMs
    : 60000;
  const maxFileBytes = Math.floor(Number(uploadConfig?.maxMb || 10) * 1024 * 1024);
  const language = typeof ocrConfig?.language === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_+-]{0,63}$/.test(ocrConfig.language)
    ? ocrConfig.language
    : 'eng';
  const maxPdfPages = Number.isSafeInteger(ocrConfig?.maxPdfPages) && ocrConfig.maxPdfPages >= 1 && ocrConfig.maxPdfPages <= MAX_PDF_PAGES
    ? ocrConfig.maxPdfPages
    : MAX_PDF_PAGES;
  const executables = {
    tesseract: ocrConfig?.tesseractPath || 'tesseract',
    pdfinfo: ocrConfig?.pdfinfoPath || 'pdfinfo',
    pdftoppm: ocrConfig?.pdftoppmPath || 'pdftoppm'
  };

  function runCommand(executable, args, { signal, remainingMs, maxBuffer }) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(createOcrError('OCR_TIMEOUT', 'OCR processing timed out.'));
        return;
      }
      execFileImpl(executable, args, {
        shell: false,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer,
        timeout: remainingMs,
        killSignal: 'SIGKILL',
        ...(signal ? { signal } : {})
      }, (error, stdout) => {
        if (signal?.aborted || error?.code === 'ETIMEDOUT' || error?.code === 'ABORT_ERR') {
          reject(createOcrError('OCR_TIMEOUT', 'OCR processing timed out.'));
          return;
        }
        if (error?.code === 'ENOENT') {
          reject(createOcrError('OCR_BINARY_UNAVAILABLE', 'A local OCR utility is unavailable.'));
          return;
        }
        if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          reject(createOcrError('OCR_OUTPUT_LIMIT', 'OCR output exceeded the supported size.'));
          return;
        }
        if (error?.killed && error?.signal === 'SIGKILL') {
          reject(createOcrError('OCR_TIMEOUT', 'OCR processing timed out.'));
          return;
        }
        if (error) {
          reject(error);
          return;
        }
        resolve(typeof stdout === 'string' ? stdout : String(stdout || ''));
      });
    });
  }

  async function makePrivateCopy(filePath, mimeType, workDirectory) {
    const noFollow = fileSystemConstants.O_NOFOLLOW || 0;
    let sourceHandle;
    try {
      sourceHandle = await fileSystem.open(filePath, fileSystemConstants.O_RDONLY | noFollow);
      const stat = await sourceHandle.stat();
      if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 1 || stat.size > maxFileBytes) {
        throw createOcrError('OCR_INVALID_DOCUMENT', 'The stored document is unavailable.');
      }
      const content = await sourceHandle.readFile();
      if (content.length < 1 || content.length > maxFileBytes) {
        throw createOcrError('OCR_INVALID_DOCUMENT', 'The stored document is unavailable.');
      }
      if (mimeType === 'application/pdf' && content.subarray(0, 5).toString('ascii') !== '%PDF-') {
        throw createOcrError('OCR_INVALID_DOCUMENT', 'The stored PDF is invalid.');
      }
      const sourceName = mimeType === 'application/pdf' ? 'source.pdf' : 'source-image';
      const privatePath = path.join(workDirectory, sourceName);
      await fileSystem.writeFile(privatePath, content, { flag: 'wx', mode: 0o600 });
      return privatePath;
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ELOOP' || error?.code === 'EACCES') {
        throw createOcrError('OCR_FILE_UNAVAILABLE', 'The stored document is unavailable.');
      }
      throw error;
    } finally {
      await sourceHandle?.close();
    }
  }

  function getRemainingMs(deadline) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw createOcrError('OCR_TIMEOUT', 'OCR processing timed out.');
    return remainingMs;
  }

  async function extractPdfText(pdfPath, workDirectory, { signal, deadline }) {
    let info;
    try {
      info = await runCommand(executables.pdfinfo, [pdfPath], {
        signal,
        remainingMs: getRemainingMs(deadline),
        maxBuffer: 64 * 1024
      });
    } catch (error) {
      if (error?.code === 'OCR_TIMEOUT' || error?.code === 'OCR_BINARY_UNAVAILABLE' || error?.code === 'OCR_OUTPUT_LIMIT') throw error;
      throw createOcrError('OCR_INVALID_DOCUMENT', 'The PDF is malformed or password protected.');
    }

    if (/^Encrypted:\s+yes(?:\s|$)/im.test(info)) {
      throw createOcrError('OCR_INVALID_DOCUMENT', 'The PDF is password protected.');
    }
    const pageMatch = info.match(/^Pages:\s+(\d+)\s*$/im);
    const pageCount = pageMatch ? Number(pageMatch[1]) : NaN;
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
      throw createOcrError('OCR_INVALID_DOCUMENT', 'The PDF is malformed or has no readable pages.');
    }
    if (pageCount > maxPdfPages) {
      throw createOcrError('OCR_PAGE_LIMIT', 'PDF exceeds the configured processing page limit.');
    }

    const pages = [];
    let totalTextBytes = 0;
    for (let page = 1; page <= pageCount; page += 1) {
      const outputPrefix = path.join(workDirectory, `page-${String(page).padStart(2, '0')}`);
      const pagePath = `${outputPrefix}.png`;
      try {
        try {
          await runCommand(executables.pdftoppm, [
            '-f', String(page), '-l', String(page), '-singlefile', '-scale-to', String(MAX_IMAGE_DIMENSION),
            '-png', pdfPath, outputPrefix
          ], {
            signal,
            remainingMs: getRemainingMs(deadline),
            maxBuffer: 64 * 1024
          });
        } catch (error) {
          if (error?.code === 'OCR_TIMEOUT' || error?.code === 'OCR_BINARY_UNAVAILABLE' || error?.code === 'OCR_OUTPUT_LIMIT') throw error;
          throw createOcrError('OCR_INVALID_DOCUMENT', 'A PDF page could not be rendered.');
        }

        let pageText;
        try {
          pageText = await runCommand(executables.tesseract, [pagePath, 'stdout', '-l', language], {
            signal,
            remainingMs: getRemainingMs(deadline),
            maxBuffer: MAX_PAGE_TEXT_BYTES
          });
        } catch (error) {
          if (error?.code === 'OCR_TIMEOUT' || error?.code === 'OCR_BINARY_UNAVAILABLE' || error?.code === 'OCR_OUTPUT_LIMIT') throw error;
          throw createOcrError('OCR_PROCESSING_FAILED', 'A PDF page could not be read.');
        }
        totalTextBytes += Buffer.byteLength(pageText, 'utf8');
        if (totalTextBytes > MAX_DOCUMENT_TEXT_BYTES) {
          throw createOcrError('OCR_OUTPUT_LIMIT', 'OCR output exceeded the supported size.');
        }
        pages.push(pageText);
      } finally {
        await fileSystem.rm(pagePath, { force: true });
      }
    }
    return pages.join('\n');
  }

  async function processDocument(filePath, mimeType, { signal, timeoutMs: requestedTimeoutMs } = {}) {
    if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
      throw createOcrError('OCR_INVALID_DOCUMENT', 'Local OCR supports PDF, JPEG, and PNG files.');
    }
    const processingTimeoutMs = Number.isSafeInteger(requestedTimeoutMs) && requestedTimeoutMs >= 1000 && requestedTimeoutMs <= 120000
      ? Math.min(requestedTimeoutMs, timeoutMs)
      : timeoutMs;
    const deadline = Date.now() + processingTimeoutMs;
    const workDirectory = await fileSystem.mkdtemp(path.join(temporaryDirectory, 'arktiesiis-ocr-'));
    try {
      if (process.platform !== 'win32') await fileSystem.chmod?.(workDirectory, 0o700);
      const privatePath = await makePrivateCopy(filePath, mimeType, workDirectory);
      let text;
      if (mimeType === 'application/pdf') {
        text = await extractPdfText(privatePath, workDirectory, { signal, deadline });
      } else {
        text = await runCommand(executables.tesseract, [privatePath, 'stdout', '-l', language], {
          signal,
          remainingMs: getRemainingMs(deadline),
          maxBuffer: MAX_DOCUMENT_TEXT_BYTES
        });
      }
      if (Buffer.byteLength(text, 'utf8') > MAX_DOCUMENT_TEXT_BYTES) {
        throw createOcrError('OCR_OUTPUT_LIMIT', 'OCR output exceeded the supported size.');
      }
      return { text };
    } finally {
      await fileSystem.rm(workDirectory, { recursive: true, force: true });
    }
  }

  return { processDocument };
}

const defaultService = createLocalOcrService();

module.exports = {
  MAX_DOCUMENT_TEXT_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_PAGE_TEXT_BYTES,
  MAX_PDF_PAGES,
  createLocalOcrService,
  ...defaultService
};
