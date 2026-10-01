const test = require('node:test');
const assert = require('node:assert/strict');
const { validateFilename, validateExtension, createExclusiveFile } = require('./fileSecurity');
const registerUploadRoutes = require('./uploadRoutes');

test('Basenames reject traversal, Windows syntax and control characters without sanitizing', () => {
  for (const name of ['../../secret', 'a/b', 'a\\b', '.', '..', '', 'a\0b', 'a\rb', 'a\nb', 'a\x7fb',
    'C:foo', 'name.', 'name ', 'con.txt', 'LPT1', 'bad"name', 'bad*name']) {
    assert.throws(() => validateFilename(name), { status: 400, code: 'INVALID_FILENAME' });
  }
  for (const name of ['file.txt', 'photo.PNG', 'notes', 'hello world.txt', '\u0444\u0430\u0439\u043b.txt']) assert.equal(validateFilename(name), name);
});

test('Extension policy supports wildcard, case folding, leading dots and explicit extensionless marker', () => {
  for (const name of ['notes', 'photo.PNG', 'file.exe']) assert.doesNotThrow(() => validateExtension(name, ['*']));
  assert.doesNotThrow(() => validateExtension('photo.PNG', ['.png']));
  assert.doesNotThrow(() => validateExtension('file.txt', ['TXT']));
  assert.doesNotThrow(() => validateExtension('notes', ['<none>']));
  for (const name of ['file.exe', 'notes', '.hidden']) assert.throws(() => validateExtension(name, ['txt']), { status: 415 });
});

test('Invalid upload limits fail startup instead of enabling unbounded memory buffering', () => {
  for (const maxFileSize of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => registerUploadRoutes({}, { security: { maxFileSize } }), /positive safe integer/);
  }
});

test('SFTP v3 exclusive-open collision becomes 409 while unrelated failures remain errors', async () => {
  for (const collided of [true, false]) {
    let checks = 0;
    const original = Object.assign(new Error('SFTP failure'), { code: 4 });
    const provider = {
      stat: async () => ({ path: '/home', type: 'folder' }),
      joinPath: (directory, name) => directory + '/' + name,
      lstat: async () => {
        if (++checks === 1 || !collided) throw Object.assign(new Error('Missing'), { code: 2 });
        return { type: 'file' };
      },
      write: async (_destination, _bytes, options) => { assert.equal(options.exclusive, true); throw original; },
    };
    await assert.rejects(createExclusiveFile({ provider, directory: '/home', name: 'race.txt', data: 'bytes' }),
      error => collided ? error.status === 409 && error.code === 'DESTINATION_EXISTS' : error === original);
  }
});
