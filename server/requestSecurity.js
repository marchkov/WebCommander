const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function requestSecurity({ authEnabled = true, corsOrigins = [] } = {}) {
  return (req, res, next) => {
    if (!MUTATING_METHODS.has(req.method) ||
        (authEnabled && !req.session?.authenticated && !/^\/auth\/login\/?$/i.test(req.path))) return next();
    const origin = req.get('Origin');
    // Express protocol/host honor forwarded headers only from a trusted proxy.
    const effectiveOrigin = `${req.protocol}://${req.host}`;
    if (req.get('Sec-Fetch-Site') === 'cross-site' ||
        (origin && origin !== effectiveOrigin && !corsOrigins.includes(origin))) {
      return res.status(403).json({ error: 'Cross-origin request rejected', code: 'INVALID_ORIGIN' });
    }
    // Non-browser clients commonly send neither Origin nor Fetch Metadata.
    next();
  };
}

module.exports = requestSecurity;
