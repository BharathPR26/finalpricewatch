function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  console.log('[Auth] Rejected - no session. Path:', req.path);
  return res.status(401).json({ error: 'Not authenticated. Please log in.' });
}

module.exports = { requireAuth };