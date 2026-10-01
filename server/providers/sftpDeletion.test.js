const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const SftpProvider = require('./sftpProvider');

function fixture() {
  const entries = new Map([
    ['/home', 'dir'], ['/home/file', 'file'], ['/home/file-link', 'link'], ['/home/dir-link', 'link'],
    ['/home/tree', 'dir'], ['/home/tree/nested', 'dir'], ['/home/tree/nested/file', 'file'],
    ['/home/tree/outside-link', 'link'], ['/outside', 'dir'], ['/outside/valuable', 'file'],
  ]);
  const calls = [];
  const attrs = type => ({ mode: { dir: 0o040755, file: 0o100644, link: 0o120777 }[type] });
  const sftp = {
    realpath(_value, cb) { cb(null, '/home'); },
    stat() { throw new Error('Deletion must never follow symlinks with stat'); },
    lstat(value, cb) { calls.push(['lstat', value]); cb(null, attrs(entries.get(value))); },
    readdir(value, cb) {
      calls.push(['readdir', value]);
      assert.equal(entries.get(value), 'dir', 'must not traverse symlink');
      cb(null, [...entries].filter(([name]) => name !== value && path.posix.dirname(name) === value)
        .map(([name, type]) => ({ filename: path.posix.basename(name), attrs: attrs(type === 'link' ? 'dir' : type) })));
    },
    unlink(value, cb) { calls.push(['unlink', value]); assert.notEqual(entries.get(value), 'dir'); entries.delete(value); cb(); },
    rmdir(value, cb) { calls.push(['rmdir', value]); assert.equal(entries.get(value), 'dir');
      assert.equal([...entries.keys()].some(name => name.startsWith(value + '/')), false); entries.delete(value); cb(); },
  };
  return { entries, calls, provider: new SftpProvider({ sessionId: 'test', sshManager: { getSftp: async () => sftp } }) };
}

for (const name of ['file', 'file-link', 'dir-link']) test(`SFTP deletion unlinks ${name} without following targets`, async () => {
  const { provider, entries, calls } = fixture();
  await provider.delete('/home/' + name, { recursive: true });
  assert.equal(entries.has('/home/' + name), false);
  assert.equal(entries.has('/outside/valuable'), true);
  assert.deepEqual(calls, [['lstat', '/home/' + name], ['unlink', '/home/' + name]]);
});

test('SFTP recursive deletion lstats children even when readdir follows links, preserving external targets', async () => {
  const { provider, entries, calls } = fixture();
  await provider.delete('/home/tree', { recursive: true });
  assert.equal([...entries.keys()].some(name => name.startsWith('/home/tree')), false);
  assert.equal(entries.has('/outside/valuable'), true);
  assert.ok(calls.some(([operation, name]) => operation === 'unlink' && name === '/home/tree/outside-link'));
  assert.equal(calls.some(([operation, name]) => operation === 'readdir' && name.endsWith('outside-link')), false);
});

test('SFTP non-recursive deletion uses rmdir for a real empty directory', async () => {
  const { provider, entries, calls } = fixture();
  entries.set('/home/empty', 'dir');
  await provider.delete('/home/empty');
  assert.deepEqual(calls, [['lstat', '/home/empty'], ['rmdir', '/home/empty']]);
});
