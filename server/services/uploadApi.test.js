const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { once } = require('events');

test('Uploads enforce name, path, extension, size and exclusive creation for Local and SFTP', { timeout: 15000 }, async t => {
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
      stat(value, callback) {
        if (value.includes('header-test')) return callback(null, { size: 4, mode: 0o100644 });
        fs.stat(local(value), (error, stats) => callback(error, error ? undefined : attrs(stats)));
      },
      lstat(value, callback) { fs.lstat(local(value), (error, stats) => callback(error, error ? undefined : attrs(stats))); },
      rename(from, to, callback) { fs.rename(local(from), local(to), callback); },
      createReadStream(value) {
        if (value.includes('header-test')) return require('stream').Readable.from(['safe']);
        return fs.createReadStream(local(value));
      },
      unlink(value, callback) { fs.unlink(local(value), callback); },
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
      WC_MAX_FILE_SIZE: '16', WC_ALLOWED_EXTENSIONS: '.txt,PNG,<none>',
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
  for (const route of ['/auth/login', '/auth/login/', '/AUTH/LOGIN']) {
    const rejected = await fetch(base + route, { method: 'POST', headers: {
      Origin: 'https://evil.example', 'Content-Type': 'application/json',
    }, body: JSON.stringify({ username: 'archive-test', password: 'test-only' }) });
    assert.equal(rejected.status, 403);
    assert.equal((await rejected.json()).code, 'INVALID_ORIGIN');
  }
  const login = await post('/auth/login', { username: 'archive-test', password: 'test-only' });
  cookie = login.headers.get('set-cookie').split(';')[0];
  const rejectedCreate = await fetch(base + '/files/create', { method: 'POST', headers: {
    Cookie: cookie, Origin: 'https://evil.example', 'Content-Type': 'application/json',
  }, body: JSON.stringify({ provider: 'local', directory: root, name: 'csrf.txt' }) });
  assert.equal(rejectedCreate.status, 403);
  assert.equal(fs.existsSync(path.join(root, 'csrf.txt')), false);
  const get = endpoint => fetch(base + endpoint, { headers: { Cookie: cookie } });
  assert.equal((await post('/ssh/connect', { sessionId: 'remote', host: 'host', username: 'user', password: 'test' })).status, 200);
  await fs.promises.mkdir(path.join(root, 'blocked'));
  const multipart = (name, data, directory, provider = 'local', sessionId = 'remote') => {
    const boundary = 'webcommander-test-boundary';
    // File first: destination fields are intentionally unavailable until parsing completes.
    const parts = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.from(data), Buffer.from('\r\n')];
    for (const [key, value] of Object.entries({ path: directory, provider, sessionId })) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return fetch(base + '/files/upload', { method: 'POST', headers: {
      Cookie: cookie, 'Content-Type': `multipart/form-data; boundary=${boundary}`,
    }, body: Buffer.concat(parts) });
  };
  for (const provider of ['local', 'sftp']) {
    const directory = provider === 'local' ? root : '/home/test';
    const disk = provider === 'local' ? root : path.join(root, 'remote');
    await t.test(`${provider}: binary upload, uppercase and extensionless policy`, async () => {
      for (const name of ['upload.txt', 'image.PNG', 'extensionless']) {
        const bytes = Buffer.from([0, 255, 128, 10]);
        const response = await multipart(name, bytes, directory, provider);
        assert.equal(response.status, 200, await response.text());
        assert.deepEqual(await fs.promises.readFile(path.join(disk, name)), bytes);
      }
    });
    await t.test(`${provider}: traversal and slash/backslash are rejected, never sanitized`, async () => {
      for (const name of ['../escape.txt', '../../escape.txt', '/absolute.txt', 'a/b.txt', 'a\\b.txt', 'C:foo.txt', 'bad.', 'bad ', 'CON.txt']) {
        const response = await multipart(name, 'data', directory, provider);
        assert.equal(response.status, 400, name);
        assert.equal((await response.json()).code, 'INVALID_FILENAME');
      }
      assert.equal(fs.existsSync(path.join(disk, 'escape.txt')), false);
      assert.equal(fs.existsSync(path.join(disk, 'b.txt')), false);
    });
    await t.test(`${provider}: extension policy applies to upload and new-file, existing editor saves remain usable`, async () => {
      assert.equal((await multipart('forbidden.exe', 'data', directory, provider)).status, 415);
      assert.equal((await post('/files/create', { provider, sessionId: 'remote', directory, name: 'forbidden.exe' })).status, 415);
      assert.equal(fs.existsSync(path.join(disk, 'forbidden.exe')), false);
      await fs.promises.writeFile(path.join(disk, 'existing.exe'), 'before');
      const body = { path: provider === 'local' ? path.join(root, 'existing.exe') : '/home/test/existing.exe', content: 'after', sessionId: 'remote' };
      assert.equal((await post(provider === 'local' ? '/files/write' : '/ssh/files/write', body)).status, 200);
      assert.equal(await fs.promises.readFile(path.join(disk, 'existing.exe'), 'utf8'), 'after');
    });
    await t.test(`${provider}: existing files/directories preserved, racing uploads create exclusively`, async () => {
      await fs.promises.writeFile(path.join(disk, 'preserve.txt'), 'original');
      await fs.promises.mkdir(path.join(disk, 'folder.txt'));
      for (const name of ['preserve.txt', 'folder.txt']) {
        const response = await multipart(name, 'replace', directory, provider);
        assert.equal(response.status, 409);
        assert.equal((await response.json()).code, 'DESTINATION_EXISTS');
      }
      assert.equal(await fs.promises.readFile(path.join(disk, 'preserve.txt'), 'utf8'), 'original');
      assert.equal((await fs.promises.stat(path.join(disk, 'folder.txt'))).isDirectory(), true);
      const responses = await Promise.all([multipart('race.txt', 'first', directory, provider), multipart('race.txt', 'second', directory, provider)]);
      assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    });
    await t.test(`${provider}: actual upload byte count is bounded, including absent Content-Length`, async () => {
      assert.equal((await multipart('large.txt', Buffer.alloc(17), directory, provider)).status, 413);
      assert.equal(fs.existsSync(path.join(disk, 'large.txt')), false);
      assert.equal((await multipart('limit.txt', Buffer.alloc(16), directory, provider)).status, 200);
      const boundary = 'stream-boundary';
      async function* chunks() {
        yield Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="provider"\r\n\r\n${provider}\r\n--${boundary}\r\nContent-Disposition: form-data; name="sessionId"\r\n\r\nremote\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="chunked.txt"\r\n\r\n`);
        yield Buffer.alloc(100);
        yield Buffer.from(`\r\n--${boundary}--\r\n`);
      }
      const response = await fetch(base + '/files/upload', { method: 'POST', duplex: 'half', headers: {
        Cookie: cookie, 'Content-Type': `multipart/form-data; boundary=${boundary}`,
      }, body: chunks() });
      assert.equal(response.status, 413);
    });
    await t.test(`${provider}: generic copy and move use provider transfers`, async () => {
      const source = { provider, sessionId: 'remote', path: provider === 'local' ? path.join(root, 'upload.txt') : '/home/test/upload.txt' };
      const destination = { ...source, path: provider === 'local' ? path.join(root, 'copy.txt') : '/home/test/copy.txt' };
      assert.equal((await post('/transfers', { operation: 'copy', source, destination })).status, 200);
      assert.deepEqual(await fs.promises.readFile(path.join(disk, 'copy.txt')), Buffer.from([0, 255, 128, 10]));
      const moved = { ...destination, path: provider === 'local' ? path.join(root, 'moved.txt') : '/home/test/moved.txt' };
      assert.equal((await post('/transfers', { operation: 'move', source: destination, destination: moved })).status, 200);
      assert.equal(fs.existsSync(path.join(disk, 'copy.txt')), false);
      assert.equal(fs.existsSync(path.join(disk, 'moved.txt')), true);
    });
  }
  await t.test('Local destination blocked/outside paths rejected before creating any file', async () => {
    for (const directory of [path.join(root, 'blocked'), path.dirname(root), path.join(root, 'missing')]) {
      assert.equal((await multipart('blocked.txt', 'bytes', directory)).status, 403);
      assert.equal(fs.existsSync(path.join(directory, 'blocked.txt')), false);
    }
  });
  await t.test('Local upload honors real-path validation through directory junctions', async t => {
    const link = path.join(root, 'link');
    try { await fs.promises.symlink(path.join(root, 'blocked'), link, 'junction'); }
    catch (error) { if (error.code === 'EPERM') return t.skip('Windows symlink privilege unavailable'); throw error; }
    assert.equal((await multipart('escape.txt', 'bytes', link)).status, 403);
    assert.equal(fs.existsSync(path.join(root, 'blocked', 'escape.txt')), false);
  });
  await t.test('Malformed multipart and missing file return JSON 400', async () => {
    const response = await fetch(base + '/files/upload', { method: 'POST', headers: {
      Cookie: cookie, 'Content-Type': 'multipart/form-data; boundary=broken',
    }, body: '--broken\r\ninvalid' });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'INVALID_MULTIPART');
    assert.equal((await post('/files/upload', {})).status, 400);
  });
  await t.test('Missing SSH session upload retains session-lost status and code', async () => {
    const response = await multipart('missing.txt', 'bytes', '/home/test', 'sftp', 'missing');
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'SSH_SESSION_NOT_FOUND');
  });
  await t.test('SSH download safely encodes quotes, CR/LF and controls instead of injecting headers', async () => {
    const name = 'header-test"\r\nX-Injected: yes\x01.txt';
    const response = await get('/ssh/files/download?sessionId=remote&path=' + encodeURIComponent('/home/test/' + name));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-injected'), null);
    const disposition = response.headers.get('content-disposition');
    assert.ok(disposition.startsWith('attachment;'));
    assert.ok(disposition.includes('filename*=UTF-8\'\''));
    assert.ok(disposition.includes('%0D%0A'));
    assert.equal(/[\r\n\x00-\x1f]/.test(disposition), false);
    assert.equal(await response.text(), 'safe');
  });
  await t.test('Local file and directory downloads use safe attachment names', async () => {
    await fs.promises.writeFile(path.join(root, 'download.txt'), 'download');
    const file = await get('/files/download?path=' + encodeURIComponent(path.join(root, 'download.txt')));
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-disposition'), 'attachment; filename="download.txt"');
    assert.equal(await file.text(), 'download');
    const directory = await get('/files/download?path=' + encodeURIComponent(path.join(root, 'folder.txt')));
    assert.equal(directory.status, 200);
    assert.equal(directory.headers.get('content-disposition'), 'attachment; filename="folder.txt.zip"');
    assert.equal(directory.headers.get('content-type'), 'application/zip');
    assert.ok((await directory.arrayBuffer()).byteLength > 0);
  });
});
