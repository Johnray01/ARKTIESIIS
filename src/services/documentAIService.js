const fs = require('node:fs/promises');
const { getDocumentAIClient, getProcessorName } = require('../config/documentAI');

async function processDocument(filePath, mimeType) {
  const content = await fs.readFile(filePath);
  const client = getDocumentAIClient();
  const name = getProcessorName();

  const [result] = await client.processDocument({
    name,
    rawDocument: {
      content: content.toString('base64'),
      mimeType
    }
  });

  return result.document;
}

module.exports = { processDocument };
