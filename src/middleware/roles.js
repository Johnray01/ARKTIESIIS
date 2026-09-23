function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const role = req.authUser?.role;
    if (!role) return res.status(401).send('Unauthorized');
    if (!allowedRoles.includes(role)) return res.status(403).send('Forbidden');
    next();
  };
}

module.exports = { requireRole };
