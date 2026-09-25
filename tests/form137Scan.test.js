const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DocumentServiceError } = require('../src/services/documentService');
const { Form137ScanError, createForm137ScanService } = require('../src/services/form137ScanService');

const student = { id: 44, first_name: 'Jamie', middle_name: null, last_name: 'Garcia' };
function makePdfFile() {
  const buffer = Buffer.from('%PDF-1.7\nsource');
  return {
    originalname: 'paper.pdf',
    mimetype: 'application/pdf',
    buffer,
    size: buffer.length
  };
}

async function temporaryDirectory() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ark-form137-scan-test-'));
}

test('temporary scan validates upload metadata, runs local OCR, returns only bounded suggestions, and removes staged files', async () => {
  const directory = await temporaryDirectory();
  const calls = [];
  const service = createForm137ScanService({
    temporaryDirectory: directory,
    maxUploadBytes: 1024,
    timeoutMs: 12000,
    concurrency: 2,
    async getStudentDocuments(actorId, studentId) {
      calls.push(['student', actorId, studentId]);
      return { student };
    },
    localOcr: {
      async processDocument(filePath, mimeType, options) {
        calls.push(['ocr', mimeType, options]);
        const stat = await fs.stat(filePath);
        assert.equal(stat.mode & 0o777, 0o600);
        assert.equal((await fs.readFile(filePath)).toString(), '%PDF-1.7\nsource');
        return { text: 'JAMIE GARCIA\nPossible Academy <script>alert(1)</script>' };
      }
    }
  });

  try {
    const file = makePdfFile();
    const result = await service.scan(7, '44', file);
    assert.equal(result.status, 'completed');
    assert.deepEqual(calls[0], ['student', 7, 44]);
    assert.deepEqual(calls[1], ['ocr', 'application/pdf', { timeoutMs: 12000 }]);
    assert.deepEqual(calls.map(([operation]) => operation), ['student', 'ocr'], 'the scan service performs no document, validation, or audit writes');
    assert.deepEqual(result.suggestions.map(({ key, found }) => [key, found]), [
      ['linked_student_name', true],
      ['possible_school_name', true]
    ]);
    assert.deepEqual(result.suggestions[1].candidates, ['Possible Academy <script>alert(1)</script>']);
    assert.equal(Object.hasOwn(result, 'text'), false);
    assert.ok(file.buffer.every((byte) => byte === 0), 'the in-memory multipart buffer is cleared after processing');
    assert.deepEqual(await fs.readdir(directory), []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('scan validation rejects unsupported extension, MIME, signature, and size before OCR', async () => {
  const directory = await temporaryDirectory();
  let lookupCount = 0;
  const service = createForm137ScanService({
    temporaryDirectory: directory,
    maxUploadBytes: 32,
    async getStudentDocuments() { lookupCount += 1; return { student }; },
    localOcr: { async processDocument() { assert.fail('invalid input must not reach OCR'); } }
  });
  try {
    await assert.rejects(service.scan(7, '44', { ...makePdfFile(), originalname: 'paper.txt' }), DocumentServiceError);
    await assert.rejects(service.scan(7, '44', { ...makePdfFile(), mimetype: 'image/png' }), /extension and declared file type/);
    await assert.rejects(service.scan(7, '44', { ...makePdfFile(), buffer: Buffer.from('not pdf'), size: 7 }), /content does not match/);
    await assert.rejects(service.scan(7, '44', { ...makePdfFile(), size: 33 }), /configured upload limit/);
    await assert.rejects(service.scan(7, 'invalid', makePdfFile()), { status: 404 });
    assert.equal(lookupCount, 0);
    assert.deepEqual(await fs.readdir(directory), []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('OCR failure is returned as a transient staff result and still cleans its temporary input', async () => {
  const directory = await temporaryDirectory();
  const service = createForm137ScanService({
    temporaryDirectory: directory,
    async getStudentDocuments() { return { student }; },
    localOcr: { async processDocument() { throw Object.assign(new Error('private command output'), { code: 'OCR_TIMEOUT' }); } }
  });
  try {
    const result = await service.scan(7, 44, makePdfFile());
    assert.equal(result.status, 'failed');
    assert.match(result.message, /timed out/);
    assert.doesNotMatch(result.message, /private command output/);
    assert.deepEqual(result.suggestions, []);
    assert.deepEqual(await fs.readdir(directory), []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('OCR worker concurrency is bounded and busy scans do not enter the OCR engine', async () => {
  const directory = await temporaryDirectory();
  let releaseFirst;
  let started = 0;
  const firstOcr = new Promise((resolve) => { releaseFirst = resolve; });
  const service = createForm137ScanService({
    temporaryDirectory: directory,
    concurrency: 1,
    async getStudentDocuments() { return { student }; },
    localOcr: {
      async processDocument() {
        started += 1;
        if (started === 1) await firstOcr;
        return { text: 'Jamie Garcia' };
      }
    }
  });
  try {
    const pending = service.scan(7, 44, makePdfFile());
    while (started === 0) await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(service.scan(7, 44, makePdfFile()), { status: 429 });
    assert.equal(started, 1);
    releaseFirst();
    assert.equal((await pending).status, 'completed');
    assert.deepEqual(await fs.readdir(directory), []);
  } finally {
    releaseFirst();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('failed temporary cleanup fails closed with a safe message', async () => {
  const directory = await temporaryDirectory();
  const fileSystem = {
    ...fs,
    async rm() { throw new Error('private path'); }
  };
  const service = createForm137ScanService({
    temporaryDirectory: directory,
    fileSystem,
    async getStudentDocuments() { return { student }; },
    localOcr: { async processDocument() { throw Object.assign(new Error('native output'), { code: 'OCR_TIMEOUT' }); } }
  });
  try {
    await assert.rejects(service.scan(7, 44, makePdfFile()), (error) => {
      assert.ok(error instanceof Form137ScanError);
      assert.match(error.message, /temporary scan could not be removed/);
      assert.doesNotMatch(error.message, /private path/);
      return true;
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
