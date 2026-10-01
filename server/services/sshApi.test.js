const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { once } = require('events');

test('SSH HTTP sessions survive rediscovery and enforce browser ownership across routes', { timeout: 15000 }, async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webcommander-archive-api-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('webcommander-archive-api-'));
    await fs.promises.rm(root, { recursive: true, force: true });
  });
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const child = spawn(process.execPath, ['-e', `
    const { EventEmitter } = require('events');
    require('ssh2').Client = class extends EventEmitter {
      connect() { queueMicrotask(() => this.emit('ready')); }
      end() { queueMicrotask(() => this.emit('close')); }
      sftp(callback) { callback(new Error('Unexpected SFTP access in ownership test')); }
    };
    require('./server/index');
  `], {
    cwd: path.resolve(__dirname, '../..'),
    windowsHide: true,
    env: {
      ...process.env, NODE_ENV: 'test', WC_PORT: String(port), WC_ROOT_PATH: root,
      WC_ALLOWED_PATHS: root, WC_BLOCKED_PATHS: path.join(root, 'blocked'), WC_AUTH_ENABLED: 'true',
      WC_AUTH_USERS: JSON.stringify([{ username: 'archive-test', password: 'test-only' }]),
      WC_SESSION_SECRET: 'archive-test-session-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  t.after(async () => {
    child.kill();
    await exited;
  });
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => reject(new Error(`Server exited early: ${code}`)));
    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('WebCommander server running')) resolve();
    });
  });
  const base = `http://127.0.0.1:${port}/api`;
  let cookie = '';
  const post = (endpoint, body) => fetch(base + endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
  const login = await post('/auth/login', { username: 'archive-test', password: 'test-only' });
  cookie = login.headers.get('set-cookie').split(';')[0];
  const ownerCookie = cookie;
  const get = endpoint => fetch(base + endpoint, { headers: { Cookie: cookie } });
  const connection = { sessionId: 'owned', host: 'host', username: 'user', password: 'never-return' };
  assert.equal((await post('/ssh/connect', connection)).status, 200);
  assert.equal((await post('/ssh/connect', connection)).status, 409);
  const sessions = await (await get('/ssh/sessions')).json();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionId, 'owned');
  assert.equal(JSON.stringify(sessions).includes('never-return'), false);
  assert.deepEqual(await (await get('/ssh/sessions')).json(), sessions);
  cookie = '';
  const otherLogin = await post('/auth/login', { username: 'archive-test', password: 'test-only' });
  cookie = otherLogin.headers.get('set-cookie').split(';')[0];
  assert.notEqual(cookie, ownerCookie);
  assert.deepEqual(await (await get('/ssh/sessions')).json(), []);
  for (const route of ['/ssh/files', '/ssh/files/read', '/ssh/files/info', '/ssh/files/download']) {
    const response = await get(route + '?sessionId=owned&path=/file');
    assert.equal(response.status, 404, route);
    assert.equal((await response.json()).code, 'SSH_SESSION_NOT_FOUND');
  }
  for (const [route, body] of [
    ['/ssh/disconnect', {}], ['/ssh/files/write', { content: 'x' }], ['/ssh/files/mkdir', {}],
    ['/ssh/files/delete', {}], ['/ssh/files/rename', { newPath: '/new' }], ['/ssh/files/upload', {}],
    ['/ssh/exec', { command: 'no' }], ['/ssh/transfer', { sourcePath: '/a', destPath: '/b', direction: 'upload' }],
    ['/archives/create', { provider: 'sftp', sources: ['/file'], destination: '/a.zip' }],
    ['/archives/extract', { provider: 'sftp', archive: '/a.zip', destination: '/out' }],
    ['/files/create', { provider: 'sftp', directory: '/home', name: 'new.txt' }],
    ['/transfers', { operation: 'copy', source: { provider: 'sftp', sessionId: 'owned', path: '/a' }, destination: { provider: 'local', path: root } }],
    ['/transfers', { operation: 'copy', source: { provider: 'local', path: root }, destination: { provider: 'sftp', sessionId: 'owned', path: '/a' } }],
  ]) {
    const response = await post(route, { sessionId: 'owned', path: '/file', ...body });
    assert.equal(response.status, 404, route);
    assert.equal((await response.json()).code, 'SSH_SESSION_NOT_FOUND');
  }
  cookie = ownerCookie;
  assert.equal((await (await get('/ssh/sessions')).json()).length, 1);
  assert.equal((await post('/ssh/disconnect', { sessionId: 'owned' })).status, 200);
  assert.deepEqual(await (await get('/ssh/sessions')).json(), []);
  assert.equal((await get('/ssh/files?sessionId=owned&path=/')).status, 404);

  // Keep a second browser session alive while logging out the first.
  cookie = otherLogin.headers.get('set-cookie').split(';')[0];
  assert.equal((await post('/ssh/connect', { ...connection, sessionId: 'other' })).status, 200);
  cookie = ownerCookie;
  for (const sessionId of ['logout-one', 'logout-two']) {
    assert.equal((await post('/ssh/connect', { ...connection, sessionId })).status, 200);
  }
  assert.equal((await (await get('/ssh/sessions')).json()).length, 2);
  const logout = await post('/auth/logout', {});
  assert.equal(logout.status, 200);
  assert.deepEqual(await logout.json(), { success: true });
  assert.equal((await get('/ssh/sessions')).status, 401);

  const relogin = await post('/auth/login', { username: 'archive-test', password: 'test-only' });
  cookie = relogin.headers.get('set-cookie').split(';')[0];
  assert.notEqual(cookie, ownerCookie);
  assert.deepEqual(await (await get('/ssh/sessions')).json(), []);
  // Reusing IDs proves the old sessions were removed, not merely hidden by ownership.
  for (const sessionId of ['logout-one', 'logout-two']) {
    assert.equal((await post('/ssh/connect', { ...connection, sessionId })).status, 200);
  }
  assert.equal((await post('/auth/logout', {})).status, 200);
  assert.deepEqual(await (await post('/auth/logout', {})).json(), { success: true });
  cookie = otherLogin.headers.get('set-cookie').split(';')[0];
  assert.deepEqual((await (await get('/ssh/sessions')).json()).map(item => item.sessionId), ['other']);
});
