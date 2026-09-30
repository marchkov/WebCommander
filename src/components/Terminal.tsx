import React, { useEffect, useRef, useState } from 'react';
import { Terminal as Xterm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { PanelState } from '../types';
import { createTerminalSession, terminalUrl, TerminalStatus } from '../terminal/session';

export default function Terminal({ panel, onClose }: { panel: PanelState; onClose(): void }) {
  const container = useRef<HTMLDivElement>(null);
  const latestPanel = useRef(panel);
  latestPanel.current = panel;
  const session = useRef<ReturnType<typeof createTerminalSession> | null>(null);
  const [status, setStatus] = useState<TerminalStatus>({ phase: 'connecting', message: 'Connecting…' });

  useEffect(() => {
    const element = container.current!;
    const terminal = new Xterm({ cursorBlink: true, scrollback: 4000, fontSize: 13,
      fontFamily: 'Consolas, Menlo, monospace', theme: { background: '#030712', foreground: '#e5e7eb' } });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    let disposed = false;
    let frame = 0;
    const scheduleFit = () => {
      if (disposed || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (disposed || element.clientWidth === 0 || element.clientHeight === 0) return;
        fit.fit();
        const cols = Math.max(10, Math.min(500, terminal.cols));
        const rows = Math.max(2, Math.min(200, terminal.rows));
        if (cols !== terminal.cols || rows !== terminal.rows) terminal.resize(cols, rows);
        controller.resize();
      });
    };
    const observer = new ResizeObserver(scheduleFit);
    const controller = createTerminalSession({ terminal,
      getPanel: () => latestPanel.current,
      createSocket: () => new WebSocket(terminalUrl(window.location)),
      onStatus: setStatus,
      disposeResources: () => {
        disposed = true;
        cancelAnimationFrame(frame);
        observer.disconnect();
        window.removeEventListener('resize', scheduleFit);
        terminal.dispose(); // Disposes loaded addons too.
      },
    });
    session.current = controller;
    observer.observe(element);
    window.addEventListener('resize', scheduleFit);
    document.fonts.ready.then(scheduleFit);
    scheduleFit();
    controller.connect();
    return () => { controller.dispose(); session.current = null; };
  }, []);

  useEffect(() => { session.current?.updatePanel(); }, [panel.mode, panel.sshSessionId]);
  const canReconnect = panel.mode === 'local' || (Boolean(panel.sshSessionId) && !status.requiresSshConnection);
  const label = panel.mode === 'ssh' ? `SSH: ${panel.sshUser || ''}@${panel.sshHost || ''}` : 'Local terminal';
  return (
    <section data-terminal-drawer aria-label={label} className="h-[250px] shrink-0 flex flex-col min-w-0 bg-gray-950 border-t border-gray-700"
      onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <div className="flex items-center gap-2 px-3 py-1 text-xs shrink-0">
        <span className="text-gray-300 shrink-0">{label}</span>
        <span role="status" className="text-gray-400 truncate flex-1" title={status.message}>{status.message}</span>
        {(status.phase === 'stopped' || status.phase === 'error') && (
          <button disabled={!canReconnect} title="Reconnect terminal in current panel directory" aria-label="Reconnect terminal"
            className="text-cyan-400 disabled:text-gray-600" onClick={() => session.current?.connect()}>Reconnect</button>
        )}
        <button title="Close terminal" aria-label="Close terminal" className="text-gray-400 hover:text-white" onClick={onClose}>×</button>
      </div>
      <div ref={container} className="flex-1 min-h-0 min-w-0 overflow-hidden px-2 pb-2" />
    </section>
  );
}
