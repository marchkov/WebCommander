const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('events');
const requestSecurity = require('./requestSecurity');

test('Origin protection covers browser writes and login, preserves safe methods and CLI, and honors trust proxy', async t => {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use((req, _res, next) => { req.session = { authenticated: req.get('Cookie') === 'authenticated' }; next(); });
  app.use('/api', requestSecurity({ corsOrigins: ['https://approved.example'] }));
  app.use((_req, res) => res.json({ success: true }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const cases = [
    ['same origin', 'POST', { Origin: base }, 200],
    ['approved origin', 'PUT', { Origin: 'https://approved.example' }, 200],
    ['unknown origin', 'PATCH', { Origin: 'https://evil.example' }, 403],
    ['lookalike origin', 'DELETE', { Origin: 'https://approved.example.evil' }, 403],
    ['cross-site metadata', 'POST', { Origin: base, 'Sec-Fetch-Site': 'cross-site' }, 403],
    ['metadata without origin', 'POST', { 'Sec-Fetch-Site': 'cross-site' }, 403],
    ['safe GET', 'GET', { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }, 200],
    ['safe HEAD', 'HEAD', { Origin: 'https://evil.example' }, 200],
    ['CLI', 'POST', {}, 200],
    ['proxy HTTPS', 'POST', { Origin: 'https://host.example:8443', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'host.example:8443' }, 200],
    ['null origin', 'POST', { Origin: 'null' }, 403],
  ];
  for (const [name, method, headers, status] of cases) await t.test(name, async () => {
    const response = await fetch(base + '/api/files/write', { method, headers: { Cookie: 'authenticated', ...headers } });
    assert.equal(response.status, status);
    if (status === 403) assert.deepEqual(await response.json(), { error: 'Cross-origin request rejected', code: 'INVALID_ORIGIN' });
  });
  for (const headers of [{ Origin: base }, { Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }, {}]) {
    const response = await fetch(base + '/api/auth/login', { method: 'POST', headers });
    assert.equal(response.status, headers.Origin === 'https://evil.example' || headers['Sec-Fetch-Site'] ? 403 : 200);
  }
  // Forwarded headers from an untrusted peer must not redefine the same origin.
  for (const route of ['/api/auth/login/', '/API/AUTH/LOGIN']) {
    assert.equal((await fetch(base + route, { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403);
  }
  app.set('trust proxy', false);
  assert.equal((await fetch(base + '/api/files/write', { method: 'POST', headers: {
    Cookie: 'authenticated', Origin: 'https://host.example', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'host.example',
  } })).status, 403);
  assert.equal((await fetch(base + '/asset.js', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 200);
});
