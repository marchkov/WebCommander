const { StringDecoder } = require('string_decoder');
const os = require('os');
const {
  chooseLocalShell, validateCwd, validateDimensions, quotePosix, closeShellChannel, killLocalPty,
} = require('./terminalShell');

class TerminalService {
  constructor({ localProvider, sshManager, authEnabled = true,
    ptyFactory = () => require('node-pty'), shellSelector = chooseLocalShell,
    openTimeoutMs = 15000, maxBufferedBytes = 1024 * 1024 }) {
    Object.assign(this, { localProvider, sshManager, authEnabled, ptyFactory,
      shellSelector, openTimeoutMs, maxBufferedBytes });
    this.sessions = new Set();
  }

  attach(socket, request) {
    const terminal = new TerminalSession(this, socket, request);
    this.sessions.add(terminal);
    terminal.start();
    return terminal;
  }

  close() {
    for (const terminal of this.sessions) terminal.finish(null, null);
  }
}

class TerminalSession {
  constructor(service, socket, request) {
    Object.assign(this, { service, socket, request });
    this.state = 'waiting';
    this.listeners = [];
    this.stopShell = null;
    this.abort = new AbortController();
  }

  start() {
    this.listen(this.socket, 'message', (data, binary) => {
      this.onMessage(data, binary).catch(error => this.fail(error));
    });
    this.listen(this.socket, 'close', () => this.dispose());
    this.listen(this.socket, 'error', () => this.dispose());
    this.timer = setTimeout(() => this.fail(new Error('Terminal open timed out')), this.service.openTimeoutMs);
    this.timer.unref();
    // Defense in depth for callers other than the HTTP upgrade handler.
    if (this.service.authEnabled && !this.request.session?.authenticated) {
      this.fail(new Error('Authentication required'), 1008);
    }
  }

  listen(emitter, event, listener) {
    emitter.on(event, listener);
    this.listeners.push(() => emitter.removeListener(event, listener));
  }

  send(message) {
    if (this.state === 'closed' || this.socket.readyState !== 1) return;
    if (this.socket.bufferedAmount > this.service.maxBufferedBytes) {
      this.dispose();
      this.socket.terminate();
      return;
    }
    this.socket.send(JSON.stringify(message), error => {
      if (error) {
        this.dispose();
        this.socket.terminate();
      }
    });
  }

  async onMessage(data, binary) {
    if (this.state === 'closed') return;
    let message;
    try {
      if (binary) throw new Error('Use JSON text messages');
      message = JSON.parse(data.toString());
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid terminal message');
    } catch (error) {
      this.fail(new Error(`Invalid terminal JSON: ${error.message}`), 1008);
      return;
    }
    if (message.type === 'close') return this.finish(null, null);
    if (message.type === 'open') {
      if (this.state !== 'waiting') return this.send({ type: 'error', message: 'Only one shell per WebSocket is allowed' });
      this.state = 'opening';
      await this.open(message);
      return;
    }
    if (this.state !== 'running') return this.send({ type: 'error', message: 'Terminal is not ready; send open first' });
    try {
      if (message.type === 'input') {
        if (typeof message.data !== 'string' || Buffer.byteLength(message.data) > 64 * 1024) {
          throw new Error('input data must be a UTF-8 string of at most 64 KiB');
        }
        this.write(message.data);
      } else if (message.type === 'resize') {
        validateDimensions(message.cols, message.rows);
        this.resize(message.cols, message.rows);
      } else {
        throw new Error('Unknown terminal message type');
      }
    } catch (error) {
      this.send({ type: 'error', message: error.message });
    }
  }

  async open(message) {
    const allowedKeys = ['type', 'provider', 'sessionId', 'cwd', 'cols', 'rows'];
    if (Object.keys(message).some(key => !allowedKeys.includes(key))) {
      throw new Error('Unsupported open parameters; terminal accepts existing sessions only');
    }
    const { provider, cwd, cols = 80, rows = 24 } = message;
    validateCwd(cwd);
    validateDimensions(cols, rows);
    if (provider === 'local') {
      if (message.sessionId !== undefined) throw new Error('Local terminals do not accept sessionId');
      const info = await this.service.localProvider.stat(cwd);
      if (info.type !== 'folder') throw new Error('Terminal cwd must be a directory');
      const realCwd = await this.service.localProvider.realpath(cwd);
      if (this.state === 'closed') return;
      const shell = this.service.shellSelector();
      const terminal = this.service.ptyFactory().spawn(shell.file, shell.args, {
        name: 'xterm-256color', cols, rows, cwd: realCwd,
        env: { ...process.env, TERM: 'xterm-256color' },
      });
      let exited = false;
      this.stopShell = () => killLocalPty(terminal, exited);
      if (typeof terminal.on === 'function') {
        this.listen(terminal, 'error', error => this.fail(new Error(`Local terminal failed: ${error.message}`)));
      }
      this.write = data => terminal.write(data);
      this.resize = (width, height) => terminal.resize(width, height);
      const dataListener = terminal.onData(data => this.send({ type: 'output', data }));
      const exitListener = terminal.onExit(({ exitCode, signal }) => {
        exited = true;
        // ConPTY keeps native handles/its output worker until kill(), even
        // after the shell exits. Unix PTYs have already reaped the process.
        if (process.platform !== 'win32') this.stopShell = null;
        const signalName = typeof signal === 'string' ? signal :
          Object.entries(os.constants.signals).find(([, value]) => value === signal)?.[0] || null;
        this.finish(exitCode, signalName);
      });
      this.listeners.push(() => dataListener.dispose(), () => exitListener.dispose());
    } else if (provider === 'sftp') {
      if (typeof message.sessionId !== 'string' || !message.sessionId || !cwd.startsWith('/')) {
        throw new Error('SSH terminal requires an existing sessionId and an absolute POSIX cwd');
      }
      const manager = this.service.sshManager;
      const { conn } = manager.getConnection(message.sessionId);
      this.listen(conn, 'close', () => this.fail(new Error('SSH connection closed')));
      this.listen(conn, 'end', () => this.fail(new Error('SSH connection ended')));
      this.listen(conn, 'error', error => this.fail(new Error(`SSH connection failed: ${error.message}`)));
      const channel = await manager.openShell(message.sessionId, {
        cols, rows, signal: this.abort.signal,
        ownerSessionId: this.service.authEnabled ? this.request.sessionID : undefined,
      });
      if (this.state === 'closed') {
        closeShellChannel(channel);
        return;
      }
      this.stopShell = () => closeShellChannel(channel);
      this.write = data => {
        if (channel.writableLength > this.service.maxBufferedBytes) throw new Error('SSH input buffer is full');
        channel.write(data);
      };
      this.resize = (width, height) => channel.setWindow(height, width, 0, 0);
      const stdout = new StringDecoder('utf8');
      const stderr = new StringDecoder('utf8');
      const output = (decoder, data) => {
        const text = typeof data === 'string' ? data : decoder.write(data);
        if (text) this.send({ type: 'output', data: text });
      };
      this.listen(channel, 'data', data => output(stdout, data));
      if (channel.stderr) this.listen(channel.stderr, 'data', data => output(stderr, data));
      this.listen(channel, 'error', error => this.fail(new Error(`SSH shell failed: ${error.message}`)));
      let exitCode = null;
      let exitSignal = null;
      this.listen(channel, 'exit', (code, signal) => { exitCode = code; exitSignal = signal; });
      this.listen(channel, 'close', (code, signal) => {
        this.stopShell = null;
        const trailing = stdout.end() + stderr.end();
        if (trailing) this.send({ type: 'output', data: trailing });
        this.finish(code ?? exitCode, signal ?? exitSignal);
      });
      // Quote every byte as a POSIX argument. Control characters are rejected
      // above because a PTY interprets them before the remote shell parses text.
      channel.write(`cd -- ${quotePosix(cwd)} || exit\n`);
    } else {
      throw new Error('Terminal provider must be local or sftp');
    }
    if (this.state === 'closed') return;
    this.state = 'running';
    clearTimeout(this.timer);
    this.send({ type: 'ready', provider, cwd });
  }

  fail(error, closeCode = 1011) {
    if (this.state === 'closed') return;
    this.send({ type: 'error', message: error.message || 'Terminal failed' });
    this.finish(null, null, closeCode);
  }

  finish(code, signal, closeCode = 1000) {
    if (this.state === 'closed') return;
    this.send({ type: 'exit', code: Number.isInteger(code) ? code : null,
      signal: typeof signal === 'string' ? signal : null });
    this.dispose();
    this.socket.close(closeCode);
  }

  dispose() {
    if (this.state === 'closed') return;
    this.state = 'closed';
    clearTimeout(this.timer);
    this.abort.abort();
    for (const dispose of this.listeners.splice(0)) dispose();
    try { this.stopShell?.(); } catch { /* Process or connection already exited. */ }
    this.stopShell = this.write = this.resize = this.request = null;
    this.service.sessions.delete(this);
  }
}

module.exports = TerminalService;
