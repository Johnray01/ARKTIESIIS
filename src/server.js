const { createApp } = require('./app');
const env = require('./config/environment');
const { getPool } = require('./config/database');
const { isDevelopmentPasswordLoginEnabled } = require('./middleware/auth');
const { createDocumentProcessingService, startProcessingRecoveryScheduler } = require('./services/documentProcessingService');

function getListenHost(environment = env) {
  return isDevelopmentPasswordLoginEnabled(environment) ? '127.0.0.1' : undefined;
}

async function start() {
  try {
    await getPool();
  } catch {
    console.error('ARKTIESIIS could not connect to the database. Check the database settings and server availability.');
    process.exitCode = 1;
    return null;
  }

  const processingService = createDocumentProcessingService({ getPool });
  const app = createApp({ documentProcessingService: processingService });
  const processingRecovery = startProcessingRecoveryScheduler(processingService);
  await processingRecovery.run();

  const host = getListenHost(env);
  const onListening = () => {
    console.log(`ARKTIESIIS running at http://${host || 'localhost'}:${env.port}`);
  };
  const server = host
    ? app.listen(env.port, host, onListening)
    : app.listen(env.port, onListening);
  server.once('close', processingRecovery.stop);
  return server;
}

if (require.main === module) {
  start();
}

module.exports = { start, getListenHost };
