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


const { serializePanels, readBindings, restorePanel, attachSession } = loadTs(path.resolve(__dirname, '../src/utils/connections.ts'));
const { connectionShortcut, selectionAction } = loadTs(path.resolve(__dirname, '../src/utils/navigation.ts'));
const session = { sessionId: 'active', host: 'host', port: 22, username: 'user', connectedAt: '2026-01-01', status: 'ready' };
test('panel serialization excludes credentials and safely parses malformed storage', () => {
  const saved = serializePanels({ ...panel(), ...session, mode: 'ssh', sshSessionId: 'active', password: 'secret', privateKey: 'key', passphrase: 'phrase' }, panel());
  assert.deepEqual(JSON.parse(saved), { left: { mode: 'ssh', sshSessionId: 'active', currentPath: '/repo' }, right: { mode: 'local', currentPath: '/repo' } });
  for (const text of ['{', 'null', null]) assert.deepEqual(readBindings(text), {});
});
test('restore panels independently, preserve existing session ID, and fall back from stale path to home', async () => {
  const calls = [];
  const read = async (state, path) => {
    calls.push([state.mode, state.sshSessionId, path]);
    if (path === '/stale') throw new Error('missing');
    return { path: path === '~' ? '/home/user' : path, files: [] };
  };
  const [left, right] = await Promise.all([
    restorePanel(panel(), { mode: 'ssh', sshSessionId: 'active', currentPath: '/stale' }, [session], read),
    restorePanel(panel(), { mode: 'ssh', sshSessionId: 'dead', currentPath: '/secret' }, [session], read),
  ]);
  assert.equal(left.sshSessionId, 'active'); assert.equal(left.currentPath, '/home/user');
  assert.equal(right.mode, 'local'); assert.equal(right.currentPath, '/');
  assert.ok(calls.some(call => call[1] === 'active' && call[2] === '~'));
  assert.equal(calls.some(call => call[2] === '/secret'), false);
  const restored = await restorePanel(panel(), { mode: 'ssh', sshSessionId: 'active', currentPath: '/saved' }, [session], read);
  assert.equal(restored.currentPath, '/saved');
  const local = await restorePanel(panel(), { mode: 'local', currentPath: '/stale' }, [], read);
  assert.equal(local.currentPath, '/');
  const attached = attachSession(panel(), session);
  assert.equal(attached.sshSessionId, 'active'); assert.equal(attached.currentPath, '~');
  assert.equal(attached.sshHost, 'host'); assert.equal(attached.sshUser, 'user');
});
test('connection and selection shortcuts resolve without hijacking other modifiers', () => {
  const key = (key, code = '', extra = {}) => connectionShortcut({ key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });
  assert.equal(key('f', '', { ctrlKey: true }), 'connections');
  assert.equal(key('r', '', { ctrlKey: true }), 'refresh');
  assert.equal(key('u', '', { ctrlKey: true }), 'swap');
  assert.equal(key('a', '', { ctrlKey: true }), 'all');
  assert.equal(key('f', '', { ctrlKey: true, shiftKey: true }), undefined);
  assert.equal(key('*', 'NumpadMultiply'), 'invert');
  assert.equal(key('+', 'NumpadAdd'), 'all');
  assert.equal(key('-', 'NumpadSubtract'), 'clear');
  assert.equal(key('Insert'), 'insert');
});
test('Insert toggles and advances in visible order; selection commands exclude parent', () => {
  const state = panel({ focusedItemId: 'alpha', selectedItems: ['z.txt'] });
  const next = selectionAction(state, 'insert');
  assert.deepEqual(next.selectedItems, ['z.txt', 'alpha']); assert.equal(next.focusedItemId, 'beta');
  assert.deepEqual(selectionAction({ ...next, focusedItemId: 'alpha' }, 'insert').selectedItems, ['z.txt']);
  assert.deepEqual(selectionAction({ ...state, focusedItemId: '..' }, 'insert').selectedItems, ['z.txt']);
  assert.deepEqual(selectionAction(state, 'all').selectedItems, files.map(file => file.id));
  assert.deepEqual(selectionAction(state, 'invert').selectedItems, files.filter(file => file.id !== 'z.txt').map(file => file.id));
  assert.deepEqual(selectionAction(state, 'clear').selectedItems, []);
});
test('login uses native username/password/submit focus order, valid form submission and duplicate protection', async () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const states = ['user', 'password', '', false];
  let requests = 0, finish;
  const Login = loadTs(path.resolve(__dirname, '../src/components/Login.tsx'), {
    react: { ...React, useState: () => [states.shift(), () => {}], useRef: () => ({ current: false }) },
    '../api/client': { api: { isDemoMode: () => false, login: () => { requests++; return new Promise(resolve => { finish = resolve; }); } } },
  }).default;
  const tree = Login({ onLoginSuccess() {} });
  const html = renderToStaticMarkup(tree);
  const inputs = html.match(/<(?:input|button)\b[^>]*>/g);
  assert.equal(inputs.length, 3);
  assert.match(inputs[0], /id="username"/); assert.match(inputs[0], /autofocus/);
  assert.match(inputs[1], /id="password"/); assert.match(inputs[1], /type="password"/);
  assert.match(inputs[2], /type="submit"/);
  assert.match(html, /for="username"/); assert.match(html, /for="password"/);
  assert.doesNotMatch(html, /tabindex/i);
  const find = element => {
    if (!element || typeof element !== 'object') return;
    if (element.type === 'form') return element;
    return React.Children.toArray(element.props?.children).map(find).find(Boolean);
  };
  const form = find(tree);
  assert.equal(form.props.onKeyDown, undefined);
  await form.props.onSubmit({ preventDefault() {}, currentTarget: { checkValidity: () => false } });
  assert.equal(requests, 0);
  const event = { preventDefault() {}, currentTarget: { checkValidity: () => true } };
  const first = form.props.onSubmit(event); await form.props.onSubmit(event);
  assert.equal(requests, 1);
  finish({ success: true, username: 'user' }); await first;
});

test('App leaves login Tab native and protects terminal/input/editor shortcuts; Ctrl+F opens Connections', () => {
  const React = require('react');
  const OriginalElement = global.Element;
  class Target { constructor(protectedInput) { this.protectedInput = protectedInput; } closest() { return this.protectedInput; } }
  global.Element = Target;
  try {
    for (const [authenticated, protectedInput, editorOpen, key, ctrlKey, expected] of [
      [false, false, false, 'Tab', false, false],
      [false, false, false, 'f', true, false],
      [true, true, false, 'f', true, false],
      [true, true, false, 'Tab', false, false],
      [true, false, true, 'f', true, false],
      [true, false, false, 'f', true, true],
    ]) {
      const states = [false, true, authenticated, '', 'left', panel(), panel(), { isOpen: false }, { isOpen: editorOpen }, { isOpen: false }, null];
      const changes = [];
      let handler, index = 0;
      const overrides = {
        react: { ...React, useState: () => { const i = index++; return [states[i], value => changes.push([i, value])]; },
          useEffect() {}, useCallback: fn => { handler = fn; return fn; } },
        './api/client': { api: { isDemoMode: () => false } },
      };
      for (const component of ['FilePanel', 'Toolbar', 'Modal', 'StatusBar', 'Login', 'FileEditor', 'SSHConnectModal', 'ConnectionsModal']) {
        overrides['./components/' + component] = () => null;
      }
      loadTs(path.resolve(__dirname, '../src/App.tsx'), overrides).default();
      let prevented = false;
      handler({ key, code: '', ctrlKey, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false,
        target: new Target(protectedInput), preventDefault() { prevented = true; } });
      assert.equal(prevented, expected);
      assert.deepEqual(changes, expected ? [[0, true]] : []);
    }
  } finally { global.Element = OriginalElement; }
});
