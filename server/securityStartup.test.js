const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { once } = require('events');
const { spawn, spawnSync } = require('child_process');

const testSecret = 'test-only-security-startup-secret-over-32-characters';
const env = changes => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('WC_'))),
  NODE_ENV: 'production', WC_AUTH_ENABLED: 'true', WC_AUTH_USERS: JSON.stringify([{ username: 'operator', password: 'test-only' }]),
  WC_SESSION_SECRET: testSecret, WC_ALLOW_MEMORY_SESSION_STORE: 'true', ...changes });

test('real production startup rejects insecure configuration before listening without exposing secrets', () => {
  for (const [changes, expected] of [
    [{ WC_AUTH_USERS: '[secret-in-invalid-json' }, /WC_AUTH_USERS must contain valid JSON/],
    [{ WC_AUTH_USERS: JSON.stringify([{ username: 'admin', password: 'admin123' }]) }, /Default development credentials/],
    [{ WC_SESSION_SECRET: 'change-this-secret-key-in-production' }, /Placeholder session secret/],
    [{ WC_SESSION_SECRET: '' }, /Session secret is required/],
    [{ WC_ALLOW_MEMORY_SESSION_STORE: 'false' }, /MemoryStore requires explicit/],
  ]) {
    const result = spawnSync(process.execPath, ['server/index.js'], { cwd: path.resolve(__dirname, '..'),
      env: env(changes), windowsHide: true, encoding: 'utf8', timeout: 5000 });
    assert.notEqual(result.status, 0);
    assert.equal(result.error, undefined);
    const output = result.stdout + result.stderr;
    assert.match(output, expected);
    assert.doesNotMatch(output, /WebCommander server running/);
    assert.equal(output.includes(testSecret), false);
    assert.equal(output.includes('secret-in-invalid-json'), false);
  }
});

async function fixture(t, changes = {}) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webcommander-security-'));
  const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const child = spawn(process.execPath, ['server/index.js'], { cwd: path.resolve(__dirname, '..'), windowsHide: true,
    env: env({ WC_PORT: String(port), WC_ROOT_PATH: root, WC_ALLOWED_PATHS: root, WC_BLOCKED_PATHS: path.join(root, 'blocked'),
      WC_CORS_ORIGINS: '', WC_TRUST_PROXY: '1', ...changes }), stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  t.after(async () => {
    child.kill(); await exited;
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('webcommander-security-'));
    await fs.promises.rm(root, { recursive: true, force: true });
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Startup timed out')), 5000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Server failed to start')); });
    child.stdout.on('data', () => { if (output.includes('WebCommander server running')) { clearTimeout(timeout); resolve(); } });
  });
  return { base: `http://127.0.0.1:${port}/api`, output: () => output };
}

test('production HTTPS proxy cookie policy and same-origin CORS default apply in actual server', async t => {
  const f = await fixture(t);
  const login = await fetch(f.base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
    body: JSON.stringify({ username: 'operator', password: 'test-only' }) });
  assert.equal(login.status, 200);
  const header = login.headers.get('set-cookie');
  assert.match(header, /^webcommander.sid=/); assert.match(header, /HttpOnly/); assert.match(header, /SameSite=Lax/); assert.match(header, /Secure/);
  const response = await fetch(f.base + '/auth/check', { headers: { Origin: 'https://unknown.example', Cookie: header.split(';')[0] } });
  assert.equal((await response.json()).authenticated, true);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  assert.equal(f.output().includes(testSecret), false);
  assert.equal(f.output().includes('test-only'), false);
  assert.match(f.output(), /"sessionStore":"MemoryStore"/);
});

test('CORS credentials are sent only for exact approved origins, including preflight', async t => {
  const f = await fixture(t, { WC_CORS_ORIGINS: 'https://approved.example', WC_COOKIE_SECURE: 'false' });
  for (const origin of ['https://approved.example', 'https://approved.example.evil', 'https://unknown.example']) {
    const response = await fetch(f.base + '/auth/check', { headers: { Origin: origin } });
    const approved = origin === 'https://approved.example';
    assert.equal(response.headers.get('access-control-allow-origin'), approved ? origin : null);
    assert.equal(response.headers.get('access-control-allow-credentials'), approved ? 'true' : null);
    const preflight = await fetch(f.base + '/auth/login', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } });
    assert.equal(preflight.headers.get('access-control-allow-credentials'), approved ? 'true' : null);
  }
});

test('local development launcher can serve built frontend on loopback without production bypass', async t => {
  const f = await fixture(t, { NODE_ENV: 'development', WC_HOST: '127.0.0.1', WC_SERVE_STATIC: 'true',
    WC_AUTH_USERS: JSON.stringify([{ username: 'admin', password: 'admin123' }]),
    WC_SESSION_SECRET: 'change-this-secret-key-in-production', WC_ALLOW_MEMORY_SESSION_STORE: 'false' });
  const response = await fetch(f.base.replace(/\/api$/, '/'));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<!doctype html>/i);
  assert.match(f.output(), /not allowed in production/);
});
