const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { once } = require('events');

test('Commander file APIs create exclusively, rename files and directories, and return properties for Local and SFTP', { timeout: 15000 }, async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webcommander-commander-api-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('webcommander-commander-api-'));
    await fs.promises.rm(root, { recursive: true, force: true });
  });
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const child = spawn(process.execPath, ['-e', `
    const { EventEmitter } = require('events');
    const fs = require('fs');
    const path = require('path');
    const remoteRoot = path.join(process.env.WC_ROOT_PATH, 'remote');
    fs.mkdirSync(remoteRoot);
    const local = value => path.join(remoteRoot, path.posix.relative('/home/test', value));
    const attrs = stats => ({ size: stats.size, mode: stats.mode, mtime: Math.floor(stats.mtimeMs / 1000),
      uid: 1000, gid: 1001, isDirectory: () => stats.isDirectory() });
    const sftp = {
      realpath(_value, callback) { callback(null, '/home/test'); },
      stat(value, callback) { fs.stat(local(value), (error, stats) => callback(error, error ? undefined : attrs(stats))); },
      lstat(value, callback) { fs.lstat(local(value), (error, stats) => callback(error, error ? undefined : attrs(stats))); },
      rename(from, to, callback) { fs.rename(local(from), local(to), callback); },
      createWriteStream(value, options) { return fs.createWriteStream(local(value), options); },
    };
    require('ssh2').Client = class extends EventEmitter {
      connect() { queueMicrotask(() => this.emit('ready')); }
      end() { queueMicrotask(() => this.emit('close')); }
      sftp(callback) { callback(null, sftp); }
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
  assert.equal((await post('/files/create', { provider: 'local', directory: root, name: 'new.txt' })).status, 401);
  const login = await post('/auth/login', { username: 'archive-test', password: 'test-only' });
  cookie = login.headers.get('set-cookie').split(';')[0];
  const get = endpoint => fetch(base + endpoint, { headers: { Cookie: cookie } });
  assert.equal((await post('/ssh/connect', { sessionId: 'remote', host: 'host', username: 'user', password: 'test' })).status, 200);
  for (const provider of ['local', 'sftp']) {
    const directory = provider === 'local' ? root : '/home/test';
    const disk = provider === 'local' ? root : path.join(root, 'remote');
    const create = name => post('/files/create', { provider, directory, name, sessionId: 'remote' });
    for (const name of ['../escape', 'a/b', 'a\\b', '.', '..', 'bad:', 'bad.', 'bad ']) {
      assert.equal((await create(name)).status, 400);
    }
    const created = await create('new.txt');
    assert.equal(created.status, 200);
    const filePath = (await created.json()).path;
    assert.equal(await fs.promises.readFile(path.join(disk, 'new.txt'), 'utf8'), '');
    await fs.promises.writeFile(path.join(disk, 'new.txt'), 'preserve existing bytes');
    assert.equal((await create('new.txt')).status, 409);
    assert.equal(await fs.promises.readFile(path.join(disk, 'new.txt'), 'utf8'), 'preserve existing bytes');
    const races = await Promise.all([create('race.txt'), create('race.txt')]);
    assert.deepEqual(races.map(response => response.status).sort(), [200, 409]);
    await fs.promises.mkdir(path.join(disk, 'folder'));
    assert.equal((await create('folder')).status, 409);
    for (const [name, type] of [['new.txt', 'file'], ['folder', 'folder']]) {
      const original = provider === 'local' ? path.join(root, name) : '/home/test/' + name;
      const destination = provider === 'local' ? path.join(root, 'renamed-' + name) : '/home/test/renamed-' + name;
      const renamed = provider === 'local'
        ? await post('/files/rename', { path: original, newName: 'renamed-' + name })
        : await post('/ssh/files/rename', { sessionId: 'remote', path: original, newPath: destination });
      assert.equal(renamed.status, 200);
      assert.equal(await fs.promises.stat(path.join(disk, 'renamed-' + name)).then(stats => stats.isDirectory()), type === 'folder');
      const endpoint = provider === 'local' ? '/files/info?path=' : '/ssh/files/info?sessionId=remote&path=';
      const response = await get(endpoint + encodeURIComponent(destination));
      assert.equal(response.status, 200);
      const info = await response.json();
      assert.equal(info.name, 'renamed-' + name);
      assert.equal(info.path, destination);
      assert.equal(info.type, type);
      assert.equal(typeof info.size, 'number');
      assert.equal(typeof info.modified, 'string');
      assert.equal(typeof info.permissions, 'string');
      assert.equal(typeof info.uid, 'number'); assert.equal(typeof info.gid, 'number');
    }
  }
});
