const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const TerminalService = require('./terminalService');
const SSHManager = require('../sshManager');
const LocalProvider = require('../providers/localProvider');
const { chooseLocalShell, quotePosix, killLocalPty } = require('./terminalShell');

class FakeSocket extends EventEmitter {
  constructor() { super(); this.readyState = 1; this.bufferedAmount = 0; this.messages = []; }
  send(data, callback) { this.messages.push(JSON.parse(data)); callback?.(); }
  close(code) { this.closeCode = code; this.readyState = 3; this.emit('close'); }
  terminate() { this.terminated = true; this.close(1006); }
}

class FakePty extends EventEmitter {
  constructor() { super(); this.inputs = []; this.sizes = []; this.kills = 0; }
  onData(fn) { this.on('data', fn); return { dispose: () => this.off('data', fn) }; }
  onExit(fn) { this.on('exit', fn); return { dispose: () => this.off('exit', fn) }; }
  write(data) { this.inputs.push(data); }
  resize(cols, rows) { this.sizes.push([cols, rows]); }
  kill() { this.kills++; }
}

class FakeChannel extends EventEmitter {
  constructor() { super(); this.inputs = []; this.sizes = []; this.stderr = new EventEmitter(); this.writableLength = 0; }
  write(data) { this.inputs.push(data); }
  setWindow(...size) { this.sizes.push(size); }
  end() { this.ended = true; }
  destroy() { this.destroyed = true; queueMicrotask(() => this.emit('close')); }
}

async function fixture(t, overrides = {}) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webcommander-terminal-'));
  const cwd = path.join(root, 'allowed');
  const blocked = path.join(cwd, 'blocked');
  await fs.promises.mkdir(blocked, { recursive: true });
  const terminal = new FakePty();
  const spawns = [];
  const channel = new FakeChannel();
  const conn = new EventEmitter();
  conn.on('error', () => {}); // Mirrors the connection manager's persistent handler.
  conn.shellCalls = [];
  conn.shell = (options, callback) => {
    conn.shellCalls.push(options);
    queueMicrotask(() => callback(null, channel));
  };
  class Manager extends SSHManager {
    static getConnection(id) {
      if (id !== 'existing') throw new Error('SSH session not found');
      return { conn, ownerSessionId: 'browser-session' };
    }
  }
  const service = new TerminalService({
    localProvider: new LocalProvider({ rootPath: cwd, allowedPaths: [cwd], blockedPaths: [blocked] }),
    sshManager: Manager,
    ptyFactory: () => ({ spawn(...args) { spawns.push(args); return terminal; } }),
    shellSelector: () => ({ file: 'test-shell', args: [] }),
    ...overrides,
  });
  t.after(async () => {
    service.close();
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('webcommander-terminal-'));
    await fs.promises.rm(root, { recursive: true, force: true });
  });
  const socket = new FakeSocket();
  const request = { session: { authenticated: true }, sessionID: 'browser-session' };
  const controller = service.attach(socket, request);
  const send = async message => {
    await controller.onMessage(Buffer.from(JSON.stringify(message)), false).catch(error => controller.fail(error));
  };
  return { root, cwd, blocked, service, terminal, spawns, socket, controller, send, conn, channel, Manager, request };
}

test('authenticated local shell starts in validated cwd and forwards input, output, resize', async t => {
  const f = await fixture(t);
  await f.send({ type: 'open', provider: 'local', cwd: f.cwd, cols: 120, rows: 30 });
  assert.equal(f.spawns.length, 1);
  assert.equal(f.spawns[0][2].cwd, await fs.promises.realpath(f.cwd));
  assert.equal(f.spawns[0][2].cols, 120);
  assert.equal(f.spawns[0][2].rows, 30);
  assert.equal(f.socket.messages.at(-1).type, 'ready');
  f.socket.emit('message', Buffer.from(JSON.stringify({ type: 'input', data: 'echo hello\r' })), false);
  assert.deepEqual(f.terminal.inputs, ['echo hello\r']);
  f.terminal.emit('data', 'hello\r\n');
  assert.deepEqual(f.socket.messages.at(-1), { type: 'output', data: 'hello\r\n' });
  await f.send({ type: 'resize', cols: 140, rows: 40 });
  assert.deepEqual(f.terminal.sizes, [[140, 40]]);
  f.socket.close(1000);
  assert.equal(f.terminal.kills, 1);
  assert.equal(f.terminal.listenerCount('data'), 0);
  assert.equal(f.terminal.listenerCount('exit'), 0);
  assert.equal(f.service.sessions.size, 0);
  assert.equal(f.controller.request, null);
});

test('service rejects unauthenticated clients in addition to upgrade authentication', async t => {
  const { service, spawns } = await fixture(t);
  const socket = new FakeSocket();
  service.attach(socket, { session: {} });
  assert.equal(socket.closeCode, 1008);
  assert.match(socket.messages[0].message, /Authentication required/);
  assert.equal(spawns.length, 0);
});

for (const kind of ['outside', 'blocked', 'file', 'symlink']) {
  test(`rejects ${kind} local cwd before spawning`, async t => {
    const f = await fixture(t);
    let cwd = kind === 'outside' ? f.root : f.blocked;
    if (kind === 'file') {
      cwd = path.join(f.cwd, 'file.txt');
      await fs.promises.writeFile(cwd, 'file');
    }
    if (kind === 'symlink') {
      cwd = path.join(f.cwd, 'link');
      await fs.promises.symlink(f.root, cwd, process.platform === 'win32' ? 'junction' : 'dir');
    }
    await f.send({ type: 'open', provider: 'local', cwd });
    assert.equal(f.spawns.length, 0);
    assert.equal(f.socket.messages[0].type, 'error');
    assert.equal(f.socket.readyState, 3);
  });
}

test('terminal exit reports status, disposes listeners and closes socket normally', async t => {
  const f = await fixture(t);
  await f.send({ type: 'open', provider: 'local', cwd: f.cwd });
  f.terminal.emit('exit', { exitCode: 7, signal: 0 });
  assert.deepEqual(f.socket.messages.at(-1), { type: 'exit', code: 7, signal: null });
  assert.equal(f.socket.closeCode, 1000);
  assert.equal(f.terminal.kills, process.platform === 'win32' ? 1 : 0);
  assert.equal(f.terminal.listenerCount('exit'), 0);
  assert.equal(f.service.sessions.size, 0);
});

test('invalid resize and input are rejected without reaching the PTY', async t => {
  const f = await fixture(t);
  await f.send({ type: 'open', provider: 'local', cwd: f.cwd });
  for (const [cols, rows] of [[9, 24], [501, 24], [80, 1], [80, 201], [10.5, 24], ['80', 24], [null, 24]]) {
    await f.send({ type: 'resize', cols, rows });
    assert.equal(f.socket.messages.at(-1).type, 'error');
  }
  await f.send({ type: 'input', data: {} });
  assert.deepEqual(f.terminal.sizes, []);
  assert.deepEqual(f.terminal.inputs, []);
  assert.equal(f.controller.state, 'running');
});

test('only one shell is created, and close message kills it exactly once', async t => {
  const f = await fixture(t);
  const message = { type: 'open', provider: 'local', cwd: f.cwd };
  await Promise.all([f.send(message), f.send(message)]);
  await f.send(message);
  assert.equal(f.spawns.length, 1);
  await f.send({ type: 'close' });
  await f.send(message);
  assert.equal(f.spawns.length, 1);
  assert.equal(f.terminal.kills, 1);
});

test('socket closing during asynchronous cwd validation never spawns a shell', async t => {
  const f = await fixture(t);
  const opening = f.send({ type: 'open', provider: 'local', cwd: f.cwd });
  f.socket.close(1000);
  await opening;
  assert.equal(f.spawns.length, 0);
});

test('slow output consumer terminates socket and cleans up PTY', async t => {
  const f = await fixture(t);
  await f.send({ type: 'open', provider: 'local', cwd: f.cwd });
  f.socket.bufferedAmount = 2 * 1024 * 1024;
  f.terminal.emit('data', 'output');
  assert.equal(f.terminal.kills, 1);
  assert.equal(f.socket.terminated, true);
});

test('SSH terminal reuses connection, requests PTY, safely changes cwd, and forwards protocol', async t => {
  const f = await fixture(t);
  const cwd = "/home/test/a b/'$(touch nope);`id`";
  await f.send({ type: 'open', provider: 'sftp', sessionId: 'existing', cwd });
  assert.deepEqual(f.conn.shellCalls, [{ term: 'xterm-256color', cols: 80, rows: 24, height: 0, width: 0 }]);
  assert.equal(f.channel.inputs[0], "cd -- '/home/test/a b/'\"'\"'$(touch nope);`id`' || exit\n");
  await f.send({ type: 'input', data: 'pwd\n' });
  assert.equal(f.channel.inputs[1], 'pwd\n');
  const bytes = Buffer.from('Привет 👋');
  f.channel.emit('data', bytes.subarray(0, 1));
  f.channel.emit('data', bytes.subarray(1));
  f.channel.stderr.emit('data', Buffer.from('stderr'));
  assert.deepEqual(f.socket.messages.filter(message => message.type === 'output').map(message => message.data), ['Привет 👋', 'stderr']);
  await f.send({ type: 'resize', cols: 100, rows: 50 });
  assert.deepEqual(f.channel.sizes, [[50, 100, 0, 0]]);
  f.socket.close(1000);
  assert.equal(f.channel.ended, true);
  assert.equal(f.channel.destroyed, true);
  assert.equal(f.channel.listenerCount('data'), 0);
  assert.equal(f.conn.listenerCount('close'), 0);
  assert.equal(f.conn.listenerCount('error'), 1);
});

test('SSH exit waits for close so trailing output is delivered', async t => {
  const f = await fixture(t);
  await f.send({ type: 'open', provider: 'sftp', sessionId: 'existing', cwd: '/home/test' });
  f.channel.emit('exit', 3, 'TERM');
  f.channel.emit('data', Buffer.from('last output'));
  f.channel.emit('close');
  assert.deepEqual(f.socket.messages.slice(-2), [
    { type: 'output', data: 'last output' }, { type: 'exit', code: 3, signal: 'TERM' },
  ]);
  assert.equal(f.socket.closeCode, 1000);
});

test('missing or another user SSH session returns error without shell creation', async t => {
  for (const sessionId of ['missing', 'existing']) {
    const f = await fixture(t);
    f.request.sessionID = 'another-browser';
    await f.send({ type: 'open', provider: 'sftp', sessionId, cwd: '/home/test' });
    assert.equal(f.socket.messages[0].type, 'error');
    assert.equal(f.conn.shellCalls.length, 0);
  }
});

test('underlying SSH disconnect/error ends channel and socket without throwing', async t => {
  for (const event of ['close', 'end', 'error']) {
    const f = await fixture(t);
    await f.send({ type: 'open', provider: 'sftp', sessionId: 'existing', cwd: '/home/test' });
    assert.doesNotThrow(() => f.conn.emit(event, new Error('network failure')));
    assert.equal(f.socket.messages.at(-2).type, 'error');
    assert.equal(f.socket.messages.at(-1).type, 'exit');
    assert.equal(f.channel.ended, true);
    assert.equal(f.service.sessions.size, 0);
  }
});

test('late SSH shell callback after socket close closes the orphan channel', async t => {
  const f = await fixture(t);
  let callback;
  f.conn.shell = (_options, cb) => { callback = cb; };
  const opening = f.send({ type: 'open', provider: 'sftp', sessionId: 'existing', cwd: '/home/test' });
  f.socket.close(1000);
  await opening;
  callback(null, f.channel);
  assert.equal(f.channel.ended, true);
  assert.equal(f.channel.destroyed, true);
  assert.equal(f.conn.listenerCount('close'), 0);
});

test('pending SSH shell fails cleanly on disconnect and callback error', async t => {
  for (const disconnect of [true, false]) {
    const f = await fixture(t);
    f.conn.shell = (_options, callback) => {
      queueMicrotask(() => disconnect ? f.conn.emit('close') : callback(new Error('PTY denied')));
    };
    await f.send({ type: 'open', provider: 'sftp', sessionId: 'existing', cwd: '/home/test' });
    assert.equal(f.controller.state, 'closed');
    assert.equal(f.service.sessions.size, 0);
  }
});

test('open validates credentials, dimensions, cwd control characters and provider', async t => {
  for (const extra of [{ password: 'secret' }, { host: 'host' }, { privateKey: 'key' },
    { cols: 99999 }, { cwd: '/tmp/bad\rcommand' }, { cwd: '/tmp/bad\ncommand' },
    { provider: 'ftp' }]) {
    const f = await fixture(t);
    await f.send({ type: 'open', provider: 'sftp', sessionId: 'existing', cwd: '/tmp', ...extra });
    assert.equal(f.conn.shellCalls.length, 0);
    assert.equal(f.spawns.length, 0);
    assert.equal(f.socket.messages[0].type, 'error');
  }
});

test('invalid JSON and binary messages fail cleanly', async t => {
  for (const binary of [false, true]) {
    const f = await fixture(t);
    await f.controller.onMessage(Buffer.from('not JSON'), binary);
    assert.equal(f.socket.closeCode, 1008);
    assert.equal(f.spawns.length, 0);
  }
});

test('local shell selection prefers PowerShell on Windows and respects Unix fallbacks', () => {
  const win = { platform: 'win32', env: { PATH: 'C:\\Tools', SystemRoot: 'C:\\Windows' } };
  assert.deepEqual(chooseLocalShell({ ...win, isExecutable: file => file === 'C:\\Tools\\pwsh.exe' }),
    { file: 'C:\\Tools\\pwsh.exe', args: ['-NoLogo', '-NoProfile'] });
  assert.match(chooseLocalShell({ ...win, isExecutable: file => file.endsWith('powershell.exe') }).file, /powershell\.exe$/);
  assert.match(chooseLocalShell({ ...win, isExecutable: file => file.endsWith('cmd.exe') }).file, /cmd\.exe$/);
  for (const file of ['/custom/shell', '/bin/bash', '/bin/sh']) {
    assert.equal(chooseLocalShell({ platform: 'linux', env: { SHELL: '/custom/shell' },
      isExecutable: candidate => candidate === file }).file, file);
  }
  assert.equal(quotePosix("/tmp/a'b"), `'/tmp/a'"'"'b'`);
  assert.throws(() => quotePosix('/tmp/a\x03b'), /control characters/);
});

test('local PTY error closes socket and releases the shell without crashing', async t => {
  const f = await fixture(t);
  await f.send({ type: 'open', provider: 'local', cwd: f.cwd });
  assert.doesNotThrow(() => f.terminal.emit('error', new Error('PTY failed')));
  assert.equal(f.terminal.kills, 1);
  assert.equal(f.socket.messages.at(-2).type, 'error');
});

test('local PTY EIO follows platform error semantics and preserves Unix exit results', async t => {
  const f = await fixture(t);
  await f.send({ type: 'open', provider: 'local', cwd: f.cwd });
  f.terminal.emit('data', 'completed\r\n');
  f.terminal.emit('error', Object.assign(new Error('read EIO'), { code: 'EIO' }));
  if (process.platform === 'win32') {
    assert.equal(f.terminal.kills, 1);
    assert.equal(f.socket.messages.at(-2).type, 'error');
    return;
  }
  assert.equal(f.socket.readyState, 1);
  assert.equal(f.terminal.kills, 0);
  f.terminal.emit('exit', { exitCode: 7 });
  assert.equal(f.socket.messages.some(message => message.type === 'error'), false);
  assert.ok(f.socket.messages.some(message => message.type === 'output' && message.data === 'completed\r\n'));
  assert.equal(f.socket.messages.find(message => message.type === 'exit').code, 7);
  assert.equal(f.service.sessions.size, 0);
});

test('Windows natural-exit cleanup skips dead-console enumeration but releases native resources', async () => {
  let enumerations = 0;
  let released = 0;
  const enumerate = () => { enumerations++; return Promise.resolve([123]); };
  const agent = { _exitCode: 0, _getConsoleProcessList: enumerate };
  let processes;
  const terminal = { _agent: agent, _isReady: true, kill() {
    processes = agent._getConsoleProcessList();
    released++;
  } };
  killLocalPty(terminal, true, 'win32');
  assert.equal(enumerations, 0);
  assert.equal(released, 1);
  assert.deepEqual(await processes, []);
  assert.equal(agent._getConsoleProcessList, enumerate);
});
