const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDocumentAIConfiguration } = require('../src/config/documentAI');
const { createDocumentAIService } = require('../src/services/documentAIService');

async function temporaryDirectory() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ark-document-ai-client-test-'));
}

test('Document AI client uses a validated processor-specific regional endpoint', () => {
  const clientOptions = [];
  class FakeDocumentProcessorServiceClient {
    constructor(options) { clientOptions.push(options); }
  }
  const configuration = createDocumentAIConfiguration({
    DocumentProcessorServiceClientClass: FakeDocumentProcessorServiceClient,
    documentAIConfig: { projectId: 'ark-test-project', location: 'EU', processorId: 'processor-42' }
  });

  assert.ok(configuration.getDocumentAIClient() instanceof FakeDocumentProcessorServiceClient);
  assert.deepEqual(clientOptions, [{ apiEndpoint: 'eu-documentai.googleapis.com' }]);
  assert.equal(configuration.getProcessorName(), 'projects/ark-test-project/locations/eu/processors/processor-42');
  assert.throws(() => createDocumentAIConfiguration({
    DocumentProcessorServiceClientClass: FakeDocumentProcessorServiceClient,
    documentAIConfig: { projectId: 'ark-test-project', location: 'eu.example.com', processorId: 'processor-42' }
  }).getDocumentAIClient(), /location is invalid/);
});

test('Document AI service sends supported file bytes, MIME type, processor resource, and timeout options', async () => {
  const directory = await temporaryDirectory();
  const calls = [];
  const client = {
    async processDocument(request, options) {
      calls.push({ request, options });
      return [{ document: { text: 'Recognized text.' } }];
    }
  };
  const service = createDocumentAIService({
    getDocumentAIClient: () => client,
    getProcessorName: () => 'projects/ark-test-project/locations/eu/processors/processor-42'
  });

  try {
    const files = [
      { filename: 'sample.pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-1.7 test PDF') },
      { filename: 'sample.png', mimeType: 'image/png', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]) }
    ];
    for (const file of files) {
      const filePath = path.join(directory, file.filename);
      await fs.writeFile(filePath, file.bytes, { mode: 0o600 });
      const result = await service.processDocument(filePath, file.mimeType, { timeoutMs: 2345 });
      assert.equal(result.text, 'Recognized text.');
      assert.deepEqual(calls.at(-1), {
        request: {
          name: 'projects/ark-test-project/locations/eu/processors/processor-42',
          rawDocument: { content: file.bytes.toString('base64'), mimeType: file.mimeType }
        },
        options: { timeout: 2345, retry: null }
      });
    }

    await assert.rejects(service.processDocument(path.join(directory, 'sample.pdf'), 'text/plain'), /supported PDF or image/);
    assert.equal(calls.length, 2, 'unsupported MIME types never reach the configured processor');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
