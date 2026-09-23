const express = require('express');
const { ensureCsrfToken, hasValidCsrfToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const {
  AcademicRecordsError,
  createAcademicRecordsService,
  normalizeId,
  isUniqueConflict
} = require('../services/academicRecordsService');

const notices = {
  subjectCreated: 'Subject created.',
  subjectUpdated: 'Subject updated.',
  subjectAssigned: 'Subject assigned to the enrollment.',
  gradeSaved: 'Grade saved.'
};

function subjectValues(input = {}) {
  return {
    subjectCode: typeof input.subjectCode === 'string' ? input.subjectCode.slice(0, 50) : '',
    subjectName: typeof input.subjectName === 'string' ? input.subjectName.slice(0, 200) : '',
    units: typeof input.units === 'string' || typeof input.units === 'number' ? String(input.units).slice(0, 6) : ''
  };
}

function createAcademicRecordsRouter({ getPool, sql, academicRecordsService } = {}) {
  const router = express.Router();
  const service = academicRecordsService || createAcademicRecordsService({ getPool, sql });

  async function renderSubjects(req, res, { status = 200, error = null, values = {} } = {}) {
    try {
      const subjects = await service.listSubjects();
      return res.status(status).render('records/subjects', {
        title: 'Subject Catalog',
        csrfToken: ensureCsrfToken(req),
        currentUser: req.authUser,
        subjects,
        values: subjectValues(values),
        error,
        notice: notices[req.query.notice] || null
      });
    } catch {
      return res.status(503).render('error', { title: 'Service Unavailable', message: 'The subject catalog could not be loaded.' });
    }
  }

  async function renderAcademicRecord(req, res, studentId, { status = 200, error = null } = {}) {
    try {
      const record = await service.getStudentAcademicRecord(studentId);
      if (!record) return res.status(404).render('error', { title: 'Not Found', message: 'Student record not found.' });
      return res.status(status).render('records/student-academic', {
        title: 'Student Academic Records',
        csrfToken: ensureCsrfToken(req),
        currentUser: req.authUser,
        ...record,
        error,
        notice: notices[req.query.notice] || null
      });
    } catch (loadError) {
      if (loadError instanceof AcademicRecordsError) {
        return res.status(loadError.status).render('error', {
          title: loadError.status === 404 ? 'Not Found' : 'Invalid Request',
          message: loadError.message
        });
      }
      return res.status(503).render('error', { title: 'Service Unavailable', message: 'The academic record could not be loaded.' });
    }
  }

  router.get('/subjects', (req, res) => renderSubjects(req, res));

  router.post('/subjects', requireRole('database_admin', 'registrar'), async (req, res) => {
    if (!hasValidCsrfToken(req)) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'The form session expired. Reload the page and try again.' });
    }
    const values = subjectValues(req.body);
    try {
      await service.saveSubject(req.authUser.id, null, req.body);
      return res.redirect(303, '/records/subjects?notice=subjectCreated');
    } catch (error) {
      if (error instanceof AcademicRecordsError) return renderSubjects(req, res, { status: error.status, error: error.message, values });
      if (isUniqueConflict(error)) return renderSubjects(req, res, { status: 409, error: 'That subject code is already in use.', values });
      return res.status(503).render('error', { title: 'Service Unavailable', message: 'The subject could not be created.' });
    }
  });

  router.post('/subjects/:id', requireRole('database_admin', 'registrar'), async (req, res) => {
    if (!hasValidCsrfToken(req)) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'The form session expired. Reload the page and try again.' });
    }
    const subjectId = normalizeId(req.params.id);
    if (!subjectId) return res.status(404).render('error', { title: 'Not Found', message: 'Subject not found.' });
    try {
      await service.saveSubject(req.authUser.id, subjectId, req.body);
      return res.redirect(303, '/records/subjects?notice=subjectUpdated');
    } catch (error) {
      if (error instanceof AcademicRecordsError) return renderSubjects(req, res, { status: error.status, error: error.message, values: req.body });
      if (isUniqueConflict(error)) return renderSubjects(req, res, { status: 409, error: 'That subject code is already in use.', values: req.body });
      return res.status(503).render('error', { title: 'Service Unavailable', message: 'The subject could not be updated.' });
    }
  });

  router.get('/students/:id/academic', async (req, res) => {
    const studentId = normalizeId(req.params.id);
    if (!studentId) return res.status(404).render('error', { title: 'Not Found', message: 'Student record not found.' });
    return renderAcademicRecord(req, res, studentId);
  });

  router.post('/student-subjects', requireRole('database_admin', 'registrar'), async (req, res) => {
    if (!hasValidCsrfToken(req)) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'The form session expired. Reload the page and try again.' });
    }
    const studentId = normalizeId(req.body?.studentId);
    if (!studentId) return res.status(400).render('error', { title: 'Invalid Request', message: 'Choose a valid student record.' });
    try {
      const savedStudentId = await service.assignSubject(req.authUser.id, req.body);
      return res.redirect(303, `/records/students/${savedStudentId}/academic?notice=subjectAssigned`);
    } catch (error) {
      if (error instanceof AcademicRecordsError) return renderAcademicRecord(req, res, studentId, { status: error.status, error: error.message });
      if (isUniqueConflict(error)) return renderAcademicRecord(req, res, studentId, { status: 409, error: 'This subject is already assigned to the enrollment.' });
      return res.status(503).render('error', { title: 'Service Unavailable', message: 'The subject could not be assigned.' });
    }
  });

  router.post('/grades', requireRole('database_admin', 'registrar'), async (req, res) => {
    if (!hasValidCsrfToken(req)) {
      return res.status(403).render('error', { title: 'Forbidden', message: 'The form session expired. Reload the page and try again.' });
    }
    const studentId = normalizeId(req.body?.studentId);
    if (!studentId) return res.status(400).render('error', { title: 'Invalid Request', message: 'Choose a valid student record.' });
    try {
      const savedStudentId = await service.saveGrade(req.authUser.id, req.body);
      return res.redirect(303, `/records/students/${savedStudentId}/academic?notice=gradeSaved`);
    } catch (error) {
      if (error instanceof AcademicRecordsError) return renderAcademicRecord(req, res, studentId, { status: error.status, error: error.message });
      if (isUniqueConflict(error)) return renderAcademicRecord(req, res, studentId, { status: 409, error: 'A grade for this enrollment subject and grading period already exists.' });
      return res.status(503).render('error', { title: 'Service Unavailable', message: 'The grade could not be saved.' });
    }
  });

  return router;
}

module.exports = { createAcademicRecordsRouter, subjectValues };
