const app = require('./app');
const env = require('./config/environment');
const { getPool } = require('./config/database');

async function start() {
  try {
    await getPool();
  } catch {
    console.error('ARKTIESIIS could not connect to the database. Check the database settings and server availability.');
    process.exitCode = 1;
    return null;
  }

  const server = app.listen(env.port, () => {
    console.log(`ARKTIESIIS running at http://localhost:${env.port}`);
  });
  return server;
}

if (require.main === module) {
  start();
}

module.exports = { start };
