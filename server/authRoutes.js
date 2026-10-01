const { createHash, timingSafeEqual } = require('crypto');

function equalCredential(supplied, configured) {
  if (typeof supplied !== 'string' || typeof configured !== 'string') return false;
  const digest = value => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(supplied), digest(configured));
}

function registerAuthRoutes(app, { auth, sshManager, cookieOptions }) {
  app.post('/api/auth/login', (req, res) => {
    let username = 'anonymous';
    if (auth.enabled) {
      const supplied = req.body || {};
      let match;
      // Compare fixed-size digests for every configured user without an early password-match exit.
      for (const user of auth.users) {
        const nameMatches = equalCredential(supplied.username, user?.username);
        const passwordMatches = equalCredential(supplied.password, user?.password);
        if (nameMatches && passwordMatches) match = user;
      }
      if (!match) return res.status(401).json({ error: 'Invalid credentials' });
      username = match.username;
    }
    req.session.regenerate(error => {
      if (error) return res.status(500).json({ error: 'Failed to establish web session' });
      req.session.authenticated = true;
      req.session.username = username;
      req.session.save(error => {
        if (error) return res.status(500).json({ error: 'Failed to save web session' });
        res.json({ success: true, username });
      });
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    sshManager.disconnectByOwner(req.sessionID);
    req.session.destroy(error => {
      if (error) return res.status(500).json({ error: 'Failed to destroy web session' });
      res.clearCookie(auth.cookieName, cookieOptions);
      res.json({ success: true });
    });
  });

  app.get('/api/auth/check', (req, res) => {
    if (!auth.enabled) return res.json({ authenticated: true, username: 'anonymous' });
    res.json({ authenticated: Boolean(req.session?.authenticated), username: req.session?.username ?? null });
  });
}

module.exports = { registerAuthRoutes, equalCredential };
