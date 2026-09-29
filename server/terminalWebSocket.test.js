const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { once, EventEmitter } = require('events');
const express = require('express');
const session = require('express-session');
const WebSocket = require('ws');
const TerminalService = require('./services/terminalService');
const attachTerminalWebSocket = require('./terminalWebSocket');

async function fixture(t, { authEnabled = true, heartbeatMs = 30000 } = {}) {
  const app = express();
  const sessionMiddleware = session({ secret: 'terminal-test-secret', resave: false, saveUninitialized: false });
  app.use(sessionMiddleware);
  app.post('/login', (req, res) => {
    req.session.authenticated = true;
    req.session.username = 'test';
    res.json({ success: true });
  });
  app.post('/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  const terminal = new EventEmitter();
  terminal.kills = 0;
  terminal.input = [];
  terminal.write = data => terminal.input.push(data);
  terminal.resize = (cols, rows) => { terminal.size = [cols, rows]; };
  terminal.kill = () => { terminal.kills++; };
  terminal.onData = listener => { terminal.on('data', listener); return { dispose: () => terminal.off('data', listener) }; };
  terminal.onExit = listener => { terminal.on('exit', listener); return { dispose: () => terminal.off('exit', listener) }; };
  let spawns = 0;
  const service = new TerminalService({
    authEnabled,
    localProvider: { stat: async () => ({ type: 'folder' }), realpath: async value => value },
    sshManager: {}, shellSelector: () => ({ file: 'fake-shell', args: [] }),
    ptyFactory: () => ({ spawn: () => { spawns++; return terminal; } }),
  });
  const transport = attachTerminalWebSocket({ server, sessionMiddleware, terminalService: service, authEnabled, heartbeatMs });
  const clients = new Set();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    for (const client of clients) client.terminate();
    transport.close();
    await new Promise(resolve => server.close(resolve));
  });
  async function login() {
    const response = await fetch(`${origin}/login`, { method: 'POST' });
    return response.headers.get('set-cookie').split(';')[0];
  }
  function connect({ cookie, clientOrigin = origin, endpoint = '/api/terminal', autoPong = true } = {}) {
    const client = new WebSocket(origin.replace('http:', 'ws:') + endpoint, {
      headers: { ...(cookie ? { Cookie: cookie } : {}), Origin: clientOrigin }, autoPong,
    });
    clients.add(client);
    client.messages = [];
    client.on('message', data => client.messages.push(JSON.parse(data.toString())));
    client.on('error', () => {});
    return client;
  }
  return { origin, terminal, service, transport, login, connect, spawns: () => spawns };
}

async function waitFor(predicate) {
  for (let i = 0; i < 200; i++) {
    const result = predicate();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for terminal event');
}

test('shared express-session rejects missing and forged cookies at upgrade', async t => {
  const f = await fixture(t);
  for (const cookie of [undefined, 'connect.sid=forged']) {
    const socket = f.connect({ cookie });
    const [, response] = await once(socket, 'unexpected-response');
    assert.equal(response.statusCode, 401);
    response.resume();
    socket.terminate();
  }
  assert.equal(f.spawns(), 0);
  assert.equal((await fetch(`${f.origin}/health`)).status, 200);
});

test('authenticated WebSocket opens local PTY and supports bidirectional protocol', async t => {
  const f = await fixture(t);
  const socket = f.connect({ cookie: await f.login() });
  await once(socket, 'open');
  socket.send(JSON.stringify({ type: 'open', provider: 'local', cwd: '/allowed', cols: 100, rows: 40 }));
  await waitFor(() => socket.messages.some(message => message.type === 'ready'));
  assert.equal(f.spawns(), 1);
  socket.send(JSON.stringify({ type: 'input', data: 'hello\r' }));
  await waitFor(() => f.terminal.input.length);
  assert.deepEqual(f.terminal.input, ['hello\r']);
  f.terminal.emit('data', 'hello\r\n');
  await waitFor(() => socket.messages.some(message => message.type === 'output'));
  socket.send(JSON.stringify({ type: 'resize', cols: 120, rows: 30 }));
  await waitFor(() => f.terminal.size);
  assert.deepEqual(f.terminal.size, [120, 30]);
  const closed = once(socket, 'close');
  f.terminal.emit('exit', { exitCode: 0 });
  const [code] = await closed;
  assert.equal(code, 1000);
  assert.deepEqual(socket.messages.at(-1), { type: 'exit', code: 0, signal: null });
  assert.equal(f.service.sessions.size, 0);
});

test('WebSocket close kills the running local shell', async t => {
  const f = await fixture(t);
  const socket = f.connect({ cookie: await f.login() });
  await once(socket, 'open');
  socket.send(JSON.stringify({ type: 'open', provider: 'local', cwd: '/allowed' }));
  await waitFor(() => f.spawns());
  socket.close();
  await once(socket, 'close');
  await waitFor(() => f.terminal.kills === 1);
  assert.equal(f.service.sessions.size, 0);
});

test('cross-origin upgrades rejected even with a valid cookie; unknown endpoint rejected', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  for (const [options, status] of [[{ clientOrigin: 'https://attacker.example' }, 403], [{ endpoint: '/other' }, 404]]) {
    const socket = f.connect({ cookie, ...options });
    const [, response] = await once(socket, 'unexpected-response');
    assert.equal(response.statusCode, status);
    response.resume();
    socket.terminate();
  }
  assert.equal(f.spawns(), 0);
});

test('logout invalidates the cookie for new terminal upgrades', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  await fetch(`${f.origin}/logout`, { method: 'POST', headers: { Cookie: cookie } });
  const socket = f.connect({ cookie });
  const [, response] = await once(socket, 'unexpected-response');
  assert.equal(response.statusCode, 401);
  response.resume();
  socket.terminate();
});

test('explicit auth-disabled configuration uses the same transport without login', async t => {
  const f = await fixture(t, { authEnabled: false });
  const socket = f.connect();
  await once(socket, 'open');
  socket.send(JSON.stringify({ type: 'open', provider: 'local', cwd: '/allowed' }));
  await waitFor(() => f.spawns());
  assert.equal(f.spawns(), 1);
});

test('payload limit closes the socket and kills its PTY', async t => {
  const f = await fixture(t);
  const socket = f.connect({ cookie: await f.login() });
  await once(socket, 'open');
  socket.send(JSON.stringify({ type: 'open', provider: 'local', cwd: '/allowed' }));
  await waitFor(() => f.spawns());
  socket.send('x'.repeat(70 * 1024));
  const [code] = await once(socket, 'close');
  assert.equal(code, 1009);
  await waitFor(() => f.terminal.kills === 1);
});

test('heartbeat removes disconnected clients and kills orphan PTYs', async t => {
  const f = await fixture(t, { heartbeatMs: 50 });
  const socket = f.connect({ cookie: await f.login(), autoPong: false });
  await once(socket, 'open');
  socket.send(JSON.stringify({ type: 'open', provider: 'local', cwd: '/allowed' }));
  await waitFor(() => f.spawns());
  await once(socket, 'close');
  await waitFor(() => f.terminal.kills === 1);
  assert.equal(f.service.sessions.size, 0);
});

test('server shutdown disposes shells and active sockets', async t => {
  const f = await fixture(t);
  const socket = f.connect({ cookie: await f.login() });
  await once(socket, 'open');
  socket.send(JSON.stringify({ type: 'open', provider: 'local', cwd: '/allowed' }));
  await waitFor(() => f.spawns());
  const closed = once(socket, 'close');
  f.transport.close();
  await closed;
  assert.equal(f.terminal.kills, 1);
  assert.equal(f.service.sessions.size, 0);
});
