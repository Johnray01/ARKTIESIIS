const sql = require('mssql');
const env = require('./environment');

const config = {
  server: env.database.server,
  port: env.database.port,
  database: env.database.database,
  user: env.database.user,
  password: env.database.password,
  options: {
    encrypt: env.database.encrypt,
    trustServerCertificate: env.database.trustServerCertificate
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

let pool;
let pendingConnection;

async function getPool() {
  if (pool?.connected) return pool;
  if (pendingConnection) return pendingConnection;

  const connectionPool = new sql.ConnectionPool(config);
  const attempt = connectionPool.connect()
    .then((connectedPool) => {
      pool = connectedPool;
      return connectedPool;
    })
    .catch(async (error) => {
      try {
        await connectionPool.close();
      } catch {
        // The failed pool may already be closed.
      }
      throw error;
    });

  pendingConnection = attempt;
  try {
    return await attempt;
  } finally {
    if (pendingConnection === attempt) pendingConnection = null;
  }
}

async function closePool() {
  let activePool = pool;
  if (!activePool && pendingConnection) {
    try {
      activePool = await pendingConnection;
    } catch {
      return;
    }
  }

  if (pool === activePool) pool = null;
  if (activePool) await activePool.close();
}

module.exports = { sql, getPool, closePool };
