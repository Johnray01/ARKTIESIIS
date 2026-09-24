const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const env = require('./environment');

const LOCATION_PATTERN = /^(?:us|eu|[a-z]{2,16}(?:-[a-z]{2,16})?[0-9]+)$/i;
const PROJECT_PATTERN = /^[a-z0-9][a-z0-9-]{4,28}[a-z0-9]$/i;
const PROCESSOR_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;

function normalizeLocation(location) {
  if (typeof location !== 'string' || !LOCATION_PATTERN.test(location)) {
    throw new Error('Google Document AI location is invalid.');
  }
  return location.toLowerCase();
}

function getDocumentAIEndpoint(location) {
  return `${normalizeLocation(location)}-documentai.googleapis.com`;
}

function getProcessorName(documentAIConfig = env.documentAI) {
  const { projectId, location, processorId } = documentAIConfig || {};
  if (!projectId || !processorId) {
    throw new Error('Google Document AI is not configured yet.');
  }
  if (!PROJECT_PATTERN.test(projectId) || !PROCESSOR_PATTERN.test(processorId)) {
    throw new Error('Google Document AI settings are invalid.');
  }
  return `projects/${projectId}/locations/${normalizeLocation(location)}/processors/${processorId}`;
}

function createDocumentAIConfiguration({
  DocumentProcessorServiceClientClass = DocumentProcessorServiceClient,
  documentAIConfig = env.documentAI
} = {}) {
  let client;
  return {
    getDocumentAIClient() {
      if (!client) {
        client = new DocumentProcessorServiceClientClass({
          apiEndpoint: getDocumentAIEndpoint(documentAIConfig?.location)
        });
      }
      return client;
    },
    getProcessorName() {
      return getProcessorName(documentAIConfig);
    }
  };
}

const defaultConfiguration = createDocumentAIConfiguration();

module.exports = {
  createDocumentAIConfiguration,
  getDocumentAIClient: defaultConfiguration.getDocumentAIClient,
  getDocumentAIEndpoint,
  getProcessorName,
  normalizeLocation
};
