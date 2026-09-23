const express = require('express');
const { getPool: defaultGetPool } = require('../config/database');

function createRouter({ getPool = defaultGetPool } = {}) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.render('home', { title: 'ARKTIESIIS' });
  });

  router.get('/health', async (req, res) => {
    try {
      const pool = await getPool();
      await pool.request().query('SELECT 1 AS ok');
      res.json({ ok: true, database: 'connected' });
    } catch {
      res.status(503).json({ ok: false, database: 'disconnected' });
    }
  });

  router.get('/login', (req, res) => {
    res.render('auth/login', { title: 'Login' });
  });

  return router;
}

module.exports = { createRouter };
