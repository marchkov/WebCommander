import type { PanelState } from '../types';

export type TerminalPanel = Pick<PanelState, 'mode' | 'currentPath' | 'sshSessionId'>;
export type TerminalStatus = { phase: 'connecting' | 'ready' | 'stopped' | 'error'; message: string; requiresSshConnection?: boolean };

export function terminalUrl(location: { protocol: string; host: string }) {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/terminal`;
}

export function panelIdentity(panel: TerminalPanel) {
  return JSON.stringify([panel.mode, panel.mode === 'ssh' ? panel.sshSessionId || null : null]);
}

export function openPayload(panel: TerminalPanel) {
  if (panel.mode === 'ssh') {
    if (!panel.sshSessionId) throw new Error('Connect this panel to SSH first');
    return { type: 'open', provider: 'sftp', sessionId: panel.sshSessionId, cwd: panel.currentPath };
  }
  return { type: 'open', provider: 'local', cwd: panel.currentPath };
}

type TerminalAdapter = {
  cols: number; rows: number;
  write(data: string): void;
  focus(): void;
  onData(callback: (data: string) => void): { dispose(): void };
};

// Browser-independent controller; the React component owns rendering and fitting.
export function createTerminalSession(options: {
  terminal: TerminalAdapter;
  getPanel(): TerminalPanel;
  createSocket(): WebSocket;
  onStatus(status: TerminalStatus): void;
  disposeResources(): void;
}) {
  const { terminal, getPanel, onStatus } = options;
  let socket: WebSocket | null = null;
  let disposed = false;
  let ready = false;
  let identity = panelIdentity(getPanel());
  let dimensions = '';
  let ended = false;
  let hadError = false;

  function detach() {
    ready = false;
    const previous = socket;
    socket = null;
    if (!previous) return;
    previous.onopen = previous.onmessage = previous.onerror = previous.onclose = null;
    try {
      if (previous.readyState === 1) previous.send(JSON.stringify({ type: 'close' }));
    } catch {
      // The network may already be gone; still close and release resources.
    } finally {
      if (previous.readyState < 2) previous.close();
    }
  }

  function send(message: object) {
    if (!socket || socket.readyState !== 1) return;
    try { socket.send(JSON.stringify(message)); }
    catch {
      onStatus({ phase: 'error', message: 'Terminal connection failed' });
      hadError = true;
      detach();
    }
  }

  function resize() {
    if (!ready || disposed) return;
    const cols = Math.max(10, Math.min(500, terminal.cols));
    const rows = Math.max(2, Math.min(200, terminal.rows));
    const next = `${cols}:${rows}`;
    if (dimensions === next) return;
    dimensions = next;
    send({ type: 'resize', cols, rows });
  }

  const input = terminal.onData(data => {
    if (ready && !disposed) send({ type: 'input', data });
  });

  function connect() {
    if (disposed) return;
    detach();
    ended = hadError = false;
    dimensions = '';
    const panel = getPanel();
    identity = panelIdentity(panel);
    onStatus({ phase: 'connecting', message: 'Connecting…' });
    try {
      const payload = openPayload(panel);
      const connection = options.createSocket();
      socket = connection;
      const current = () => !disposed && socket === connection;
      connection.onopen = () => { if (current()) send(payload); };
      connection.onmessage = event => {
        if (!current()) return;
        try {
          const message = JSON.parse(event.data);
          switch (message.type) {
            case 'ready':
              ready = true;
              onStatus({ phase: 'ready', message: 'Connected' });
              resize();
              terminal.focus();
              break;
            case 'output':
              if (typeof message.data === 'string') terminal.write(message.data);
              break;
            case 'error':
              hadError = true;
              onStatus({ phase: 'error', message: String(message.message || 'Terminal error'),
                requiresSshConnection: panel.mode === 'ssh' && /SSH (connection (closed|ended|failed)|session (not found|does not belong))/i.test(message.message || '') });
              break;
            case 'exit':
              ready = false;
              ended = true;
              terminal.write(`\r\n[Process exited: ${message.code ?? message.signal ?? 'unknown'}]\r\n`);
              if (!hadError) onStatus({ phase: 'stopped', message: 'Process exited' });
              break;
          }
        } catch {
          hadError = true;
          onStatus({ phase: 'error', message: 'Invalid terminal response' });
          detach();
        }
      };
      connection.onerror = () => {
        if (!current()) return;
        hadError = true;
        ready = false;
        onStatus({ phase: 'error', message: 'Connection failed. Check that you are signed in and the server is available.' });
      };
      connection.onclose = () => {
        if (!current()) return;
        ready = false;
        if (!ended && !hadError) onStatus({ phase: 'stopped', message: 'Connection closed' });
      };
    } catch (error) {
      onStatus({ phase: 'error', message: error instanceof Error ? error.message : 'Cannot open terminal' });
    }
  }

  return {
    connect, resize,
    updatePanel() {
      if (identity !== panelIdentity(getPanel())) {
        detach();
        onStatus({ phase: 'stopped', message: 'Panel connection changed' });
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      detach();
      input.dispose();
      options.disposeResources();
    },
  };
}
