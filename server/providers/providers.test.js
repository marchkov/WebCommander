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
  assert.equal(normalizeRemotePath('var\\www\\files'), 'var/www/files');
  assert.equal(normalizeRemotePath('/var/../srv/files/'), '/srv/files');
  assert.equal(normalizeRemotePath(''), '/');
});

test('base provider rejects unimplemented operations explicitly', () => {
  const provider = new FileProvider('local');
  assert.throws(() => provider.list('/'), /FileProvider\.list is not implemented/);
  assert.throws(() => provider.createReadStream('/'), /FileProvider\.createReadStream is not implemented/);
});
