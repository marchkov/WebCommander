import React from 'react';
import { api } from '../api/client';

interface ToolbarProps {
  onCopy: () => void;
  onMove: () => void;
  onDelete: () => void;
  onMkdir: () => void;
  onRefresh: () => void;
  onSwap: () => void;
  onToggleSSHLeft: () => void;
  onToggleSSHRight: () => void;
  leftMode: 'local' | 'ssh';
  rightMode: 'local' | 'ssh';
  hasSelection: boolean;
}

const Toolbar: React.FC<ToolbarProps> = ({
  onCopy,
  onMove,
  onDelete,
  onMkdir,
  onRefresh,
  onSwap,
  onToggleSSHLeft,
  onToggleSSHRight,
  leftMode,
  rightMode,
  hasSelection,
}) => {
  const buttons = [
    { icon: 'fa-copy', label: 'Copy (F5)', action: onCopy, disabled: !hasSelection, color: 'hover:text-cyan-400' },
    { icon: 'fa-arrows-left-right', label: 'Move (F6)', action: onMove, disabled: !hasSelection, color: 'hover:text-blue-400' },
    { icon: 'fa-trash', label: 'Delete (F8)', action: onDelete, disabled: !hasSelection, color: 'hover:text-red-400' },
    { icon: 'fa-folder-plus', label: 'New Folder (F7)', action: onMkdir, disabled: false, color: 'hover:text-yellow-400' },
    { icon: 'fa-arrows-rotate', label: 'Refresh (Ctrl+R)', action: onRefresh, disabled: false, color: 'hover:text-emerald-400' },
    { icon: 'fa-right-left', label: 'Swap Panels', action: onSwap, disabled: false, color: 'hover:text-purple-400' },
  ];

  return (
    <div className="flex items-center gap-1 px-4 py-2 bg-gray-900/90 border-b border-gray-700/50 backdrop-blur-sm">
      <div className="flex items-center gap-1 mr-4">
        <div className="w-7 h-7 rounded bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
          <i className="fa-solid fa-layer-group text-white text-xs"></i>
        </div>
        <span className="text-sm font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
          WebCommander
        </span>
      </div>
      
      <div className="h-5 w-px bg-gray-700/50 mx-2"></div>

      {buttons.map((btn, index) => (
        <button
          key={index}
          onClick={btn.action}
          disabled={btn.disabled}
          title={btn.label}
          className={`px-3 py-1.5 rounded text-sm transition-all duration-150 ${
            btn.disabled
              ? 'text-gray-600 cursor-not-allowed'
              : `text-gray-300 ${btn.color} hover:bg-gray-700/50 active:scale-95`
          }`}
        >
          <i className={`fa-solid ${btn.icon} mr-1.5`}></i>
          <span className="hidden md:inline text-xs">{btn.label.split(' ')[0]}</span>
        </button>
      ))}

      <div className="h-5 w-px bg-gray-700/50 mx-2"></div>

      {/* SSH Toggle Buttons */}
      <button
        onClick={onToggleSSHLeft}
        title="Toggle SSH for Left Panel"
        className={`px-3 py-1.5 rounded text-sm transition-all duration-150 ${
          leftMode === 'ssh'
            ? 'bg-green-900/40 text-green-400 border border-green-700/50'
            : 'text-gray-400 hover:text-green-400 hover:bg-gray-700/50'
        }`}
      >
        <i className="fa-solid fa-terminal mr-1.5"></i>
        <span className="hidden lg:inline text-xs">L: {leftMode === 'ssh' ? 'SSH' : 'Local'}</span>
      </button>

      <button
        onClick={onToggleSSHRight}
        title="Toggle SSH for Right Panel"
        className={`px-3 py-1.5 rounded text-sm transition-all duration-150 ${
          rightMode === 'ssh'
            ? 'bg-green-900/40 text-green-400 border border-green-700/50'
            : 'text-gray-400 hover:text-green-400 hover:bg-gray-700/50'
        }`}
      >
        <i className="fa-solid fa-terminal mr-1.5"></i>
        <span className="hidden lg:inline text-xs">R: {rightMode === 'ssh' ? 'SSH' : 'Local'}</span>
      </button>

      <div className="ml-auto flex items-center gap-3">
        {api.isDemoMode() && (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-yellow-900/30 border border-yellow-700/50 rounded text-xs text-yellow-300">
            <i className="fa-solid fa-flask"></i>
            <span className="hidden md:inline">Demo Mode</span>
          </div>
        )}
        <div className="hidden lg:flex items-center gap-2 text-xs text-gray-500">
          <span className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 font-mono">F5</span>
          <span>Copy</span>
          <span className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 font-mono">F6</span>
          <span>Move</span>
          <span className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 font-mono">F7</span>
          <span>Mkdir</span>
          <span className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 font-mono">F8</span>
          <span>Delete</span>
        </div>
      </div>
    </div>
  );
};

export default Toolbar;
