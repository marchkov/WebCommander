import type { PanelState } from '../types';

export type SSHSession = { sessionId: string; host: string; port: number; username: string; connectedAt: string; status: 'ready' };
export const PANEL_STORAGE_KEY = 'webcommander.panels';
export function serializePanels(left: PanelState, right: PanelState): string {
  const binding = (panel: PanelState) => ({ mode: panel.mode, currentPath: panel.currentPath,
    ...(panel.mode === 'ssh' ? { sshSessionId: panel.sshSessionId } : {}) });
  return JSON.stringify({ left: binding(left), right: binding(right) });
}
export function readBindings(value: string | null): Record<string, any> {
  try { const parsed = JSON.parse(value || '{}'); return parsed && typeof parsed === 'object' ? parsed : {}; }
  catch { return {}; }
}
export function localPanel(panel: PanelState): PanelState {
  return { ...panel, mode: 'local', sshSessionId: undefined, sshHost: undefined, sshUser: undefined,
    currentPath: '/', files: [], selectedItems: [], focusedItemId: undefined };
}
export function attachSession(panel: PanelState, session: SSHSession): PanelState {
  return { ...localPanel(panel), mode: 'ssh', sshSessionId: session.sessionId,
    sshHost: session.host, sshUser: session.username, currentPath: '~' };
}
type Directory = { path: string; files: PanelState['files'] };
export async function restorePanel(panel: PanelState, binding: any, sessions: SSHSession[],
  read: (panel: PanelState, path: string) => Promise<Directory>): Promise<PanelState> {
  const session = binding?.mode === 'ssh' && sessions.find(item => item.sessionId === binding.sshSessionId);
  let next = session ? attachSession(panel, session) : localPanel(panel);
  const savedPath = typeof binding?.currentPath === 'string' && (session || binding?.mode === 'local') ? binding.currentPath : next.currentPath;
  for (const path of [...new Set([savedPath, next.currentPath])]) {
    try { const data = await read(next, path); return { ...next, currentPath: data.path, files: data.files }; }
    catch { /* A stale path may still have a working home/root. */ }
  }
  if (session) {
    next = localPanel(panel);
    try { const data = await read(next, '/'); return { ...next, currentPath: data.path, files: data.files }; } catch { /* Keep usable empty local panel. */ }
  }
  return next;
}
