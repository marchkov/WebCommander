const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const FileProvider = require('../providers/fileProvider');
const LocalProvider = require('../providers/localProvider');
const TransferService = require('./transferService');

class FakeSftpProvider extends FileProvider {
  constructor(rootPath, sessionId) {
    super('sftp');
    this.storageRoot = rootPath;
    this.sessionId = sessionId;
    this.rootPath = '/remote';
    this.initialized = false;
    this.initializeCalls = 0;
  }

  async initialize() {
    this.initializeCalls += 1;
    this.initialized = true;
    return this;
  }

  remotePath(targetPath) {
    const normalized = path.posix.normalize(String(targetPath));
    if (normalized !== this.rootPath && !normalized.startsWith(`${this.rootPath}/`)) {
      throw new Error(`Path outside fake SFTP root: ${targetPath}`);
    }
    const relative = path.posix.relative(this.rootPath, normalized);
    return path.join(this.storageRoot, ...relative.split('/').filter(Boolean));
  }

  joinPath(basePath, name) {
    return path.posix.join(basePath, name);
  }

  async list(targetPath) {
    const resolvedPath = path.posix.normalize(targetPath);
    const entries = await fs.promises.readdir(this.remotePath(resolvedPath), { withFileTypes: true });
    return Promise.all(entries.map(async entry => {
      const entryPath = path.posix.join(resolvedPath, entry.name);
      const stats = await fs.promises.stat(this.remotePath(entryPath));
      return this.toEntry(entryPath, entry.name, stats, resolvedPath);
    }));
  }

  async stat(targetPath) {
    const resolvedPath = path.posix.normalize(targetPath);
    const stats = await fs.promises.stat(this.remotePath(resolvedPath));
    return this.toEntry(resolvedPath, path.posix.basename(resolvedPath), stats, path.posix.dirname(resolvedPath));
  }

  async mkdir(targetPath) {
    await fs.promises.mkdir(this.remotePath(path.posix.normalize(targetPath)), { recursive: true });
  }

  async delete(targetPath, options = {}) {
    await fs.promises.rm(this.remotePath(path.posix.normalize(targetPath)), {
      recursive: options.recursive === true,
      force: options.force === true,
    });
  }

  async rename(oldPath, newPath) {
    await fs.promises.rename(this.remotePath(oldPath), this.remotePath(newPath));
  }

  createReadStream(targetPath) {
    return fs.createReadStream(this.remotePath(targetPath));
  }

  createWriteStream(targetPath) {
    return fs.createWriteStream(this.remotePath(targetPath));
  }

  toEntry(entryPath, name, stats, parentPath) {
    const folder = stats.isDirectory();
    return {
      id: entryPath,
      path: entryPath,
      name,
      type: folder ? 'folder' : 'file',
      size: stats.size,
      modified: stats.mtime,
      extension: folder ? undefined : path.posix.extname(name).slice(1),
      parentId: parentPath,
      permissions: stats.mode.toString(8).slice(-3),
    };
  }
}

async function createFixture() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webcommander-transfer-'));
  const localRoot = path.join(root, 'local');
  const sftpRootA = path.join(root, 'sftp-a');
  const sftpRootB = path.join(root, 'sftp-b');
  await Promise.all([
    fs.promises.mkdir(localRoot),
    fs.promises.mkdir(sftpRootA),
    fs.promises.mkdir(sftpRootB),
  ]);

  return {
    root,
    local: new LocalProvider({ rootPath: localRoot, allowedPaths: [localRoot], blockedPaths: [] }),
    sftpA: new FakeSftpProvider(sftpRootA, 'session-a'),
    sftpB: new FakeSftpProvider(sftpRootB, 'session-b'),
    localRoot,
    sftpRootA,
    sftpRootB,
  };
}

test.afterEach(async () => {
  for (const entry of await fs.promises.readdir(os.tmpdir())) {
    if (entry.startsWith('webcommander-transfer-')) {
      await fs.promises.rm(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
});

test('copies binary files between local and SFTP providers', async () => {
  const fixture = await createFixture();
  const service = new TransferService();
  const binary = Buffer.from([0, 1, 2, 127, 128, 254, 255]);
  await fs.promises.writeFile(path.join(fixture.localRoot, 'binary.bin'), binary);

  const localToLocal = await service.copy({
    sourceProvider: fixture.local,
    sourcePath: path.join(fixture.localRoot, 'binary.bin'),
    destinationProvider: fixture.local,
    destinationPath: path.join(fixture.localRoot, 'copy.bin'),
  });
  assert.deepEqual(await fs.promises.readFile(path.join(fixture.localRoot, 'copy.bin')), binary);
  assert.deepEqual(localToLocal, { filesCopied: 1, directoriesCreated: 0, bytesCopied: binary.length });

  await service.copy({
    sourceProvider: fixture.local,
    sourcePath: path.join(fixture.localRoot, 'binary.bin'),
    destinationProvider: fixture.sftpA,
    destinationPath: '/remote/remote.bin',
  });
  await service.copy({
    sourceProvider: fixture.sftpA,
    sourcePath: '/remote/remote.bin',
    destinationProvider: fixture.local,
    destinationPath: path.join(fixture.localRoot, 'from-remote.bin'),
  });
  assert.deepEqual(await fs.promises.readFile(path.join(fixture.localRoot, 'from-remote.bin')), binary);
});

test('copies files between same and different SFTP sessions', async () => {
  const fixture = await createFixture();
  const service = new TransferService();
  await fs.promises.writeFile(path.join(fixture.sftpRootA, 'source.bin'), Buffer.from([3, 14, 15, 92]));

  await service.copy({
    sourceProvider: fixture.sftpA,
    sourcePath: '/remote/source.bin',
    destinationProvider: fixture.sftpA,
    destinationPath: '/remote/same-session.bin',
  });
  await service.copy({
    sourceProvider: fixture.sftpA,
    sourcePath: '/remote/source.bin',
    destinationProvider: fixture.sftpB,
    destinationPath: '/remote/different-session.bin',
  });

  assert.deepEqual(
    await fs.promises.readFile(path.join(fixture.sftpRootB, 'different-session.bin')),
    Buffer.from([3, 14, 15, 92]),
  );
  assert.equal(fixture.sftpA.initializeCalls > 0, true);
  assert.equal(fixture.sftpB.initializeCalls > 0, true);
});

test('copies recursive trees and creates empty directories across providers', async () => {
  const fixture = await createFixture();
  const service = new TransferService();
  await fs.promises.mkdir(path.join(fixture.localRoot, 'tree', 'empty'), { recursive: true });
  await fs.promises.mkdir(path.join(fixture.localRoot, 'tree', 'nested'));
  await fs.promises.writeFile(path.join(fixture.localRoot, 'tree', 'nested', 'data.bin'), Buffer.from([9, 8, 7]));

  const result = await service.copy({
    sourceProvider: fixture.local,
    sourcePath: path.join(fixture.localRoot, 'tree'),
    destinationProvider: fixture.sftpB,
    destinationPath: '/remote/copied-tree',
  });

  assert.equal(result.filesCopied, 1);
  assert.equal(result.directoriesCreated, 3);
  assert.equal(result.bytesCopied, 3);
  assert.equal((await fixture.sftpB.stat('/remote/copied-tree/empty')).type, 'folder');
  assert.deepEqual(
    await fs.promises.readFile(path.join(fixture.sftpRootB, 'copied-tree', 'nested', 'data.bin')),
    Buffer.from([9, 8, 7]),
  );
});

test('enforces overwrite conflicts and supports explicit replacement', async () => {
  const fixture = await createFixture();
  const service = new TransferService();
  await fs.promises.writeFile(path.join(fixture.localRoot, 'source.txt'), 'new');
  await fs.promises.writeFile(path.join(fixture.localRoot, 'destination.txt'), 'old');

  await assert.rejects(() => service.copy({
    sourceProvider: fixture.local,
    sourcePath: path.join(fixture.localRoot, 'source.txt'),
    destinationProvider: fixture.local,
    destinationPath: path.join(fixture.localRoot, 'destination.txt'),
  }), error => error.code === 'EEXIST' && error.statusCode === 409);
  assert.equal(await fs.promises.readFile(path.join(fixture.localRoot, 'destination.txt'), 'utf8'), 'old');

  await service.copy({
    sourceProvider: fixture.local,
    sourcePath: path.join(fixture.localRoot, 'source.txt'),
    destinationProvider: fixture.local,
    destinationPath: path.join(fixture.localRoot, 'destination.txt'),
    options: { overwrite: true },
  });
  assert.equal(await fs.promises.readFile(path.join(fixture.localRoot, 'destination.txt'), 'utf8'), 'new');
});

test('move deletes the source only after a successful copy', async () => {
  const fixture = await createFixture();
  const service = new TransferService();
  const sourcePath = path.join(fixture.localRoot, 'move.txt');
  const destinationPath = path.join(fixture.sftpRootA, 'moved.txt');
  await fs.promises.writeFile(sourcePath, 'move me');

  const result = await service.move({
    sourceProvider: fixture.local,
    sourcePath,
    destinationProvider: fixture.sftpA,
    destinationPath: '/remote/moved.txt',
  });
  assert.equal(result.filesCopied, 1);
  await assert.rejects(() => fs.promises.stat(sourcePath), { code: 'ENOENT' });

  const failedSource = path.join(fixture.localRoot, 'failed.txt');
  await fs.promises.writeFile(failedSource, 'keep me');
  await fs.promises.writeFile(path.join(fixture.localRoot, 'existing.txt'), 'existing');
  await assert.rejects(() => service.move({
    sourceProvider: fixture.local,
    sourcePath: failedSource,
    destinationProvider: fixture.local,
    destinationPath: path.join(fixture.localRoot, 'existing.txt'),
  }), { code: 'EEXIST' });
  assert.equal(await fs.promises.readFile(failedSource, 'utf8'), 'keep me');
});
