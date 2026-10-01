import { api } from '../api/client';
import type { PanelState } from '../types';
import { currentItem } from './navigation';
import { joinPath } from './paths';

export function validateFileName(name: string): string {
  if (!name.trim() || name === '.' || name === '..' || /[\\/:<>"|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)) {
    throw new Error('Enter a valid file name without directory separators');
  }
  return name;
}

function sshSession(panel: PanelState): string {
  if (!panel.sshSessionId) throw new Error('SSH session is not active');
  return panel.sshSessionId;
}

export async function createTextFile(panel: PanelState, name: string, client = api): Promise<string> {
  validateFileName(name);
  const provider = panel.mode === 'ssh' ? 'sftp' : 'local';
  const result = await client.createFile(provider, panel.currentPath, name, panel.mode === 'ssh' ? sshSession(panel) : undefined);
  return result.path;
}

export async function renameCurrentItem(panel: PanelState, name: string, client = api): Promise<string | undefined> {
  const item = currentItem(panel);
  if (!item) return;
  validateFileName(name);
  const destination = joinPath(panel.currentPath, name, panel.mode);
  if (name === item.name) return item.id;
  if (panel.mode === 'ssh') {
    await client.sshRename(sshSession(panel), item.id, destination);
    return destination;
  }
  return (await client.rename(item.id, name)).newPath;
}

export async function currentItemProperties(panel: PanelState, client = api) {
  const item = currentItem(panel);
  if (!item) return;
  return panel.mode === 'ssh' ? client.sshGetFileInfo(sshSession(panel), item.id) : client.getFileInfo(item.id);
}
