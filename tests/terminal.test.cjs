const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const Module = require('module');

// Use the existing TypeScript compiler and Node runner, no DOM/test framework.
const filename = path.resolve(__dirname, '../src/terminal/session.ts');
const helper = new Module(filename, module);
helper._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { terminalUrl, openPayload, panelIdentity, createTerminalSession } = helper.exports;

class Socket {
  readyState = 0;
  sent = [];
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

function fixture(panel = { mode: 'local', currentPath: '/first' }) {
  const f = { panel, sockets: [], output: [], statuses: [], inputDisposals: 0, resourceDisposals: 0, focuses: 0 };
  f.terminal = { cols: 80, rows: 24, write: data => f.output.push(data), focus: () => f.focuses++,
    onData: callback => { f.input = callback; return { dispose: () => f.inputDisposals++ }; } };
  f.session = createTerminalSession({ terminal: f.terminal, getPanel: () => f.panel,
    createSocket: () => { const socket = new Socket(); f.sockets.push(socket); return socket; },
    onStatus: status => f.statuses.push(status), disposeResources: () => f.resourceDisposals++ });
  f.start = () => { f.session.connect(); const socket = f.sockets.at(-1); socket.open(); socket.message({ type: 'ready' }); return socket; };
  return f;
}

test('WebSocket URL uses current host with ws/wss', () => {
  assert.equal(terminalUrl({ protocol: 'http:', host: 'localhost:3000' }), 'ws://localhost:3000/api/terminal');
  assert.equal(terminalUrl({ protocol: 'https:', host: 'files.example' }), 'wss://files.example/api/terminal');
});

test('local and SSH open payloads only include protocol fields', () => {
  assert.deepEqual(openPayload({ mode: 'local', currentPath: 'D:/data', password: 'secret' }),
    { type: 'open', provider: 'local', cwd: 'D:/data' });
  assert.deepEqual(openPayload({ mode: 'ssh', currentPath: '/home/a', sshSessionId: 'ssh-1', host: 'host', password: 'secret', privateKey: 'key' }),
    { type: 'open', provider: 'sftp', cwd: '/home/a', sessionId: 'ssh-1' });
  assert.throws(() => openPayload({ mode: 'ssh', currentPath: '/' }), /Connect/);
});

test('output writes to terminal and input is sent only after ready', () => {
  const f = fixture();
  f.session.connect();
  const socket = f.sockets[0];
  f.input('before socket open');
  socket.open();
  f.input('before ready');
  assert.deepEqual(socket.sent, [{ type: 'open', provider: 'local', cwd: '/first' }]);
  socket.message({ type: 'ready' });
  assert.equal(f.focuses, 1);
  f.input('pwd\r');
  assert.deepEqual(socket.sent.at(-1), { type: 'input', data: 'pwd\r' });
  socket.message({ type: 'output', data: '\u001b[32mhello\r\n' });
  assert.deepEqual(f.output, ['\u001b[32mhello\r\n']);
  f.session.dispose();
});

test('resize deduplicates dimensions and clamps backend limits', () => {
  const f = fixture(); const socket = f.start();
  f.session.resize(); f.session.resize();
  assert.equal(socket.sent.filter(m => m.type === 'resize').length, 1);
  f.terminal.cols = 100; f.terminal.rows = 30; f.session.resize();
  assert.deepEqual(socket.sent.at(-1), { type: 'resize', cols: 100, rows: 30 });
  f.terminal.cols = 2; f.terminal.rows = 900; f.session.resize();
  assert.deepEqual(socket.sent.at(-1), { type: 'resize', cols: 10, rows: 200 });
  f.session.dispose();
});

test('close sends protocol close, detaches socket and disposes resources exactly once', () => {
  const f = fixture(); const socket = f.start();
  f.session.dispose(); f.session.dispose();
  assert.deepEqual(socket.sent.at(-1), { type: 'close' });
  assert.equal(socket.readyState, 3);
  for (const event of ['onopen', 'onmessage', 'onerror', 'onclose']) assert.equal(socket[event], null);
  assert.equal(f.inputDisposals, 1); assert.equal(f.resourceDisposals, 1);
  const count = socket.sent.length; f.input('ignored'); assert.equal(socket.sent.length, count);
});

test('disposing a connecting socket prevents late open from spawning shell', () => {
  const f = fixture(); f.session.connect(); const socket = f.sockets[0];
  const onOpen = socket.onopen;
  f.session.dispose(); onOpen();
  assert.equal(socket.sent.length, 0); assert.equal(socket.readyState, 3);
});

test('navigation leaves running shell alone; reconnect uses current cwd', () => {
  const f = fixture(); const first = f.start();
  const count = first.sent.length;
  f.panel = { ...f.panel, currentPath: '/second' };
  f.session.updatePanel();
  assert.equal(first.sent.length, count); assert.equal(first.readyState, 1);
  const staleMessage = first.onmessage;
  f.session.connect(); const second = f.sockets[1]; second.open();
  assert.equal(first.readyState, 3);
  assert.equal(second.sent[0].cwd, '/second');
  staleMessage({ data: JSON.stringify({ type: 'output', data: 'stale' }) });
  assert.deepEqual(f.output, []);
  f.session.dispose();
});

test('panel mode or SSH session change closes stale shell; cwd changes preserve identity', () => {
  assert.equal(panelIdentity({ mode: 'local', currentPath: '/a' }), panelIdentity({ mode: 'local', currentPath: '/b' }));
  for (const panel of [{ mode: 'local', currentPath: '/' }, { mode: 'ssh', currentPath: '/', sshSessionId: 'new' }, { mode: 'ssh', currentPath: '/' }]) {
    const f = fixture({ mode: 'ssh', sshSessionId: 'old', currentPath: '/' }); const socket = f.start();
    f.panel = panel; f.session.updatePanel();
    assert.equal(socket.readyState, 3); assert.deepEqual(socket.sent.at(-1), { type: 'close' });
    f.session.dispose();
  }
});

test('exit retains output and does not automatically reconnect', () => {
  const f = fixture(); const socket = f.start();
  socket.message({ type: 'output', data: 'history' });
  socket.message({ type: 'exit', code: 0, signal: null }); socket.close();
  assert.deepEqual(f.output, ['history', '\r\n[Process exited: 0]\r\n']);
  assert.equal(f.statuses.at(-1).phase, 'stopped');
  const count = socket.sent.length; f.input('ignored'); assert.equal(socket.sent.length, count);
  assert.equal(f.sockets.length, 1); f.session.dispose();
});

test('SSH disconnect shows error and requires a new SSH connection', () => {
  const f = fixture({ mode: 'ssh', sshSessionId: 'old', currentPath: '/' }); const socket = f.start();
  socket.message({ type: 'error', message: 'SSH connection closed' });
  socket.message({ type: 'exit', code: null }); socket.close();
  assert.equal(f.statuses.at(-1).requiresSshConnection, true);
  assert.equal(f.statuses.at(-1).message, 'SSH connection closed');
  f.session.dispose();
});

test('independent panels own separate sockets and resource lifetimes', () => {
  const left = fixture(); const right = fixture();
  const a = left.start(); const b = right.start();
  left.session.dispose(); right.input('right');
  assert.equal(a.readyState, 3); assert.equal(b.readyState, 1);
  assert.deepEqual(b.sent.at(-1), { type: 'input', data: 'right' });
  right.session.dispose();
});

test('transport errors and malformed responses preserve usable error state', () => {
  const f = fixture(); const socket = f.start();
  socket.onerror(); socket.close();
  assert.equal(f.statuses.at(-1).phase, 'error');
  f.session.connect(); const second = f.sockets[1]; second.open();
  second.onmessage({ data: 'bad JSON' });
  assert.equal(second.readyState, 3); assert.equal(f.statuses.at(-1).message, 'Invalid terminal response');
  f.session.dispose();
});
