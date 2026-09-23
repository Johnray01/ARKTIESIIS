function errorHandler(err, req, res, next) {
  console.error('Request failed.');
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  res.status(status).render('error', {
    title: status === 404 ? 'Not Found' : 'Error',
    message: status < 500 ? err.message : 'Something went wrong.'
  });
}

module.exports = { errorHandler };
