const fs = require('node:fs/promises');
const { constants: fsConstants } = require('node:fs');
const documentAIConfiguration = require('../config/documentAI');

const SUPPORTED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

function createDocumentAIService({
  getDocumentAIClient = documentAIConfiguration.getDocumentAIClient,
  getProcessorName = documentAIConfiguration.getProcessorName,
  fileSystem = fs,
  fileSystemConstants = fsConstants
} = {}) {
  async function processDocument(filePath, mimeType, { timeoutMs = 30000 } = {}) {
    if (!SUPPORTED_MIME_TYPES.has(mimeType)) throw new Error('Document AI requires a supported PDF or image type.');
    const noFollow = fileSystemConstants.O_NOFOLLOW || 0;
    const fileHandle = await fileSystem.open(filePath, fileSystemConstants.O_RDONLY | noFollow);
    let content;
    try {
      const stat = await fileHandle.stat();
      if (!stat.isFile()) throw new Error('Stored document is not a regular file.');
      content = await fileHandle.readFile();
    } finally {
      await fileHandle.close();
    }
    const client = getDocumentAIClient();
    const name = getProcessorName();

    const [result] = await client.processDocument({
      name,
      rawDocument: {
        content: content.toString('base64'),
        mimeType
      }
    }, {
      timeout: Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000,
      retry: null
    });

    return result?.document;
  }

  return { processDocument };
}

const defaultService = createDocumentAIService();

module.exports = { createDocumentAIService, ...defaultService };
