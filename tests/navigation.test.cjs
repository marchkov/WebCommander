const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const Module = require('module');

function loadTs(filename, overrides = {}) {
  const loaded = new Module(filename, module);
  loaded.require = id => overrides[id] || (id.startsWith('.') ? loadTs(path.resolve(path.dirname(filename), id + '.ts'), overrides) : require(id));
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, filename);
  return loaded.exports;
}
const { getParentPath, isRootPath, joinPath } = loadTs(path.resolve(__dirname, '../src/utils/paths.ts'));
const { sortFiles, moveCursor, selectItem, visibleItemIds, itemAction } = loadTs(path.resolve(__dirname, '../src/utils/navigation.ts'));

for (const [input, parent] of [['/', '/'], ['/repo', '/'], ['/var/www', '/var'], ['/var/www/repo', '/var/www'],
  ['C:/', 'C:/'], ['C:/repo', 'C:/'], ['C:/var/www', 'C:/var'], ['C:\\var\\www\\', 'C:/var'],
  ['C:\\', 'C:/'], ['/var/www/', '/var'], ['\\\\host\\share', '//host/share'], ['//host/share/dir', '//host/share']]) {
  test(`parent of ${input} preserves root`, () => assert.equal(getParentPath(input), parent));
}

test('path helpers respect POSIX SSH names and drive/share roots', () => {
  for (const root of ['/', 'C:/', 'c:\\', '//host/share/']) assert.equal(isRootPath(root), true);
  for (const child of ['/repo', 'C:/var', '//host/share/dir']) assert.equal(isRootPath(child), false);
  assert.equal(getParentPath('/home/a\\b/file', 'ssh'), '/home/a\\b');
  assert.equal(joinPath('C:\\', 'repo'), 'C:/repo');
  assert.equal(joinPath('/', 'file'), '/file');
  assert.equal(joinPath('/var/', 'repo', 'ssh'), '/var/repo');
  assert.equal(joinPath('/home', 'a\\b', 'ssh'), '/home/a\\b');
  assert.equal(joinPath('C:/', ''), 'C:/');
});

const file = (id, type, size, modified, extension = '') => ({ id, name: id, type, size, modified, extension, parentId: '/' });
const files = [file('z.txt', 'file', 1, '2026-01-03', 'txt'), file('beta', 'folder', 3, '2026-01-01'),
  file('a.md', 'file', 5, '2026-01-02', 'md'), file('alpha', 'folder', 2, '2026-01-04')];
const panel = (extra = {}) => ({ mode: 'local', currentPath: '/repo', files, sortBy: 'name', sortOrder: 'asc', selectedItems: [], ...extra });

test('sort preserves folders first in both directions without mutating source', () => {
  const original = [...files];
  assert.deepEqual(sortFiles(files, 'name', 'asc').map(f => f.id), ['alpha', 'beta', 'a.md', 'z.txt']);
  assert.deepEqual(sortFiles(files, 'name', 'desc').map(f => f.id), ['beta', 'alpha', 'z.txt', 'a.md']);
  assert.deepEqual(files, original);
});

for (const sortBy of ['name', 'size', 'date', 'ext']) {
  for (const sortOrder of ['asc', 'desc']) {
    test(`cursor follows visible ${sortBy} ${sortOrder} order including parent`, () => {
      let state = panel({ sortBy, sortOrder });
      const expected = ['..', ...sortFiles(files, sortBy, sortOrder).map(file => file.id)];
      assert.deepEqual(visibleItemIds(state), expected);
      for (const id of expected) {
        state = moveCursor(state, 1);
        assert.equal(state.focusedItemId, id);
        assert.deepEqual(state.selectedItems, id === '..' ? [] : [id]);
      }
      assert.equal(moveCursor(state, 1).focusedItemId, expected.at(-1));
      for (const id of expected.slice(0, -1).reverse()) {
        state = moveCursor(state, -1);
        assert.equal(state.focusedItemId, id);
      }
      assert.equal(moveCursor(state, -1).focusedItemId, '..');
    });
  }
}

test('unfocused Up starts at last row, roots omit parent and empty roots are safe', () => {
  assert.equal(moveCursor(panel(), -1).focusedItemId, 'z.txt');
  for (const root of ['/', 'C:/', 'C:\\']) {
    assert.equal(moveCursor(panel({ currentPath: root }), 1).focusedItemId, 'alpha');
    assert.equal(visibleItemIds(panel({ currentPath: root })).includes('..'), false);
    assert.equal(moveCursor(panel({ currentPath: root, files: [] }), 1).focusedItemId, undefined);
  }
  assert.equal(moveCursor(panel({ files: [] }), 1).focusedItemId, '..');
});

test('click cursor cooperates with Ctrl/Cmd multi-selection; arrows return to single selection', () => {
  let state = selectItem(panel(), 'a.md', false);
  state = selectItem(state, 'z.txt', true);
  assert.deepEqual(state.selectedItems, ['a.md', 'z.txt']);
  state = selectItem(state, 'z.txt', true);
  assert.deepEqual(state.selectedItems, ['a.md']);
  assert.equal(state.focusedItemId, 'z.txt');
  state = moveCursor(state, -1);
  assert.deepEqual(state.selectedItems, ['a.md']);
  assert.equal(state.focusedItemId, 'a.md');
  state = selectItem(state, '..', false);
  assert.deepEqual(state.selectedItems, []);
  assert.deepEqual(itemAction(state, 'Enter'), { type: 'navigate', path: '..' });
});

test('Enter opens folders/files, F3 views and F4 edits only the current file', () => {
  for (const mode of ['local', 'ssh']) {
    const state = panel({ mode, focusedItemId: 'a.md' });
    assert.deepEqual(itemAction(state, 'F3'), { type: 'open', path: 'a.md', readOnly: true });
    assert.deepEqual(itemAction(state, 'F4'), { type: 'open', path: 'a.md', readOnly: false });
    assert.deepEqual(itemAction(state, 'Enter'), { type: 'open', path: 'a.md', readOnly: false });
    for (const id of ['..', 'alpha']) {
      assert.equal(itemAction({ ...state, focusedItemId: id }, 'F3'), null);
      assert.equal(itemAction({ ...state, focusedItemId: id }, 'F4'), null);
      assert.deepEqual(itemAction({ ...state, focusedItemId: id }, 'Enter'), { type: 'navigate', path: id });
    }
  }
  assert.equal(itemAction(panel(), 'F3'), null);
  assert.deepEqual(itemAction(panel({ selectedItems: ['a.md'] }), 'F3'), { type: 'open', path: 'a.md', readOnly: true });
  assert.equal(itemAction(panel({ selectedItems: ['a.md', 'z.txt'] }), 'F3'), null);
  assert.equal(itemAction(panel({ selectedItems: ['a.md', 'z.txt'] }), 'F4'), null);
  assert.deepEqual(itemAction(panel({ focusedItemId: 'z.txt', selectedItems: ['a.md'] }), 'F4'),
    { type: 'open', path: 'z.txt', readOnly: false });
  assert.equal(itemAction(panel({ focusedItemId: 'alpha', selectedItems: ['a.md'] }), 'F3'), null);
});

test('stale cursor cannot open a deleted item and independent panels retain their cursor', () => {
  const left = panel({ focusedItemId: 'deleted' });
  const right = panel({ focusedItemId: 'z.txt' });
  assert.equal(itemAction(left, 'Enter'), null);
  assert.equal(moveCursor(left, 1).focusedItemId, '..');
  assert.equal(right.focusedItemId, 'z.txt');
});

test('viewer is read-only and Ctrl+S cannot write; editor saves via correct local/SSH API', async () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  for (const readOnly of [true, false]) {
    for (const sessionId of [undefined, 'ssh-1']) {
      const states = ['contents', false, false, '', true];
      const writes = [];
      const api = { writeFile: async (...args) => writes.push(['local', ...args]), sshWriteFile: async (...args) => writes.push(['ssh', ...args]) };
      const Editor = loadTs(path.resolve(__dirname, '../src/components/FileEditor.tsx'), {
        react: { ...React, useState: () => [states.shift(), () => {}], useEffect: () => {} }, '../api/client': { api },
      }).default;
      const tree = Editor({ filePath: '/file.txt', sessionId, readOnly, onClose() {}, onSave() {} });
      const html = renderToStaticMarkup(tree);
      assert.equal(html.includes('readonly=""'), readOnly);
      assert.equal(html.includes('Ctrl+S to save'), !readOnly);
      tree.props.onKeyDown({ ctrlKey: true, key: 's', preventDefault() {} });
      await Promise.resolve();
      if (readOnly) assert.deepEqual(writes, []);
      else assert.deepEqual(writes, [sessionId ? ['ssh', sessionId, '/file.txt', 'contents'] : ['local', '/file.txt', 'contents']]);
    }
  }
});
