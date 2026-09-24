const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalOcrService, MAX_PDF_PAGES } = require('../src/services/localOcrService');

async function temporaryDirectory(label = 'local-ocr-test-') {
  return fs.mkdtemp(path.join(os.tmpdir(), label));
}

function serviceFor({ directory, execFileImpl, ocrConfig = {} }) {
  return createLocalOcrService({
    temporaryDirectory: directory,
    uploadConfig: { maxMb: 10 },
    ocrConfig: {
      tesseractPath: 'tesseract',
      pdfinfoPath: 'pdfinfo',
      pdftoppmPath: 'pdftoppm',
      language: 'eng',
      timeoutMs: 5000,
      ...ocrConfig
    },
    execFileImpl
  });
}

function completeCommand(callback, stdout = '', error = null) {
  queueMicrotask(() => callback(error, stdout, error ? 'safe test stderr' : ''));
}

test('PDF OCR renders each page in order and passes Windows executable paths with spaces as single execFile arguments', async () => {
  const directory = await temporaryDirectory('ocr paths with spaces ');
  const sourcePath = path.join(directory, 'student scan.pdf');
  const commands = [];
  let privateWorkDirectory;
  await fs.writeFile(sourcePath, Buffer.from('%PDF-1.7 test fixture'));
  const service = serviceFor({
    directory,
    ocrConfig: {
      tesseractPath: 'C:\\Program Files\\Tesseract OCR\\tesseract.exe',
      pdfinfoPath: 'C:\\Program Files\\Poppler\\pdfinfo.exe',
      pdftoppmPath: 'C:\\Program Files\\Poppler\\pdftoppm.exe'
    },
    async execFileImpl(executable, args, options, callback) {
      commands.push({ executable, args, options });
      if (executable.endsWith('pdfinfo.exe')) {
        privateWorkDirectory = path.dirname(args[0]);
        return completeCommand(callback, 'Pages: 2\nEncrypted: no\n');
      }
      if (executable.endsWith('pdftoppm.exe')) {
        if (args[1] === '2') {
          await assert.rejects(fs.access(path.join(path.dirname(args.at(-1)), 'page-01.png')));
        }
        await fs.writeFile(`${args.at(-1)}.png`, Buffer.from('rendered image'));
        return completeCommand(callback);
      }
      return completeCommand(callback, path.basename(args[0]).includes('01') ? 'First page\n' : 'Second page\n');
    }
  });

  try {
    const result = await service.processDocument(sourcePath, 'application/pdf', { signal: new AbortController().signal });
    assert.equal(result.text, 'First page\n\nSecond page\n');
    const renderCalls = commands.filter(({ executable }) => executable.endsWith('pdftoppm.exe'));
    assert.deepEqual(renderCalls.map(({ args }) => [args[1], args[3]]), [['1', '1'], ['2', '2']]);
    assert.equal(commands[0].executable, 'C:\\Program Files\\Poppler\\pdfinfo.exe');
    assert.equal(commands[0].options.shell, false);
    assert.equal(commands.some(({ executable }) => executable.endsWith('tesseract.exe') && executable.includes('Program Files')), true);
    assert.equal(commands.every(({ options }) => options.signal instanceof AbortSignal), true);
    assert.equal(commands[1].args.includes(sourcePath), false, 'OCR receives only the private temporary copy');
    await assert.rejects(fs.access(privateWorkDirectory), 'the private temporary directory is removed');
    assert.deepEqual(await fs.readdir(directory), ['student scan.pdf'], 'the per-document temporary directory is removed');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('malformed, encrypted, and over-limit PDFs fail safely and clean their temporary files', async () => {
  const directory = await temporaryDirectory();
  const sourcePath = path.join(directory, 'source.pdf');
  await fs.writeFile(sourcePath, Buffer.from('%PDF-1.7 test fixture'));
  const cases = [
    { name: 'malformed metadata', output: 'not a PDF info response', code: 'OCR_INVALID_DOCUMENT' },
    { name: 'encrypted PDF', output: 'Pages: 1\nEncrypted: yes\n', code: 'OCR_INVALID_DOCUMENT' },
    { name: 'page limit', output: `Pages: ${MAX_PDF_PAGES + 1}\nEncrypted: no\n`, code: 'OCR_PAGE_LIMIT' }
  ];

  try {
    for (const testCase of cases) {
      let renderCalled = false;
      const service = serviceFor({
        directory,
        async execFileImpl(executable, _args, _options, callback) {
          if (executable === 'pdfinfo') return completeCommand(callback, testCase.output);
          renderCalled = true;
          return completeCommand(callback);
        }
      });
      await assert.rejects(service.processDocument(sourcePath, 'application/pdf'), { code: testCase.code }, testCase.name);
      assert.equal(renderCalled, false, testCase.name);
      assert.deepEqual(await fs.readdir(directory), ['source.pdf'], `${testCase.name} removes temporary files`);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('missing OCR binaries fail without exposing command output and clean temporary files', async () => {
  const directory = await temporaryDirectory();
  const sourcePath = path.join(directory, 'image.png');
  await fs.writeFile(sourcePath, Buffer.from('private fake image'));
  const service = serviceFor({
    directory,
    execFileImpl(_executable, _args, _options, callback) {
      const error = new Error('binary missing');
      error.code = 'ENOENT';
      completeCommand(callback, '', error);
    }
  });

  try {
    await assert.rejects(service.processDocument(sourcePath, 'image/png'), { code: 'OCR_BINARY_UNAVAILABLE' });
    assert.deepEqual(await fs.readdir(directory), ['image.png']);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('execFile timeouts map SIGKILL to a safe timeout and clean temporary files', async () => {
  const directory = await temporaryDirectory();
  const sourcePath = path.join(directory, 'image.png');
  await fs.writeFile(sourcePath, Buffer.from('private fake image'));
  const service = serviceFor({
    directory,
    execFileImpl(_executable, _args, options, callback) {
      assert.ok(options.timeout > 0 && options.timeout <= 5000);
      const error = new Error('timed out');
      error.killed = true;
      error.signal = 'SIGKILL';
      completeCommand(callback, '', error);
    }
  });

  try {
    await assert.rejects(service.processDocument(sourcePath, 'image/png'), { code: 'OCR_TIMEOUT' });
    assert.deepEqual(await fs.readdir(directory), ['image.png']);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('native stdout buffer overflow remains an output limit even when execFile kills the child', async () => {
  const directory = await temporaryDirectory();
  const sourcePath = path.join(directory, 'image.png');
  await fs.writeFile(sourcePath, Buffer.from('private fake image'));
  const service = serviceFor({
    directory,
    execFileImpl(_executable, _args, _options, callback) {
      const error = new Error('max buffer reached');
      error.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
      error.killed = true;
      error.signal = 'SIGKILL';
      completeCommand(callback, '', error);
    }
  });

  try {
    await assert.rejects(service.processDocument(sourcePath, 'image/png'), { code: 'OCR_OUTPUT_LIMIT' });
    assert.deepEqual(await fs.readdir(directory), ['image.png']);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('unreadable source files fail safely before any OCR subprocess starts', async () => {
  const directory = await temporaryDirectory();
  let commandCount = 0;
  const service = serviceFor({
    directory,
    execFileImpl() { commandCount += 1; }
  });

  try {
    await assert.rejects(service.processDocument(path.join(directory, 'missing.png'), 'image/png'), { code: 'OCR_FILE_UNAVAILABLE' });
    assert.equal(commandCount, 0);
    assert.deepEqual(await fs.readdir(directory), []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('a native OCR page failure rejects the entire PDF without returning partial text', async () => {
  const directory = await temporaryDirectory();
  const sourcePath = path.join(directory, 'source.pdf');
  let privateWorkDirectory;
  await fs.writeFile(sourcePath, Buffer.from('%PDF-1.7 test fixture'));
  const service = serviceFor({
    directory,
    async execFileImpl(executable, args, _options, callback) {
      if (executable === 'pdfinfo') {
        privateWorkDirectory = path.dirname(args[0]);
        return completeCommand(callback, 'Pages: 2\nEncrypted: no\n');
      }
      if (executable === 'pdftoppm') {
        await fs.writeFile(`${args.at(-1)}.png`, Buffer.from('rendered image'));
        return completeCommand(callback);
      }
      if (path.basename(args[0]).includes('01')) return completeCommand(callback, 'partial first page text');
      const error = new Error('native stderr must not escape');
      error.code = 1;
      return completeCommand(callback, '', error);
    }
  });

  try {
    await assert.rejects(service.processDocument(sourcePath, 'application/pdf'), (error) => {
      assert.equal(error.code, 'OCR_PROCESSING_FAILED');
      assert.doesNotMatch(error.message, /partial first page|native stderr/);
      return true;
    });
    assert.deepEqual(await fs.readdir(directory), ['source.pdf']);
    await assert.rejects(fs.access(privateWorkDirectory));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('aborting the OCR signal cancels the active native subprocess and removes its temporary copy', async () => {
  const directory = await temporaryDirectory();
  const sourcePath = path.join(directory, 'image.png');
  const controller = new AbortController();
  let observedSignal;
  await fs.writeFile(sourcePath, Buffer.from('private fake image'));
  const service = serviceFor({
    directory,
    execFileImpl(_executable, _args, options, callback) {
      observedSignal = options.signal;
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.code = 'ABORT_ERR';
        completeCommand(callback, '', error);
      }, { once: true });
      setImmediate(() => controller.abort());
    }
  });

  try {
    await assert.rejects(service.processDocument(sourcePath, 'image/png', { signal: controller.signal }), { code: 'OCR_TIMEOUT' });
    assert.equal(observedSignal.aborted, true);
    assert.deepEqual(await fs.readdir(directory), ['image.png']);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
