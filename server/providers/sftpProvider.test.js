const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { finished } = require('stream/promises');
const SftpProvider = require('./sftpProvider');

class FakeSftp {
  constructor(rootPath) {
    this.rootPath = rootPath;
  }

  localPath(remotePath) {
    const relativePath = path.posix.relative('/home/test', remotePath);
    return path.join(this.rootPath, ...relativePath.split('/').filter(Boolean));
  }

  attrs(stats) {
    return {
      size: stats.size,
      mode: stats.mode,
      mtime: Math.floor(stats.mtimeMs / 1000),
      atime: Math.floor(stats.atimeMs / 1000),
      uid: 1000,
      gid: 1000,
      isDirectory: () => stats.isDirectory(),
    };
  }

  realpath(_remotePath, callback) {
    callback(null, '/home/test');
  }

  readdir(remotePath, callback) {
    fs.readdir(this.localPath(remotePath), { withFileTypes: true }, (error, entries) => {
      if (error) return callback(error);

      Promise.all(entries.map(async entry => this.attrs(await fs.promises.stat(path.join(this.localPath(remotePath), entry.name))))).then(attrs => {
        callback(null, entries.map((entry, index) => ({ filename: entry.name, attrs: attrs[index] })));
      }, callback);
    });
  }

  stat(remotePath, callback) {
    fs.stat(this.localPath(remotePath), (error, stats) => callback(error, error ? undefined : this.attrs(stats)));
  }

  mkdir(remotePath, callback) {
    fs.mkdir(this.localPath(remotePath), callback);
  }

  unlink(remotePath, callback) {
    fs.unlink(this.localPath(remotePath), callback);
  }

  rmdir(remotePath, callback) {
    fs.rmdir(this.localPath(remotePath), callback);
  }

  rename(oldPath, newPath, callback) {
    fs.rename(this.localPath(oldPath), this.localPath(newPath), callback);
  }

  createReadStream(remotePath) {
    return fs.createReadStream(this.localPath(remotePath));
  }

  createWriteStream(remotePath) {
    return fs.createWriteStream(this.localPath(remotePath));
  }
}

async function createFixture() {
  const rootPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webcommander-sftp-'));
  const sftp = new FakeSftp(rootPath);
  const manager = {
    execCalls: 0,
    sftpCalls: 0,
    getSftp: async () => {
      manager.sftpCalls += 1;
      return sftp;
    },
    exec: async () => {
      manager.execCalls += 1;
      throw new Error('SFTP tests must not execute shell commands');
    },
  };
  const provider = new SftpProvider({
    sessionId: 'test-session',
    sshManager: manager,
  });

  return { rootPath, manager, provider };
}

test.afterEach(async () => {
  for (const entry of await fs.promises.readdir(os.tmpdir())) {
    if (entry.startsWith('webcommander-sftp-')) {
      await fs.promises.rm(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
});

test('SftpProvider resolves home and remote paths with POSIX semantics', async () => {
  const { provider } = await createFixture();

  assert.equal(await provider.resolvePath('~'), '/home/test');
  assert.equal(await provider.resolvePath('~/var/www'), '/home/test/var/www');
  assert.equal(await provider.resolvePath('var\\www\\files'), '/home/test/var/www/files');
  assert.equal(await provider.resolvePath('/var/../srv/files/'), '/srv/files');
});

test('SftpProvider initialization resolves home and is idempotent', async () => {
  const { manager, provider } = await createFixture();

  const first = await provider.initialize();
  const second = await provider.ready();

  assert.equal(first, provider);
  assert.equal(second, provider);
  assert.equal(provider.rootPath, '/home/test');
  assert.equal(manager.sftpCalls, 1);
});

test('ordinary filesystem operations initialize SftpProvider automatically', async () => {
  const { rootPath, manager, provider } = await createFixture();
  await fs.promises.writeFile(path.join(rootPath, 'auto.txt'), 'automatic');

  assert.equal((await provider.list('~')).length, 1);
  assert.equal((await provider.stat('/home/test/auto.txt')).size, 9);
  assert.equal(await provider.read('/home/test/auto.txt'), 'automatic');
  assert.equal(manager.sftpCalls, 1);
});

test('SftpProvider streams fail clearly before initialization', async () => {
  const { provider } = await createFixture();

  assert.throws(
    () => provider.createReadStream('/home/test/file.txt'),
    /SftpProvider must be initialized before creating streams/,
  );
  assert.throws(
    () => provider.createWriteStream('/home/test/file.txt'),
    /SftpProvider must be initialized before creating streams/,
  );
});

test('SftpProvider lists and stats entries', async () => {
  const { rootPath, provider } = await createFixture();
  await fs.promises.writeFile(path.join(rootPath, 'notes.txt'), 'hello');
  await fs.promises.mkdir(path.join(rootPath, 'folder'));

  const entries = await provider.list('~');
  const file = entries.find(entry => entry.name === 'notes.txt');
  const folder = entries.find(entry => entry.name === 'folder');
  const info = await provider.stat('/home/test/notes.txt');

  assert.equal(file.type, 'file');
  assert.equal(file.path, '/home/test/notes.txt');
  assert.equal(file.extension, 'txt');
  assert.equal(file.parentId, '/home/test');
  assert.equal(folder.type, 'folder');
  assert.equal(info.size, 5);
  assert.match(info.permissions, /^\d{3}$/);
  assert.equal(info.uid, 1000);
  assert.equal(info.gid, 1000);
});

test('SftpProvider reads, writes, creates, and renames files', async () => {
  const { rootPath, provider } = await createFixture();
  await provider.mkdir('/home/test/created');
  await provider.write('/home/test/created/file.txt', 'content');
  assert.equal(await provider.read('/home/test/created/file.txt'), 'content');

  await provider.rename('/home/test/created/file.txt', '/home/test/created/renamed.txt');
  assert.equal(await provider.read('/home/test/created/renamed.txt'), 'content');
  assert.equal(await fs.promises.readFile(path.join(rootPath, 'created', 'renamed.txt'), 'utf8'), 'content');
});

test('SftpProvider deletes files and nested directories without exec', async () => {
  const { rootPath, manager, provider } = await createFixture();
  await fs.promises.writeFile(path.join(rootPath, 'file.txt'), 'file');
  await provider.delete('/home/test/file.txt');
  await assert.rejects(() => fs.promises.stat(path.join(rootPath, 'file.txt')), { code: 'ENOENT' });

  await fs.promises.mkdir(path.join(rootPath, 'tree', 'nested'), { recursive: true });
  await fs.promises.writeFile(path.join(rootPath, 'tree', 'nested', 'file.txt'), 'nested');
  await provider.delete('/home/test/tree', { recursive: true });
  await assert.rejects(() => fs.promises.stat(path.join(rootPath, 'tree')), { code: 'ENOENT' });
  assert.equal(manager.execCalls, 0);
});

test('SftpProvider exposes Node read and write streams', async () => {
  const { rootPath, provider } = await createFixture();
  await provider.initialize();
  const filePath = '/home/test/stream.txt';
  const writeStream = provider.createWriteStream(filePath);
  writeStream.end('streamed');
  await finished(writeStream);

  const chunks = [];
  const readStream = provider.createReadStream(filePath);
  readStream.on('data', chunk => chunks.push(chunk));
  await finished(readStream);
  assert.equal(Buffer.concat(chunks).toString(), 'streamed');
  assert.equal(await fs.promises.readFile(path.join(rootPath, 'stream.txt'), 'utf8'), 'streamed');
});
