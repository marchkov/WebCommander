const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { finished } = require('stream/promises');
const {
  FileProvider,
  LocalProvider,
  SftpProvider,
} = require('./');
const { normalizeRemotePath } = require('./sftpProvider');

async function createTestProvider() {
  const rootPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webcommander-provider-'));
  const provider = new LocalProvider({
    rootPath,
    allowedPaths: [rootPath],
    blockedPaths: [path.join(rootPath, 'blocked')],
  });

  return { rootPath, provider };
}

test.afterEach(async () => {
  for (const entry of await fs.promises.readdir(os.tmpdir())) {
    if (entry.startsWith('webcommander-provider-')) {
      await fs.promises.rm(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
});

test('provider classes expose the expected provider types', () => {
  assert.equal(new LocalProvider({ rootPath: 'D:/Example' }).type, 'local');
  const sftpProvider = new SftpProvider({
    sessionId: 'test-session',
    sshManager: { getSftp: async () => ({}) },
  });
  assert.equal(sftpProvider.type, 'sftp');
  assert.equal(sftpProvider.rootPath, null);
});

test('local provider preserves Windows-compatible resolved roots', () => {
  const provider = new LocalProvider({ rootPath: 'D:/Example/WebCommander' });
  assert.match(provider.rootPath, /Example[\\/]WebCommander$/);
});

test('remote paths use POSIX semantics', () => {
  assert.equal(normalizeRemotePath(''), '/');
  assert.equal(normalizeRemotePath('.'), '/');
  assert.equal(normalizeRemotePath('var/www'), '/var/www');
  assert.equal(normalizeRemotePath('var\\www\\files'), '/var/www/files');
  assert.equal(normalizeRemotePath('/var/../srv/files/'), '/srv/files');
});

test('base provider exposes promise-based unimplemented operations', async () => {
  const provider = new FileProvider('local');
  for (const operation of [
    () => provider.list('/'),
    () => provider.stat('/'),
    () => provider.read('/'),
    () => provider.write('/', 'data'),
    () => provider.mkdir('/'),
    () => provider.delete('/'),
    () => provider.rename('/old', '/new'),
  ]) {
    await assert.rejects(operation(), /FileProvider\.[a-z]+ is not implemented/);
  }
});

test('base provider stream operations remain synchronous', () => {
  const provider = new FileProvider('local');
  assert.throws(() => provider.createReadStream('/'), /FileProvider\.createReadStream is not implemented/);
  assert.throws(() => provider.createWriteStream('/'), /FileProvider\.createWriteStream is not implemented/);
});

test('local provider lists entries with frontend-compatible metadata', async () => {
  const { rootPath, provider } = await createTestProvider();
  await fs.promises.writeFile(path.join(rootPath, 'notes.txt'), 'hello');
  await fs.promises.mkdir(path.join(rootPath, 'folder'));

  const entries = await provider.list(rootPath);
  const file = entries.find(entry => entry.name === 'notes.txt');
  const folder = entries.find(entry => entry.name === 'folder');

  assert.equal(file.type, 'file');
  assert.equal(file.extension, 'txt');
  assert.equal(file.parentId, rootPath);
  assert.equal(folder.type, 'folder');
  assert.equal(folder.parentId, rootPath);
});

test('local provider reads, writes, stats, and creates directories', async () => {
  const { rootPath, provider } = await createTestProvider();
  const filePath = path.join(rootPath, 'nested', 'file.txt');

  await provider.write(filePath, 'content');
  assert.equal(await provider.read(filePath), 'content');
  assert.equal((await provider.stat(filePath)).size, 7);

  const directoryPath = path.join(rootPath, 'created');
  await provider.mkdir(directoryPath);
  assert.equal((await provider.stat(directoryPath)).type, 'folder');
});

test('local provider renames and deletes files and directories recursively', async () => {
  const { rootPath, provider } = await createTestProvider();
  const oldPath = path.join(rootPath, 'old.txt');
  const newPath = path.join(rootPath, 'new.txt');
  await provider.write(oldPath, 'content');
  await provider.rename(oldPath, newPath);
  assert.equal(await provider.read(newPath), 'content');
  await provider.delete(newPath);
  await assert.rejects(() => fs.promises.stat(newPath), { code: 'ENOENT' });

  const directoryPath = path.join(rootPath, 'tree');
  await provider.write(path.join(directoryPath, 'child.txt'), 'child');
  await provider.delete(directoryPath, { recursive: true });
  await assert.rejects(() => fs.promises.stat(directoryPath), { code: 'ENOENT' });
});

test('local provider streams use Node.js read and write streams', async () => {
  const { rootPath, provider } = await createTestProvider();
  const filePath = path.join(rootPath, 'stream.txt');
  const writeStream = provider.createWriteStream(filePath);
  writeStream.end('streamed');
  await finished(writeStream);

  const chunks = [];
  const readStream = provider.createReadStream(filePath);
  readStream.on('data', chunk => chunks.push(chunk));
  await finished(readStream);
  assert.equal(Buffer.concat(chunks).toString(), 'streamed');
});

test('local provider rejects paths outside allowed and blocked paths', async () => {
  const { rootPath, provider } = await createTestProvider();
  const blockedPath = path.join(rootPath, 'blocked');
  await fs.promises.mkdir(blockedPath);

  await assert.rejects(() => provider.list(path.join(rootPath, '..')), {
    code: 'PATH_VALIDATION',
    statusCode: 403,
  });
  await assert.rejects(() => provider.list(blockedPath), {
    code: 'PATH_VALIDATION',
    statusCode: 403,
  });
});

test('local provider rejects symlink escapes and deletes links without following targets', async t => {
  const { rootPath, provider } = await createTestProvider();
  const insideTarget = path.join(rootPath, 'inside-target');
  const outsideTarget = path.join(path.dirname(rootPath), `${path.basename(rootPath)}-outside`);
  const allowedLink = path.join(rootPath, 'allowed-link');
  const escapeLink = path.join(rootPath, 'escape-link');
  const brokenLink = path.join(rootPath, 'broken-link');

  await fs.promises.mkdir(insideTarget);
  await fs.promises.mkdir(outsideTarget);
  await fs.promises.writeFile(path.join(insideTarget, 'allowed.txt'), 'allowed');
  await fs.promises.writeFile(path.join(outsideTarget, 'secret.txt'), 'secret');

  try {
    await fs.promises.symlink(insideTarget, allowedLink, 'junction');
    await fs.promises.symlink(outsideTarget, escapeLink, 'junction');
    await fs.promises.symlink(path.join(rootPath, 'missing-target'), brokenLink, 'file');
  } catch (error) {
    t.skip(`symlink creation unavailable: ${error.code || error.message}`);
    return;
  }

  assert.equal(await provider.read(path.join(allowedLink, 'allowed.txt')), 'allowed');
  const listedEntries = await provider.list(rootPath);
  const listedAllowedLink = listedEntries.find(entry => entry.name === path.basename(allowedLink));
  const listedEscapeLink = listedEntries.find(entry => entry.name === path.basename(escapeLink));
  const listedBrokenLink = listedEntries.find(entry => entry.name === path.basename(brokenLink));
  assert.equal(listedAllowedLink.type, 'folder');
  assert.equal(listedAllowedLink.isSymlink, true);
  assert.equal(listedEscapeLink.isSymlink, true);
  assert.equal(listedBrokenLink.isSymlink, true);
  assert.equal(listedEntries.some(entry => entry.name === 'inside-target'), true);
  await assert.rejects(() => provider.stat(path.join(escapeLink, 'secret.txt')), { statusCode: 403 });
  await assert.rejects(() => provider.read(path.join(escapeLink, 'secret.txt')), { statusCode: 403 });
  await assert.rejects(() => provider.list(escapeLink), { statusCode: 403 });
  await assert.rejects(() => provider.write(path.join(escapeLink, 'new.txt'), 'blocked'), { statusCode: 403 });
  await assert.rejects(() => provider.mkdir(path.join(escapeLink, 'new-dir')), { statusCode: 403 });
  assert.throws(() => provider.createReadStream(path.join(escapeLink, 'secret.txt')), { statusCode: 403 });
  assert.throws(() => provider.createWriteStream(path.join(escapeLink, 'new.txt')), { statusCode: 403 });

  const renameSource = path.join(rootPath, 'rename-source.txt');
  await fs.promises.writeFile(renameSource, 'rename');
  await assert.rejects(() => provider.rename(renameSource, path.join(escapeLink, 'renamed.txt')), { statusCode: 403 });

  const blockedProvider = new LocalProvider({
    rootPath,
    allowedPaths: [rootPath],
    blockedPaths: [insideTarget],
  });
  await assert.rejects(() => blockedProvider.stat(path.join(allowedLink, 'allowed.txt')), { statusCode: 403 });

  const deleteLink = path.join(rootPath, 'delete-link');
  await fs.promises.symlink(outsideTarget, deleteLink, 'junction');
  await provider.delete(deleteLink, { recursive: true });
  await assert.rejects(() => fs.promises.lstat(deleteLink), { code: 'ENOENT' });
  assert.equal(await fs.promises.readFile(path.join(outsideTarget, 'secret.txt'), 'utf8'), 'secret');

  const treePath = path.join(rootPath, 'tree');
  await fs.promises.mkdir(treePath);
  await fs.promises.symlink(outsideTarget, path.join(treePath, 'external-link'), 'junction');
  await provider.delete(treePath, { recursive: true });
  assert.equal(await fs.promises.readFile(path.join(outsideTarget, 'secret.txt'), 'utf8'), 'secret');
});
