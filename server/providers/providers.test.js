const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FileProvider,
  LocalProvider,
  SftpProvider,
} = require('./');
const { normalizeRemotePath } = require('./sftpProvider');

test('provider classes expose the expected provider types', () => {
  assert.equal(new LocalProvider({ rootPath: 'D:/Example' }).type, 'local');
  assert.equal(new SftpProvider().type, 'sftp');
  assert.equal(new SftpProvider().rootPath, '/');
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
