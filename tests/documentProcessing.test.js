const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readMigrationFiles, splitSqlBatches } = require('../scripts/db-setup');
const { createDocumentProcessingService, startProcessingRecoveryScheduler } = require('../src/services/documentProcessingService');
const { createDocumentService } = require('../src/services/documentService');

function fakeSql() {
  return {
    MAX: 'MAX',
    Int: 'Int',
    ISOLATION_LEVEL: { SERIALIZABLE: 'SERIALIZABLE' },
    NVarChar: (length) => `NVarChar(${length})`
  };
}

function documentHarness({ status = 'pending', storedFilename, mimeType, providerResult = { text: 'Extracted student data.' }, providerError = null } = {}) {
  const state = {
    document: {
      id: 84,
      status,
      processing_started_at: status === 'processing' ? null : null,
      stored_filename: storedFilename || '5dd677e1-87fb-4214-a7c1-27aca233ae1f.pdf',
      mime_type: mimeType || 'application/pdf',
      document_type: 'report_card'
    },
    queries: [],
    validations: [],
    commits: 0,
    rollbacks: 0,
    providerResult,
    providerError,
    failNextValidationInsert: false,
    staleProcessing: status === 'processing'
  };

  const transactionFactory = () => {
    const transaction = {
      localDocument: { ...state.document },
      localValidations: [],
      async begin() {},
      request() {
        const values = {};
        return {
          input(name, _type, value) { values[name] = value; return this; },
          async query(statement) {
            state.queries.push({ statement, values: { ...values } });
            if (statement.includes("SET status = 'processing'")) {
              if (transaction.localDocument.status !== 'pending') return { recordset: [] };
              transaction.localDocument.status = 'processing';
              transaction.localDocument.processing_started_at = 'started';
              return { recordset: [{ ...transaction.localDocument }] };
            }
            if (statement.includes('SET status = @documentStatus')) {
              if (transaction.localDocument.status !== 'processing') return { recordset: [] };
              transaction.localDocument.status = values.documentStatus;
              transaction.localDocument.processing_started_at = null;
              return { recordset: [{ id: transaction.localDocument.id }] };
            }
            if (statement.includes('DECLARE @recovered TABLE')) {
              if (transaction.localDocument.status !== 'processing' || !state.staleProcessing) {
                return { recordset: [{ recovered_count: 0 }] };
              }
              transaction.localDocument.status = 'failed';
              transaction.localDocument.processing_started_at = null;
              transaction.localValidations.push({ statement, values: { ...values, resultStatus: 'failed' } });
              return { recordset: [{ recovered_count: 1 }] };
            }
            if (statement.includes('INSERT INTO dbo.document_validations')) {
              if (state.failNextValidationInsert) {
                state.failNextValidationInsert = false;
                throw new Error('simulated validation persistence failure');
              }
              transaction.localValidations.push({ statement, values: { ...values } });
              return { recordset: [] };
            }
            if (statement.includes('FROM dbo.users WITH')) return { recordset: [{ id: 7, role: 'registrar' }] };
            if (statement.includes('FROM dbo.documents WITH')) return { recordset: [{ id: 84, student_id: 44, document_type: 'report_card' }] };
            if (statement.includes('INSERT INTO dbo.document_review_events')) return { recordset: [] };
            if (statement.includes("SET status = CASE WHEN status = 'processing'")) {
              if (transaction.localDocument.status !== 'processing') transaction.localDocument.status = 'needs_review';
              return { recordset: [] };
            }
            if (statement.includes('INSERT INTO dbo.audit_logs')) return { recordset: [] };
            throw new Error(`Unexpected SQL: ${statement}`);
          }
        };
      },
      async commit() {
        state.document = { ...transaction.localDocument };
        state.validations.push(...transaction.localValidations);
        state.commits += 1;
      },
      async rollback() { state.rollbacks += 1; }
    };
    return transaction;
  };

  return { state, transactionFactory };
}

async function temporaryStorage() {
  const storageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ark-document-ai-'));
  return storageDirectory;
}

function makeService(harness, storageDirectory, options = {}) {
  return createDocumentProcessingService({
    getPool: async () => ({}),
    sql: fakeSql(),
    transactionFactory: harness.transactionFactory,
    documentAIConfig: { projectId: 'test-project', location: 'us', processorId: 'test-processor' },
    storageDirectory,
    timeoutMs: 1000,
    ...options
  });
}

test('configured processing sends securely stored PDF and image submissions to Document AI and persists OCR without marking valid', async () => {
  const storageDirectory = await temporaryStorage();
  try {
    for (const file of [
      { storedFilename: '5dd677e1-87fb-4214-a7c1-27aca233ae1f.pdf', mimeType: 'application/pdf' },
      { storedFilename: '8bbd4569-d20b-4c62-81cf-dd0952324d03.png', mimeType: 'image/png' }
    ]) {
      const harness = documentHarness({ storedFilename: file.storedFilename, mimeType: file.mimeType });
      await fs.writeFile(path.join(storageDirectory, file.storedFilename), Buffer.from('private-upload'));
      const calls = [];
      const service = makeService(harness, storageDirectory, {
        documentAI: {
          async processDocument(filePath, mimeType, options) {
            assert.equal(harness.state.document.status, 'processing');
            calls.push({ filePath, mimeType, options });
            return { text: '  extracted name\r\n  school information  ' };
          }
        }
      });

      const result = await service.processPendingDocument(84);
      assert.equal(result.status, 'needs_review');
      assert.equal(result.resultStatus, 'needs_review');
      assert.equal(harness.state.document.status, 'needs_review');
      assert.equal(harness.state.validations.length, 1);
      assert.equal(harness.state.validations[0].values.extractedText, 'extracted name\n  school information');
      assert.equal(harness.state.validations[0].values.resultStatus, 'needs_review');
      assert.equal(harness.state.validations[0].values.processor, 'Google Document AI');
      assert.deepEqual(calls.map(({ mimeType }) => mimeType), [file.mimeType]);
      assert.equal(calls[0].options.timeoutMs, 1000);
      assert.match(calls[0].filePath, new RegExp(`${file.storedFilename.replaceAll('.', '\\.')}$`));
      assert.equal(JSON.parse(harness.state.validations[0].values.validationJson).outcome, 'extracted');
      assert.equal(harness.state.validations[0].values.validationJson.includes('extracted name'), false);
      assert.equal(harness.state.validations[0].values.validationJson.includes('valid'), false);
    }
  } finally {
    await fs.rm(storageDirectory, { recursive: true, force: true });
  }
});

test('missing Document AI configuration records a terminal safe failure without calling the provider', async () => {
  const storageDirectory = await temporaryStorage();
  try {
    const harness = documentHarness();
    let calls = 0;
    const service = makeService(harness, storageDirectory, {
      documentAIConfig: { projectId: '', location: 'us', processorId: '' },
      documentAI: { async processDocument() { calls += 1; } }
    });
    const result = await service.processPendingDocument(84);
    const saved = harness.state.validations[0].values;
    assert.equal(result.status, 'failed');
    assert.equal(harness.state.document.status, 'failed');
    assert.equal(calls, 0);
    assert.equal(saved.resultStatus, 'failed');
    assert.equal(JSON.parse(saved.validationJson).outcome, 'processor_not_configured');
    assert.equal(saved.extractedText, null);
  } finally {
    await fs.rm(storageDirectory, { recursive: true, force: true });
  }
});

test('timeouts, provider errors, malformed responses, and empty OCR are terminal and safe', async () => {
  const storageDirectory = await temporaryStorage();
  const cases = [
    {
      name: 'timeout',
      provider: () => new Promise(() => {}),
      status: 'failed',
      resultStatus: 'failed',
      code: 'processor_timeout'
    },
    {
      name: 'provider error',
      provider: async () => { throw new Error('sensitive provider response and credential details'); },
      status: 'failed',
      resultStatus: 'failed',
      code: 'processor_error'
    },
    {
      name: 'malformed provider response',
      provider: async () => ({ text: ['not', 'text'] }),
      status: 'failed',
      resultStatus: 'failed',
      code: 'malformed_response'
    },
    {
      name: 'empty OCR',
      provider: async () => ({ text: ' \n  ' }),
      status: 'needs_review',
      resultStatus: 'needs_review',
      code: 'empty_ocr'
    }
  ];
  try {
    for (const testCase of cases) {
      const harness = documentHarness();
      const service = makeService(harness, storageDirectory, {
        documentAI: { processDocument: testCase.provider }
      });
      const result = await service.processPendingDocument(84);
      const saved = harness.state.validations[0].values;
      const summary = JSON.parse(saved.validationJson);
      assert.equal(result.status, testCase.status, testCase.name);
      assert.equal(saved.resultStatus, testCase.resultStatus, testCase.name);
      assert.equal(summary.outcome, testCase.code, testCase.name);
      assert.equal(summary.message.includes('sensitive provider response'), false);
      assert.equal(harness.state.document.status, testCase.status, testCase.name);
    }
  } finally {
    await fs.rm(storageDirectory, { recursive: true, force: true });
  }
});

test('already processed submissions are not sent to Document AI again', async () => {
  const storageDirectory = await temporaryStorage();
  try {
    const harness = documentHarness({ status: 'needs_review' });
    let calls = 0;
    const service = makeService(harness, storageDirectory, {
      documentAI: { async processDocument() { calls += 1; return { text: 'should not run' }; } }
    });
    const result = await service.processPendingDocument(84);
    assert.equal(result.status, 'not_pending');
    assert.equal(calls, 0);
    assert.equal(harness.state.validations.length, 0);
  } finally {
    await fs.rm(storageDirectory, { recursive: true, force: true });
  }
});

test('OCR processing does not report success when another state transition wins before result persistence', async () => {
  const storageDirectory = await temporaryStorage();
  const storedFilename = '5dd677e1-87fb-4214-a7c1-27aca233ae1f.pdf';
  try {
    const harness = documentHarness();
    await fs.writeFile(path.join(storageDirectory, storedFilename), Buffer.from('private-upload'));
    const service = makeService(harness, storageDirectory, {
      documentAI: {
        async processDocument() {
          harness.state.document.status = 'failed';
          harness.state.document.processing_started_at = null;
          return { text: 'OCR text' };
        }
      }
    });

    await assert.rejects(service.processPendingDocument(84), /submission state changed/);
    assert.equal(harness.state.document.status, 'failed');
    assert.equal(harness.state.validations.length, 0, 'the OCR result was not recorded for the competing terminal state');
  } finally {
    await fs.rm(storageDirectory, { recursive: true, force: true });
  }
});

test('a failed OCR result transaction leaves a persisted lease that recovery terminalizes with a safe validation row', async () => {
  const storageDirectory = await temporaryStorage();
  const storedFilename = '5dd677e1-87fb-4214-a7c1-27aca233ae1f.pdf';
  try {
    const harness = documentHarness();
    await fs.writeFile(path.join(storageDirectory, storedFilename), Buffer.from('private-upload'));
    harness.state.failNextValidationInsert = true;
    const service = makeService(harness, storageDirectory, {
      recoveryGraceMs: 1000,
      documentAI: { async processDocument() { return { text: 'OCR text' }; } }
    });

    await assert.rejects(service.processPendingDocument(84), /processing result could not be recorded/);
    assert.equal(harness.state.document.status, 'processing');
    assert.equal(harness.state.document.processing_started_at, 'started');
    assert.equal(harness.state.validations.length, 0);
    assert.equal(harness.state.rollbacks, 1);

    harness.state.staleProcessing = true;
    assert.equal(await service.recoverStaleProcessing(), 1);
    assert.equal(harness.state.document.status, 'failed');
    assert.equal(harness.state.document.processing_started_at, null);
    assert.equal(harness.state.validations.length, 1);
    const recoveryRow = harness.state.validations[0];
    assert.equal(recoveryRow.values.processor, 'Google Document AI');
    assert.equal(recoveryRow.values.staleAfterMs, 2000);
    assert.equal(recoveryRow.values.batchSize, 100);
    assert.equal(JSON.parse(recoveryRow.values.validationJson).outcome, 'processing_recovered');
    assert.match(recoveryRow.statement, /INSERT INTO dbo\.document_validations[\s\S]*SELECT id, @processor, NULL, @validationJson, NULL, NULL, 'failed'/);
  } finally {
    await fs.rm(storageDirectory, { recursive: true, force: true });
  }
});

test('migration 004 is discoverable and adds the timestamped processing recovery index', async () => {
  const migration = readMigrationFiles().find(({ version }) => version === '004');
  assert.ok(migration);
  assert.equal(migration.fileName, '004_document_processing_recovery.sql');
  const batches = splitSqlBatches(await fs.readFile(migration.filePath, 'utf8'));
  assert.equal(batches.length, 2);
  assert.match(batches[0], /ALTER TABLE dbo\.documents[\s\S]+ADD processing_started_at DATETIME2\(3\) NULL/);
  assert.match(batches[1], /CREATE INDEX IX_documents_status_processing_started_at[\s\S]+WHERE status = 'processing'/);
});

test('review requests during OCR preserve the processing lease until the OCR result is committed', async () => {
  const storageDirectory = await temporaryStorage();
  const storedFilename = '5dd677e1-87fb-4214-a7c1-27aca233ae1f.pdf';
  try {
    const harness = documentHarness();
    await fs.writeFile(path.join(storageDirectory, storedFilename), Buffer.from('private-upload'));
    let resolveProvider;
    let providerStarted;
    const providerStartedPromise = new Promise((resolve) => { providerStarted = resolve; });
    const processingService = makeService(harness, storageDirectory, {
      documentAI: {
        processDocument() {
          providerStarted();
          return new Promise((resolve) => { resolveProvider = resolve; });
        }
      }
    });
    const documentService = createDocumentService({
      getPool: async () => ({}),
      sql: fakeSql(),
      transactionFactory: harness.transactionFactory,
      storageDirectory
    });

    const processing = processingService.processPendingDocument(84);
    await providerStartedPromise;
    assert.equal(harness.state.document.status, 'processing');
    await documentService.addReviewEvent(7, '84', 'correction_requested', 'Please provide a clearer scan.');
    assert.equal(harness.state.document.status, 'processing');
    assert.equal(harness.state.document.processing_started_at, 'started');

    resolveProvider({ text: 'OCR text' });
    const result = await processing;
    assert.equal(result.status, 'needs_review');
    assert.equal(harness.state.document.status, 'needs_review');
    assert.equal(harness.state.document.processing_started_at, null);
    assert.equal(harness.state.validations.length, 1);
    assert.equal(harness.state.validations[0].values.resultStatus, 'needs_review');
    assert.equal(harness.state.queries.some(({ statement }) => statement.includes("SET status = CASE WHEN status = 'processing' THEN status ELSE 'needs_review' END")), true);
  } finally {
    await fs.rm(storageDirectory, { recursive: true, force: true });
  }
});

test('stale recovery scheduler runs immediately, periodically, and prevents overlapping scans', async () => {
  let intervalHandler;
  let intervalMs;
  let cleared = false;
  let unrefCalled = false;
  let resolveFirst;
  let calls = 0;
  const scheduler = startProcessingRecoveryScheduler({
    recoverStaleProcessing() {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { resolveFirst = resolve; });
      return Promise.resolve(0);
    }
  }, {
    intervalMs: 2000,
    setIntervalFn(callback, delay) {
      intervalHandler = callback;
      intervalMs = delay;
      return { unref() { unrefCalled = true; } };
    },
    clearIntervalFn() { cleared = true; },
    logger: { error() { assert.fail('successful test scan should not log an error'); } }
  });

  try {
    await Promise.resolve();
    assert.equal(calls, 1, 'startup kicks off recovery');
    assert.equal(intervalMs, 2000);
    assert.equal(unrefCalled, true);
    intervalHandler();
    await Promise.resolve();
    assert.equal(calls, 1, 'a periodic scan does not overlap the startup scan');
    resolveFirst(0);
    await scheduler.run();
    intervalHandler();
    await scheduler.run();
    assert.equal(calls, 2, 'the next periodic scan runs after the previous scan settles');
  } finally {
    scheduler.stop();
  }
  assert.equal(cleared, true);
});
