const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const env = require('./environment');

let client;

function getDocumentAIClient() {
  if (!client) client = new DocumentProcessorServiceClient();
  return client;
}

function getProcessorName() {
  const { projectId, location, processorId } = env.documentAI;
  if (!projectId || !processorId) {
    throw new Error('Google Document AI is not configured yet.');
  }
  return `projects/${projectId}/locations/${location}/processors/${processorId}`;
}

module.exports = { getDocumentAIClient, getProcessorName };
