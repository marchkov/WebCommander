const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { once } = require('events');

test('archive HTTP endpoints validate requests, enforce auth, and create/extract local ZIPs', { timeout: 15000 }, async t => {
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
  const child = spawn(process.execPath, ['server/index.js'], {
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
  const source = path.join(root, 'notes.txt');
  const archive = path.join(root, 'notes.zip');
  const destination = path.join(root, 'extracted');
  await fs.promises.writeFile(source, 'HTTP round trip');
  const create = { provider: 'local', sources: [source], destination: archive };
  assert.equal((await post('/archives/create', create)).status, 401);
  assert.equal((await post('/archives/extract', { provider: 'local', archive, destination })).status, 401);
  const login = await post('/auth/login', { username: 'archive-test', password: 'test-only' });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
  for (const body of [{ ...create, provider: 'ftp' }, { ...create, sources: [42] }, { ...create, destination: {} },
    { ...create, provider: 'sftp' }]) {
    assert.equal((await post('/archives/create', body)).status, 400);
  }
  assert.equal((await post('/archives/extract', { provider: 'local', archive, destination, overwrite: 'false' })).status, 400);
  const created = await post('/archives/create', create);
  assert.equal(created.status, 200);
  assert.equal((await created.json()).success, true);
  assert.equal((await post('/archives/create', create)).status, 409);
  assert.equal((await post('/archives/create', { ...create, destination: path.join(root, '..', 'outside.zip') })).status, 403);
  const extract = { provider: 'local', archive, destination, overwrite: false };
  assert.equal((await post('/archives/extract', extract)).status, 200);
  assert.equal(await fs.promises.readFile(path.join(destination, 'notes.txt'), 'utf8'), 'HTTP round trip');
  assert.equal((await post('/archives/extract', extract)).status, 409);
  assert.equal((await post('/archives/extract', { ...extract, overwrite: true })).status, 200);
});
