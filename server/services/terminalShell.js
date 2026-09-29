const fs = require('fs');
const path = require('path');

function validateCwd(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim() || cwd.length > 4096 || /[\x00-\x1f\x7f]/.test(cwd)) {
    throw new Error('cwd must be a nonempty path without control characters');
  }
  return cwd;
}

function quotePosix(value) {
  validateCwd(value);
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function validateDimensions(cols, rows) {
  if (!Number.isInteger(cols) || cols < 10 || cols > 500 ||
      !Number.isInteger(rows) || rows < 2 || rows > 200) {
    throw new Error('Terminal dimensions must be integers: cols 10–500, rows 2–200');
  }
}

function chooseLocalShell({ platform = process.platform, env = process.env, isExecutable } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  isExecutable ||= file => {
    try {
      fs.accessSync(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
      return fs.statSync(file).isFile();
    } catch { return false; }
  };
  const environment = name => env[Object.keys(env).find(key => key.toLowerCase() === name.toLowerCase())];
  const find = name => (environment('PATH') || '').split(paths.delimiter)
    .filter(Boolean).map(directory => paths.join(directory.replace(/^"|"$/g, ''), name)).find(isExecutable);
  if (platform === 'win32') {
    const systemRoot = environment('SystemRoot') || 'C:\\Windows';
    const candidates = [find('pwsh.exe'), find('powershell.exe'),
      paths.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      environment('ComSpec'), paths.join(systemRoot, 'System32', 'cmd.exe')];
    const file = candidates.find(candidate => candidate && isExecutable(candidate));
    if (!file) throw new Error('No local shell is available');
    return { file, args: /(?:pwsh|powershell)\.exe$/i.test(file) ? ['-NoLogo', '-NoProfile'] : [] };
  }
  const file = [env.SHELL, '/bin/bash', '/bin/sh'].find(candidate => candidate && isExecutable(candidate));
  if (!file) throw new Error('No local shell is available');
  return { file, args: [] };
}

// Channels may emit a final asynchronous error after end/destroy. Keep only a
// temporary error sink until close; never remove SSHManager's own listeners.
function closeShellChannel(channel) {
  const ignore = () => {};
  channel.on('error', ignore);
  channel.once('close', () => channel.removeListener('error', ignore));
  try { channel.end(); } catch { /* Already disconnected. */ }
  try { channel.destroy(); } catch { /* Already disconnected. */ }
}

function killLocalPty(terminal, exited = false, platform = process.platform) {
  // node-pty 1.1's ConPTY kill enumerates processes in an already-closed
  // console after natural exit (upstream #952), while skipping kill leaks its
  // output worker (#887). Avoid only that obsolete enumeration; still call
  // the public kill() so node-pty releases all native resources. Feature-guard
  // this Windows-only compatibility shim; no library/global state is changed.
  const agent = terminal._agent;
  if (platform === 'win32' && exited && terminal._isReady &&
      agent?._exitCode !== undefined && typeof agent._getConsoleProcessList === 'function') {
    const getProcesses = agent._getConsoleProcessList;
    agent._getConsoleProcessList = () => Promise.resolve([]);
    try { terminal.kill(); } finally { agent._getConsoleProcessList = getProcesses; }
  } else {
    terminal.kill();
  }
}

module.exports = { chooseLocalShell, validateCwd, validateDimensions, quotePosix, closeShellChannel, killLocalPty };
