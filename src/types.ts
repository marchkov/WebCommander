export interface FileItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  size: number;
  modified: Date;
  extension?: string;
  parentId: string | null;
}

export interface PanelState {
  currentPath: string[];
  selectedItems: string[];
  files: FileItem[];
}

export interface FileSystem {
  [path: string]: FileItem[];
}
