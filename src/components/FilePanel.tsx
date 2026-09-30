import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { FileItem } from '../types';
import { panelIdentity } from '../terminal/session';
import { sortFiles } from '../utils/navigation';
import { isRootPath } from '../utils/paths';

const Terminal = lazy(() => import('./Terminal'));

interface FilePanelProps {
  title: string;
  files: FileItem[];
  currentPath: string;
  selectedItems: string[];
  focusedItemId?: string;
  isActive: boolean;
  onSelect: (id: string, multi: boolean) => void;
  onNavigate: (folderId: string | null) => void;
  onPanelClick: () => void;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  onSort: (column: string) => void;
  onDoubleClick?: (fileId: string) => void;
  mode?: 'local' | 'ssh';
  sshHost?: string;
  sshUser?: string;
  sshSessionId?: string;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }) + ' ' + d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getFileIcon(item: FileItem): string {
  if (item.type === 'folder') return 'fa-folder';
  const ext = item.extension?.toLowerCase();
  switch (ext) {
    case 'pdf': return 'fa-file-pdf';
    case 'doc': case 'docx': return 'fa-file-word';
    case 'xls': case 'xlsx': return 'fa-file-excel';
    case 'ppt': case 'pptx': return 'fa-file-powerpoint';
    case 'jpg': case 'jpeg': case 'png': case 'gif': case 'svg': case 'bmp': return 'fa-file-image';
    case 'mp3': case 'wav': case 'flac': case 'm3u': return 'fa-file-audio';
    case 'mp4': case 'avi': case 'mkv': case 'mov': return 'fa-file-video';
    case 'zip': case 'rar': case '7z': case 'tar': case 'gz': return 'fa-file-zipper';
    case 'html': case 'css': case 'js': case 'ts': case 'tsx': case 'jsx': return 'fa-file-code';
    case 'json': case 'xml': case 'yml': case 'yaml': return 'fa-file-code';
    case 'py': case 'java': case 'cpp': case 'c': case 'rs': case 'go': return 'fa-file-code';
    case 'exe': case 'msi': return 'fa-file';
    case 'txt': case 'md': return 'fa-file-lines';
    case 'sql': return 'fa-database';
    default: return 'fa-file';
  }
}

function getIconColor(item: FileItem): string {
  if (item.type === 'folder') return 'text-yellow-400';
  const ext = item.extension?.toLowerCase();
  switch (ext) {
    case 'pdf': return 'text-red-500';
    case 'doc': case 'docx': return 'text-blue-600';
    case 'xls': case 'xlsx': return 'text-green-600';
    case 'ppt': case 'pptx': return 'text-orange-500';
    case 'jpg': case 'jpeg': case 'png': case 'gif': case 'svg': return 'text-purple-400';
    case 'mp3': case 'wav': case 'flac': return 'text-pink-400';
    case 'mp4': case 'avi': case 'mkv': return 'text-indigo-400';
    case 'zip': case 'rar': case '7z': return 'text-amber-500';
    case 'html': case 'css': case 'js': case 'ts': case 'tsx': return 'text-cyan-400';
    case 'py': case 'java': return 'text-emerald-400';
    default: return 'text-gray-400';
  }
}

const FilePanel: React.FC<FilePanelProps> = ({
  title,
  files,
  currentPath,
  selectedItems,
  focusedItemId,
  isActive,
  onSelect,
  onNavigate,
  onPanelClick,
  sortBy,
  sortOrder,
  onSort,
  onDoubleClick,
  mode = 'local',
  sshHost,
  sshUser,
  sshSessionId,
}) => {
  const identity = panelIdentity({ mode, sshSessionId, currentPath });
  const [terminalOwner, setTerminalOwner] = useState<string | null>(null);
  const terminalOpen = terminalOwner === identity;
  useEffect(() => { setTerminalOwner(null); }, [identity]);
  const sortedFiles = useMemo(() => sortFiles(files, sortBy, sortOrder), [files, sortBy, sortOrder]);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isActive || !focusedItemId) return;
    const row = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-file-row]') || [])
      .find(element => element.dataset.fileRow === focusedItemId);
    row?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focusedItemId, isActive, sortedFiles]);

  const SortIndicator: React.FC<{ column: string }> = ({ column }) => {
    if (sortBy !== column) return <span className="text-gray-600 ml-1">↕</span>;
    return <span className="text-cyan-400 ml-1">{sortOrder === 'asc' ? '↑' : '↓'}</span>;
  };

  const normalizePathForDisplay = (value: string): string[] => {
    const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
    if (!normalized || normalized === '/') return [];
    return normalized.split('/').filter(Boolean);
  };

  const pathSegments = normalizePathForDisplay(currentPath);

  return (
    <div
      ref={panelRef}
      tabIndex={0}
      aria-label={title}
      className={`flex flex-col h-full min-h-0 border ${
        isActive ? 'border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.1)]' : 'border-gray-700/50'
      } rounded-lg overflow-hidden bg-gray-900/80 backdrop-blur-sm`}
      onClick={onPanelClick}
    >
      {/* Panel Header */}
      <div className={`px-3 py-2 flex items-center gap-2 ${
        isActive ? (mode === 'ssh' ? 'bg-gradient-to-r from-green-900/40 to-emerald-900/40' : 'bg-gradient-to-r from-cyan-900/40 to-blue-900/40') : 'bg-gray-800/60'
      } border-b border-gray-700/50`}>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {mode === 'ssh' ? (
            <>
              <i className="fa-solid fa-terminal text-green-400 text-sm"></i>
              <span className="text-sm font-semibold text-gray-200 truncate">
                {sshUser}@{sshHost}
              </span>
            </>
          ) : (
            <>
              <i className="fa-solid fa-hard-drive text-cyan-400 text-sm"></i>
              <span className="text-sm font-semibold text-gray-200 truncate">{title}</span>
            </>
          )}
        </div>
        <button title={terminalOpen ? 'Close panel terminal' : 'Open panel terminal'} aria-label={`${title} terminal`}
          aria-expanded={terminalOpen} disabled={mode === 'ssh' && !sshSessionId}
          className="px-2 py-1 text-cyan-400 hover:bg-gray-700 rounded disabled:text-gray-600"
          onClick={event => { event.stopPropagation(); setTerminalOwner(terminalOpen ? null : identity); }}>&gt;_</button>
        <div className="text-xs text-gray-500 flex items-center gap-2">
          {mode === 'ssh' && (
            <span className="px-1.5 py-0.5 bg-green-900/30 border border-green-700/50 rounded text-green-400 text-[10px] font-medium">
              SSH
            </span>
          )}
          <span>{files.length} items</span>
        </div>
      </div>

      {/* Path Bar */}
      <div className="px-3 py-1.5 bg-gray-800/40 border-b border-gray-700/30 flex items-center gap-1 overflow-x-auto">
        <button
          onClick={() => onNavigate(null)}
          className="text-cyan-400 hover:text-cyan-300 text-xs font-mono flex-shrink-0"
          title="Root"
        >
          <i className="fa-solid fa-house text-[10px]"></i>
        </button>
        {pathSegments.map((segment, index) => (
          <React.Fragment key={index}>
            <span className="text-gray-600 text-xs">/</span>
            <span className="text-xs text-gray-300 font-mono truncate max-w-[100px]">
              {segment}
            </span>
          </React.Fragment>
        ))}
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-[1fr_80px_140px_60px] px-3 py-1.5 bg-gray-800/30 border-b border-gray-700/30 text-xs text-gray-400 font-medium select-none">
        <button
          className="text-left hover:text-cyan-300 transition-colors flex items-center"
          onClick={() => onSort('name')}
        >
          Name <SortIndicator column="name" />
        </button>
        <button
          className="text-right hover:text-cyan-300 transition-colors flex items-center justify-end"
          onClick={() => onSort('size')}
        >
          Size <SortIndicator column="size" />
        </button>
        <button
          className="text-left hover:text-cyan-300 transition-colors flex items-center"
          onClick={() => onSort('date')}
        >
          Date <SortIndicator column="date" />
        </button>
        <button
          className="text-left hover:text-cyan-300 transition-colors flex items-center"
          onClick={() => onSort('ext')}
        >
          Ext <SortIndicator column="ext" />
        </button>
      </div>

      {/* File List */}
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {/* Parent directory link */}
        {!isRootPath(currentPath, mode) && (
          <div
            data-file-row=".."
            aria-current={focusedItemId === '..' ? 'true' : undefined}
            className={`grid grid-cols-[1fr_80px_140px_60px] px-3 py-1.5 hover:bg-gray-700/30 cursor-pointer items-center border-b border-gray-800/30 ${focusedItemId === '..' ? 'bg-cyan-900/30 ring-1 ring-inset ring-cyan-400/70' : ''}`}
            onClick={() => { panelRef.current?.focus({ preventScroll: true }); onSelect('..', false); }}
            onDoubleClick={() => onNavigate('..')}
          >
            <div className="flex items-center gap-2">
              <i className="fa-solid fa-arrow-left text-gray-500 text-xs w-4 text-center"></i>
              <span className="text-sm text-gray-400">..</span>
            </div>
            <div></div>
            <div></div>
            <div></div>
          </div>
        )}

        {sortedFiles.map((item) => (
          <div
            key={item.id}
            data-file-row={item.id}
            aria-current={focusedItemId === item.id ? 'true' : undefined}
            className={`grid grid-cols-[1fr_80px_140px_60px] px-3 py-1.5 cursor-pointer items-center border-b border-gray-800/20 transition-all duration-100 ${
              selectedItems.includes(item.id)
                ? 'bg-cyan-900/30 border-l-2 border-l-cyan-400'
                : 'hover:bg-gray-700/20 border-l-2 border-l-transparent'
            } ${focusedItemId === item.id ? 'ring-1 ring-inset ring-cyan-400/70' : ''}`}
            onClick={(e) => { panelRef.current?.focus({ preventScroll: true }); onSelect(item.id, e.ctrlKey || e.metaKey); }}
            onDoubleClick={() => {
              if (item.type === 'folder') {
                onNavigate(item.id);
              } else if (onDoubleClick) {
                onDoubleClick(item.id);
              }
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <i className={`fa-solid ${getFileIcon(item)} ${getIconColor(item)} text-sm w-4 text-center flex-shrink-0`}></i>
              <span className={`text-sm truncate ${
                selectedItems.includes(item.id) ? 'text-cyan-100 font-medium' : 'text-gray-200'
              }`}>
                {item.name}
              </span>
            </div>
            <div className="text-xs text-gray-400 text-right font-mono">
              {formatSize(item.size)}
            </div>
            <div className="text-xs text-gray-500 font-mono">
              {formatDate(item.modified)}
            </div>
            <div className="text-xs text-gray-500 uppercase font-mono">
              {item.extension || ''}
            </div>
          </div>
        ))}

        {sortedFiles.length === 0 && (
          <div className="flex items-center justify-center h-32 text-gray-600 text-sm">
            <div className="text-center">
              <i className="fa-solid fa-folder-open text-2xl mb-2"></i>
              <p>Empty folder</p>
            </div>
          </div>
        )}
      </div>

      {terminalOpen && <Suspense fallback={<div className="h-[250px] shrink-0 p-3 text-xs text-gray-400" role="status">Loading terminal…</div>}><Terminal onClose={() => setTerminalOwner(null)} panel={{
        mode, currentPath, sshSessionId, sshUser, sshHost, files, selectedItems, sortBy, sortOrder,
      }} /></Suspense>}

      {/* Status Bar */}
      <div className="px-3 py-1.5 bg-gray-800/50 border-t border-gray-700/30 flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {selectedItems.length > 0
            ? `${selectedItems.length} selected`
            : `${files.filter(f => f.type === 'folder').length} folders, ${files.filter(f => f.type === 'file').length} files`}
        </span>
        <span className="text-xs text-gray-600 font-mono">
          {selectedItems.length > 0
            ? formatSize(files.filter(f => selectedItems.includes(f.id)).reduce((acc, f) => acc + f.size, 0))
            : formatSize(files.reduce((acc, f) => acc + f.size, 0))}
        </span>
      </div>
    </div>
  );
};

export default FilePanel;
