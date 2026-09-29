const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const TerminalService = require('./terminalService');
const LocalProvider = require('../providers/localProvider');
const { chooseLocalShell } = require('./terminalShell');

test('real local PTY starts in requested directory, produces output and exits', {
  skip: process.env.WC_TEST_REAL_PTY !== '1' && 'Set WC_TEST_REAL_PTY=1 for the native PTY smoke test',
  timeout: 15000,
}, async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webcommander-real-pty-'));
  const cwd = path.join(root, 'directory with spaces');
  await fs.promises.mkdir(cwd);
  const shell = chooseLocalShell();
  const service = new TerminalService({
    localProvider: new LocalProvider({ rootPath: root, allowedPaths: [root] }),
    sshManager: {}, shellSelector: () => shell,
  });
  t.after(async () => {
    service.close();
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('webcommander-real-pty-'));
    await fs.promises.rm(root, { recursive: true, force: true });
  });
  const socket = new EventEmitter();
  socket.readyState = 1;
  socket.bufferedAmount = 0;
  socket.close = () => { socket.readyState = 3; socket.emit('close'); };
  socket.terminate = socket.close;
  let output = '';
  let complete;
  let failed;
  const completion = new Promise((resolve, reject) => { complete = resolve; failed = reject; });
  completion.catch(() => {});
  socket.send = (data, callback) => {
    const message = JSON.parse(data);
    if (message.type === 'output') output += message.data;
    if (message.type === 'error') failed(new Error(message.message));
    if (message.type === 'exit') complete(message);
    callback?.();
  };
  const terminal = service.attach(socket, { session: { authenticated: true }, sessionID: 'test' });
  await terminal.onMessage(Buffer.from(JSON.stringify({ type: 'open', provider: 'local', cwd })));
  const command = process.platform !== 'win32' ? "printf 'WC_%s\\n' 'PTY_OK'; pwd; exit 0\r" :
    /(?:pwsh|powershell)\.exe$/i.test(shell.file) ? "Write-Output ('WC_' + 'PTY_OK'); (Get-Location).Path; exit 0\r" :
      'echo WC_PTY_OK & cd & exit 0\r';
  await terminal.onMessage(Buffer.from(JSON.stringify({ type: 'input', data: command })));
  const exit = await completion;
  assert.equal(exit.code, 0);
  assert.ok(output.includes('WC_PTY_OK'), 'shell must execute the command');
  assert.ok(output.includes(cwd), 'shell must print its actual cwd');
  assert.equal(service.sessions.size, 0);
});
