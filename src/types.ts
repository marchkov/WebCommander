export interface FileItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  size: number;
  modified: Date | string;
  extension?: string;
  parentId: string | null;
  permissions?: string;
  uid?: number;
  gid?: number;
}

export interface PanelState {
  focusedItemId?: string;
  currentPath: string;
  selectedItems: string[];
  files: FileItem[];
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  mode: 'local' | 'ssh';
  sshSessionId?: string;
  sshHost?: string;
  sshUser?: string;
}
