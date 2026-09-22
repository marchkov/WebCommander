const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizePathForFs, isWithinDirectory, validatePath } = require('./pathUtils');

test('normalizePathForFs converts Windows separators and trims trailing slashes', () => {
  assert.equal(normalizePathForFs('D:\\Example\\WebCommander\\'), 'D:/Example/WebCommander');
  assert.equal(normalizePathForFs('/tmp/project/'), '/tmp/project');
});

test('isWithinDirectory works with nested paths and blocked siblings', () => {
  assert.equal(isWithinDirectory('D:/Example/WebCommander', 'D:/Example/WebCommander/src'), true);
  assert.equal(isWithinDirectory('D:/Example/WebCommander', 'D:/Example/Other'), false);
});

test('validatePath rejects blocked and out-of-root folders', () => {
  const root = 'D:/Example/WebCommander';
  const allowed = ['D:/Example/WebCommander', 'C:/Users'];
  const blocked = ['C:/Windows'];

  const result = validatePath('C:/Windows/System32', { rootPath: root, allowedPaths: allowed, blockedPaths: blocked });
  assert.deepEqual(result, { valid: false, error: 'Path is blocked' });

  const allowedResult = validatePath('D:/Example/WebCommander/src', { rootPath: root, allowedPaths: allowed, blockedPaths: blocked });
  assert.equal(allowedResult.valid, true);
});
