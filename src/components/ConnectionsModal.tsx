import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { SSHSession } from '../utils/connections';

export default function ConnectionsModal({ onClose, onUse, onDisconnect, onNew }: {
  onClose: () => void; onUse: (session: SSHSession) => Promise<void>;
  onDisconnect: (session: SSHSession) => Promise<void>; onNew: () => void;
}) {
  const [sessions, setSessions] = useState<SSHSession[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    api.sshSessions().then(items => { if (!cancelled) setSessions(items); })
      .catch(err => { if (!cancelled) setError(err.message); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, []);
  const run = async (action: () => Promise<void>, refresh = true) => {
    setBusy(true); setError('');
    try { await action(); if (refresh) setSessions(await api.sshSessions()); }
    catch (err) { setError(err instanceof Error ? err.message : 'Connection action failed'); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onKeyDown={event => {
    event.stopPropagation(); if (event.key === 'Escape') onClose();
  }}>
    <section role="dialog" aria-modal="true" aria-labelledby="connections-title" className="bg-gray-900 border border-gray-700 rounded-xl p-5 w-full max-w-xl shadow-xl">
      <div className="flex justify-between mb-4"><h2 id="connections-title">Active connections</h2><button autoFocus onClick={onClose} aria-label="Close connections">✕</button></div>
      {error && <p role="alert" className="text-red-400 mb-3">{error}</p>}
      {busy && <p role="status">Loading…</p>}
      {!busy && sessions.length === 0 && <p className="text-gray-400">No active SSH connections</p>}
      <ul className="max-h-80 overflow-auto">{sessions.map(session => <li key={session.sessionId} className="border-b border-gray-700 py-3">
        <p>{session.username}@{session.host}:{session.port}</p>
        <p className="text-xs text-gray-400">Connected {new Date(session.connectedAt).toLocaleString()}</p>
        <div className="flex gap-4 mt-2"><button disabled={busy} className="text-cyan-400 disabled:opacity-50" onClick={() => run(() => onUse(session), false)}>Use in active panel</button>
          <button disabled={busy} className="text-red-400 disabled:opacity-50" onClick={() => run(() => onDisconnect(session))}>Disconnect</button></div>
      </li>)}</ul>
      <button disabled={busy} onClick={onNew} className="mt-4 px-3 py-2 bg-cyan-700 rounded disabled:opacity-50">New SSH connection</button>
    </section>
  </div>;
}
