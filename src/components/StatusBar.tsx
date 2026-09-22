import React from 'react';

interface StatusBarProps {
  leftPath: string;
  rightPath: string;
  totalFiles: number;
  totalFolders: number;
}

const StatusBar: React.FC<StatusBarProps> = ({ leftPath, rightPath, totalFiles, totalFolders }) => {
  return (
    <div className="flex items-center justify-between px-4 py-1.5 bg-gray-900/95 border-t border-gray-700/50 text-xs">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          <span className="text-gray-400">Ready</span>
        </div>
        <span className="text-gray-600">|</span>
        <span className="text-gray-500 font-mono truncate max-w-[300px]">L: {leftPath}</span>
        <span className="text-gray-600">|</span>
        <span className="text-gray-500 font-mono truncate max-w-[300px]">R: {rightPath}</span>
      </div>
      <div className="flex items-center gap-4 text-gray-500">
        <span>{totalFolders} folders</span>
        <span>{totalFiles} files</span>
        <span className="text-gray-600">DockCommander v1.0</span>
      </div>
    </div>
  );
};

export default StatusBar;
