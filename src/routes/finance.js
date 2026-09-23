const express = require('express');
const { ensureCsrfToken, hasValidCsrfToken } = require('../middleware/auth');
const { FinanceServiceError, createFinanceService, normalizeId, normalizeSearchTerm } = require('../services/financeService');

const notices = {
  accountCreated: 'Financial account created.',
  transactionRecorded: 'Financial transaction recorded.'
};

function formValues(input = {}) {
  const value = (key, maxLength) => typeof input?.[key] === 'string' ? input[key].slice(0, maxLength) : '';
  return {
    transactionType: value('transactionType', 30),
    amount: value('amount', 32),
    description: value('description', 500),
    referenceNo: value('referenceNo', 100)
  };
}

function searchTermFromQuery(req) {
  try {
    return normalizeSearchTerm(req.query.search);
  } catch {
    return '';
  }
}

function detailUrl(req, studentId, notice) {
  const query = new URLSearchParams();
  const searchTerm = searchTermFromQuery(req);
  if (searchTerm) query.set('search', searchTerm);
  if (notice) query.set('notice', notice);
  const suffix = query.toString();
  return `/finance/students/${studentId}${suffix ? `?${suffix}` : ''}`;
}

function createFinanceRouter({ getPool, sql, financeService } = {}) {
  const router = express.Router();
  const service = financeService || createFinanceService({ getPool, sql });

  async function renderWorkspace(req, res, { status = 200, searchTerm = req.query.search || '', searchError = null } = {}) {
    try {
      const result = await service.searchStudents(searchTerm);
      return res.status(status).render('finance/workspace', {
        title: 'Finance Workspace',
        currentUser: req.authUser,
        csrfToken: ensureCsrfToken(req),
        searchTerm: result.searchTerm,
        searchSuffix: result.searchTerm ? `?search=${encodeURIComponent(result.searchTerm)}` : '',
        students: result.students,
        searchError,
        student: null,
        account: null,
        transactions: [],
        error: null,
        notice: notices[req.query.notice] || null,
        transactionValues: formValues()
      });
    } catch (error) {
      if (error instanceof FinanceServiceError) {
        return res.status(error.status).render('finance/workspace', {
          title: 'Finance Workspace', currentUser: req.authUser, csrfToken: ensureCsrfToken(req), searchTerm: '', students: [],
          searchSuffix: '',
          searchError: error.message, student: null, account: null, transactions: [], error: null,
          notice: null, transactionValues: formValues()
        });
      }
      return res.status(503).render('error', { title: 'Service Unavailable', message: 'The finance workspace is temporarily unavailable.' });
    }
  }

  async function renderStudent(req, res, studentId, { status = 200, error = null, transactionValues = {} } = {}) {
    try {
      const result = await service.getStudentAccount(studentId);
      if (!result) return res.status(404).render('error', { title: 'Not Found', message: 'Student record not found.' });
      const searchTerm = searchTermFromQuery(req);
      const searchSuffix = searchTerm ? `?search=${encodeURIComponent(searchTerm)}` : '';
      return res.status(status).render('finance/workspace', {
        title: 'Financial Account',
        currentUser: req.authUser,
        csrfToken: ensureCsrfToken(req),
        searchTerm,
        searchSuffix,
        students: [],
        searchError: null,
        student: result.student,
        account: result.account,
        transactions: result.transactions,
        error,
        notice: notices[req.query.notice] || null,
        transactionValues: formValues(transactionValues)
      });
    } catch {
      return res.status(503).render('error', { title: 'Service Unavailable', message: 'The financial account could not be loaded.' });
    }
  }

  router.get('/', (req, res) => renderWorkspace(req, res));

  router.get('/students/:id', async (req, res) => {
    const studentId = normalizeId(req.params.id);
    if (!studentId) return res.status(404).render('error', { title: 'Not Found', message: 'Student record not found.' });
    return renderStudent(req, res, studentId);
  });

  router.post('/students/:id/account', async (req, res) => {
    if (!hasValidCsrfToken(req)) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'The form session expired. Reload the page and try again.' });
    }
    const studentId = normalizeId(req.params.id);
    if (!studentId) return res.status(404).render('error', { title: 'Not Found', message: 'Student record not found.' });
    try {
      await service.createAccount(req.authUser.id, studentId);
      return res.redirect(303, detailUrl(req, studentId, 'accountCreated'));
    } catch (error) {
      if (error instanceof FinanceServiceError && error.status === 403) {
        return res.status(403).render('error', { title: 'Forbidden', message: 'Finance access is no longer active. Sign in again.' });
      }
      if (error instanceof FinanceServiceError) return renderStudent(req, res, studentId, { status: error.status, error: error.message });
      if (error?.number === 2601 || error?.number === 2627) {
        return renderStudent(req, res, studentId, { status: 409, error: 'This student already has a financial account.' });
      }
      return res.status(503).render('error', { title: 'Service Unavailable', message: 'The financial account could not be created.' });
    }
  });

  router.post('/students/:id/transactions', async (req, res) => {
    if (!hasValidCsrfToken(req)) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'The form session expired. Reload the page and try again.' });
    }
    const studentId = normalizeId(req.params.id);
    if (!studentId) return res.status(404).render('error', { title: 'Not Found', message: 'Student record not found.' });
    try {
      await service.recordTransaction(req.authUser.id, studentId, req.body);
      return res.redirect(303, detailUrl(req, studentId, 'transactionRecorded'));
    } catch (error) {
      if (error instanceof FinanceServiceError) {
        if (error.status === 403) {
          return res.status(403).render('error', { title: 'Forbidden', message: 'Finance access is no longer active. Sign in again.' });
        }
        return renderStudent(req, res, studentId, { status: error.status, error: error.message, transactionValues: req.body });
      }
      return res.status(503).render('error', { title: 'Service Unavailable', message: 'The financial transaction could not be recorded.' });
    }
  });

  return router;
}

module.exports = { createFinanceRouter, formValues };
