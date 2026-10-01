import type { FileItem, PanelState } from '../types';
import { isRootPath } from './paths';

export const PARENT_ITEM_ID = '..';

type SelectionAction = 'all' | 'clear' | 'invert' | 'insert';
type CommanderCommand = SelectionAction | 'connections' | 'refresh' | 'swap' | 'pack' | 'extract' | 'newFile' | 'rename' | 'properties' | 'terminal'
  | 'down' | 'up' | 'parent' | 'open' | 'view' | 'edit' | 'copy' | 'move' | 'mkdir' | 'delete' | 'switchPanel';
export function connectionShortcut(event: { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): CommanderCommand | undefined {
  const { key, code, ctrlKey, metaKey, altKey, shiftKey } = event;
  if ((ctrlKey || metaKey) && !altKey && !shiftKey) {
    const commands: Record<string, CommanderCommand> = { f: 'connections', r: 'refresh', u: 'swap', a: 'all', t: 'terminal' };
    return commands[key.toLowerCase()];
  }
  if (ctrlKey || metaKey) return;
  if (altKey) {
    if (shiftKey) return;
    const commands: Record<string, CommanderCommand> = { F5: 'pack', F9: 'extract', Enter: 'properties' };
    return commands[key];
  }
  if (shiftKey) {
    const commands: Record<string, CommanderCommand> = { F4: 'newFile', F6: 'rename', Tab: 'switchPanel' };
    return commands[key];
  }
  const numpad: Record<string, SelectionAction> = { NumpadMultiply: 'invert', NumpadAdd: 'all', NumpadSubtract: 'clear' };
  const commands: Record<string, CommanderCommand> = { Insert: 'insert', ArrowDown: 'down', ArrowUp: 'up', Backspace: 'parent',
    Enter: 'open', F3: 'view', F4: 'edit', F5: 'copy', F6: 'move', F7: 'mkdir', F8: 'delete', Tab: 'switchPanel' };
  return numpad[code] || commands[key];
}

export function selectionAction(panel: PanelState, action: SelectionAction): PanelState {
  const real = panel.files.map(file => file.id).filter(id => id !== PARENT_ITEM_ID);
  if (action === 'all') return { ...panel, selectedItems: real };
  if (action === 'clear') return { ...panel, selectedItems: [] };
  if (action === 'invert') return { ...panel, selectedItems: real.filter(id => !panel.selectedItems.includes(id)) };
  const ids = visibleItemIds(panel);
  const id = currentItemId(panel) || ids[0];
  const selected = panel.selectedItems.filter(item => real.includes(item));
  const selectedItems = real.includes(id) ? (selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id]) : selected;
  return { ...panel, selectedItems, focusedItemId: ids[Math.min(ids.length - 1, ids.indexOf(id) + 1)] };
}

export function sortFiles(files: FileItem[], sortBy: string, sortOrder: 'asc' | 'desc'): FileItem[] {
  return [...files].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    let comparison = 0;
    switch (sortBy) {
      case 'size': comparison = a.size - b.size; break;
      case 'date': comparison = new Date(a.modified).getTime() - new Date(b.modified).getTime(); break;
      case 'ext': comparison = (a.extension || '').localeCompare(b.extension || ''); break;
      default: comparison = a.name.localeCompare(b.name);
    }
    return sortOrder === 'asc' ? comparison : -comparison;
  });
}

export function visibleItemIds(panel: PanelState) {
  const ids = sortFiles(panel.files, panel.sortBy, panel.sortOrder).map(file => file.id);
  return isRootPath(panel.currentPath, panel.mode) ? ids : [PARENT_ITEM_ID, ...ids];
}

export function currentItemId(panel: PanelState) {
  const ids = visibleItemIds(panel);
  if (panel.focusedItemId && ids.includes(panel.focusedItemId)) return panel.focusedItemId;
  return panel.selectedItems.length === 1 && ids.includes(panel.selectedItems[0]) ? panel.selectedItems[0] : undefined;
}

export function currentItem(panel: PanelState): FileItem | undefined {
  const id = currentItemId(panel);
  return id === PARENT_ITEM_ID ? undefined : panel.files.find(file => file.id === id);
}

export function moveCursor(panel: PanelState, direction: 1 | -1): PanelState {
  const ids = visibleItemIds(panel);
  if (!ids.length) return { ...panel, focusedItemId: undefined, selectedItems: [] };
  const index = ids.indexOf(currentItemId(panel) || '');
  const next = index === -1 ? (direction === 1 ? 0 : ids.length - 1) :
    Math.max(0, Math.min(ids.length - 1, index + direction));
  const id = ids[next];
  return { ...panel, focusedItemId: id, selectedItems: id === PARENT_ITEM_ID ? [] : [id] };
}

export function selectItem(panel: PanelState, id: string, multi: boolean): PanelState {
  const selectedItems = id === PARENT_ITEM_ID ? [] : !multi ? [id] :
    panel.selectedItems.includes(id) ? panel.selectedItems.filter(item => item !== id) : [...panel.selectedItems, id];
  return { ...panel, focusedItemId: id, selectedItems };
}

export function itemAction(panel: PanelState, key: 'Enter' | 'F3' | 'F4') {
  const id = currentItemId(panel);
  if (id === PARENT_ITEM_ID) return key === 'Enter' ? { type: 'navigate' as const, path: id } : null;
  const item = currentItem(panel);
  if (!item) return null;
  if (item.type === 'folder') return key === 'Enter' ? { type: 'navigate' as const, path: item.id } : null;
  return { type: 'open' as const, path: item.id, readOnly: key === 'F3' };
}
