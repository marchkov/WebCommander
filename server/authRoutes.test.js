const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { once } = require('events');
const express = require('express');
const session = require('express-session');
const WebSocket = require('ws');
const { resolveAuthConfig, sessionSettings } = require('./configSecurity');
const { registerAuthRoutes, equalCredential } = require('./authRoutes');
const attachTerminalWebSocket = require('./terminalWebSocket');

async function fixture(t, secure = false) {
  const auth = resolveAuthConfig({ auth: { users: [{ username: 'operator', password: 'test-only' }],
    sessionSecret: 'test-only-secret-with-more-than-32-characters', cookieName: 'test.sid' } }, { NODE_ENV: 'test', WC_COOKIE_SECURE: String(secure) });
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  const { options, cookieOptions } = sessionSettings(auth);
  const middleware = session(options);
  app.use(middleware);
  app.get('/prelogin', (req, res) => { req.session.marker = true; res.json({ id: req.sessionID }); });
  const closedOwners = [];
  registerAuthRoutes(app, { auth, cookieOptions, sshManager: { disconnectByOwner: owner => closedOwners.push(owner) } });
  const server = http.createServer(app);
  const transport = attachTerminalWebSocket({ server, sessionMiddleware: middleware, terminalService: {
    attach(socket, req) { socket.send(JSON.stringify({ authenticated: req.session.authenticated, id: req.sessionID })); },
    close() {},
  } });
  const clients = [];
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { for (const client of clients) client.terminate(); transport.close(); await new Promise(resolve => server.close(resolve)); });
  const request = (endpoint, cookie = '', body, forwarded = secure) => fetch(origin + endpoint, {
    method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json',
      ...(forwarded ? { 'X-Forwarded-Proto': 'https' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const socket = cookie => {
    const client = new WebSocket(origin.replace('http:', 'ws:') + '/api/terminal', { headers: { Cookie: cookie, Origin: origin } });
    client.on('error', () => {}); clients.push(client); return client;
  };
  return { request, socket, closedOwners };
}

test('credential comparison handles Unicode, lengths and malformed input without direct password equality', () => {
  assert.equal(equalCredential('пароль', 'пароль'), true);
  assert.equal(equalCredential('short', 'longer'), false);
  assert.equal(equalCredential('same-length-a', 'same-length-b'), false);
  assert.equal(equalCredential({}, 'password'), false);
  assert.equal(equalCredential('password', undefined), false);
});

test('login regenerates and saves session before HTTP/WS use; old session stays unauthenticated; logout clears it', async t => {
  const f = await fixture(t);
  const prelogin = await f.request('/prelogin');
  const oldId = (await prelogin.json()).id;
  const oldCookie = prelogin.headers.get('set-cookie').split(';')[0];
  const invalid = await f.request('/api/auth/login', oldCookie, { username: 'operator', password: 'wrong' });
  assert.equal(invalid.status, 401);
  const response = await f.request('/api/auth/login', oldCookie, { username: 'operator', password: 'test-only' });
  assert.equal(response.status, 200);
  const header = response.headers.get('set-cookie');
  assert.match(header, /^test.sid=/); assert.match(header, /HttpOnly/); assert.match(header, /SameSite=Lax/); assert.doesNotMatch(header, /Secure/);
  const cookie = header.split(';')[0]; assert.notEqual(cookie, oldCookie);
  assert.deepEqual(await (await f.request('/api/auth/check', cookie)).json(), { authenticated: true, username: 'operator' });
  assert.equal((await (await f.request('/api/auth/check', oldCookie)).json()).authenticated, false);
  const ws = f.socket(cookie); const message = once(ws, 'message'); await once(ws, 'open');
  const sessionData = JSON.parse((await message)[0]);
  assert.equal(sessionData.authenticated, true); assert.notEqual(sessionData.id, oldId);
  const oldSocket = f.socket(oldCookie);
  const [, denied] = await once(oldSocket, 'unexpected-response'); assert.equal(denied.statusCode, 401); denied.resume(); oldSocket.terminate();
  const logout = await f.request('/api/auth/logout', cookie, {});
  assert.equal(logout.status, 200);
  assert.deepEqual(await logout.json(), { success: true });
  assert.match(logout.headers.get('set-cookie'), /^test.sid=;/);
  assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.match(logout.headers.get('set-cookie'), /HttpOnly/);
  assert.match(logout.headers.get('set-cookie'), /SameSite=Lax/);
  assert.deepEqual(f.closedOwners, [sessionData.id]);
  assert.equal((await (await f.request('/api/auth/check', cookie)).json()).authenticated, false);
  assert.equal((await f.request('/api/auth/logout', '', {})).status, 200);
});

test('Secure cookies are issued only for HTTPS via the configured trusted proxy and cleared consistently', async t => {
  const f = await fixture(t, true);
  const login = { username: 'operator', password: 'test-only' };
  const plain = await f.request('/api/auth/login', '', login, false);
  assert.equal(plain.headers.get('set-cookie'), null);
  const secure = await f.request('/api/auth/login', '', login, true);
  const header = secure.headers.get('set-cookie'); assert.match(header, /Secure/);
  const logout = await f.request('/api/auth/logout', header.split(';')[0], {}, true);
  assert.match(logout.headers.get('set-cookie'), /Secure/);
});
