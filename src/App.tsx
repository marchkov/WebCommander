import React, { useState, useEffect, useCallback } from 'react';
import FilePanel from './components/FilePanel';
import Toolbar from './components/Toolbar';
import Modal from './components/Modal';
import StatusBar from './components/StatusBar';
import { FileItem } from './types';
import { initialFileSystem } from './data/fileSystem';

type PanelSide = 'left' | 'right';

interface PanelState {
  currentPath: string[]; // array of folder names (path segments)
  currentFolderId: string | null;
  selectedItems: string[];
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

function App() {
  const [files, setFiles] = useState<FileItem[]>(initialFileSystem);
  const [activePanel, setActivePanel] = useState<PanelSide>('left');
  const [leftPanel, setLeftPanel] = useState<PanelState>({
    currentPath: [],
    currentFolderId: null,
    selectedItems: [],
    sortBy: 'name',
    sortOrder: 'asc',
  });
  const [rightPanel, setRightPanel] = useState<PanelState>({
    currentPath: [],
    currentFolderId: null,
    selectedItems: [],
    sortBy: 'name',
    sortOrder: 'asc',
  });

  // Modal state
  const [modal, setModal] = useState<{
    isOpen: boolean;
    type: 'input' | 'confirm';
    title: string;
    placeholder?: string;
    message?: string;
    action?: (value: string) => void;
  }>({ isOpen: false, type: 'input', title: '' });

  // Toast notifications
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const getActivePanelState = (): PanelState => {
    return activePanel === 'left' ? leftPanel : rightPanel;
  };

  const getInactivePanelState = (): PanelState => {
    return activePanel === 'left' ? rightPanel : leftPanel;
  };

  const setActivePanelState = (state: PanelState) => {
    if (activePanel === 'left') {
      setLeftPanel(state);
    } else {
      setRightPanel(state);
    }
  };

  const getFilesForPanel = (panelState: PanelState): FileItem[] => {
    return files.filter(f => f.parentId === panelState.currentFolderId);
  };

  const getFolderNameById = (id: string): string => {
    const folder = files.find(f => f.id === id);
    return folder?.name || '';
  };

  const handleSelect = (id: string, multi: boolean) => {
    const panel = getActivePanelState();
    let newSelected: string[];
    if (multi) {
      if (panel.selectedItems.includes(id)) {
        newSelected = panel.selectedItems.filter(s => s !== id);
      } else {
        newSelected = [...panel.selectedItems, id];
      }
    } else {
      newSelected = [id];
    }
    setActivePanelState({ ...panel, selectedItems: newSelected });
  };

  const handleNavigate = (folderId: string | null) => {
    const panel = getActivePanelState();
    
    if (folderId === '..') {
      // Go up
      if (panel.currentPath.length > 0) {
        const newPath = panel.currentPath.slice(0, -1);
        const parentFolder = files.find(f => f.id === panel.currentFolderId);
        const newFolderId = parentFolder?.parentId || null;
        setActivePanelState({
          ...panel,
          currentPath: newPath,
          currentFolderId: newFolderId,
          selectedItems: [],
        });
      }
    } else if (folderId === null) {
      // Go to root
      setActivePanelState({
        ...panel,
        currentPath: [],
        currentFolderId: null,
        selectedItems: [],
      });
    } else {
      // Go into folder
      const folderName = getFolderNameById(folderId);
      setActivePanelState({
        ...panel,
        currentPath: [...panel.currentPath, folderName],
        currentFolderId: folderId,
        selectedItems: [],
      });
    }
  };

  const handleSort = (column: string) => {
    const panel = getActivePanelState();
    const newOrder = panel.sortBy === column && panel.sortOrder === 'asc' ? 'desc' : 'asc';
    setActivePanelState({
      ...panel,
      sortBy: column,
      sortOrder: newOrder,
    });
  };

  const handleSwap = () => {
    const temp = leftPanel;
    setLeftPanel(rightPanel);
    setRightPanel(temp);
    setActivePanel(activePanel === 'left' ? 'right' : 'left');
  };

  const handleCopy = () => {
    const panel = getActivePanelState();
    const targetPanel = getInactivePanelState();
    
    if (panel.selectedItems.length === 0) return;

    const itemsToCopy = files.filter(f => panel.selectedItems.includes(f.id));
    const newFiles = itemsToCopy.map((item, index) => ({
      ...item,
      id: `copy_${Date.now()}_${index}`,
      name: `${item.name}`,
      parentId: targetPanel.currentFolderId,
    }));

    setFiles([...files, ...newFiles]);
    showToast(`Copied ${itemsToCopy.length} item(s)`, 'success');
  };

  const handleMove = () => {
    const panel = getActivePanelState();
    const targetPanel = getInactivePanelState();
    
    if (panel.selectedItems.length === 0) return;

    setFiles(files.map(f => {
      if (panel.selectedItems.includes(f.id)) {
        return { ...f, parentId: targetPanel.currentFolderId };
      }
      return f;
    }));
    setActivePanelState({ ...panel, selectedItems: [] });
    showToast(`Moved ${panel.selectedItems.length} item(s)`, 'success');
  };

  const handleDelete = () => {
    const panel = getActivePanelState();
    if (panel.selectedItems.length === 0) return;

    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Delete Files',
      message: `Are you sure you want to delete ${panel.selectedItems.length} item(s)? This action cannot be undone.`,
      action: () => {
        const idsToDelete = new Set(panel.selectedItems);
        // Also delete children recursively
        const getAllDescendants = (ids: Set<string>): Set<string> => {
          const result = new Set(ids);
          let changed = true;
          while (changed) {
            changed = false;
            files.forEach(f => {
              if (f.parentId && result.has(f.parentId) && !result.has(f.id)) {
                result.add(f.id);
                changed = true;
              }
            });
          }
          return result;
        };
        const allToDelete = getAllDescendants(idsToDelete);
        setFiles(files.filter(f => !allToDelete.has(f.id)));
        setActivePanelState({ ...panel, selectedItems: [] });
        showToast(`Deleted ${panel.selectedItems.length} item(s)`, 'success');
        setModal({ isOpen: false, type: 'input', title: '' });
      },
    });
  };

  const handleMkdir = () => {
    setModal({
      isOpen: true,
      type: 'input',
      title: 'Create New Folder',
      placeholder: 'Folder name...',
      action: (name: string) => {
        if (!name) return;
        const panel = getActivePanelState();
        const newFolder: FileItem = {
          id: `folder_${Date.now()}`,
          name,
          type: 'folder',
          size: 0,
          modified: new Date(),
          parentId: panel.currentFolderId,
        };
        setFiles([...files, newFolder]);
        showToast(`Created folder "${name}"`, 'success');
        setModal({ isOpen: false, type: 'input', title: '' });
      },
    });
  };

  const handleNewFile = () => {
    setModal({
      isOpen: true,
      type: 'input',
      title: 'Create New File',
      placeholder: 'filename.txt',
      action: (name: string) => {
        if (!name) return;
        const panel = getActivePanelState();
        const ext = name.includes('.') ? name.split('.').pop() : undefined;
        const newFile: FileItem = {
          id: `file_${Date.now()}`,
          name,
          type: 'file',
          size: 0,
          modified: new Date(),
          extension: ext,
          parentId: panel.currentFolderId,
        };
        setFiles([...files, newFile]);
        showToast(`Created file "${name}"`, 'success');
        setModal({ isOpen: false, type: 'input', title: '' });
      },
    });
  };

  const handleRefresh = () => {
    const panel = getActivePanelState();
    setActivePanelState({ ...panel, selectedItems: [] });
    showToast('Refreshed', 'info');
  };

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (modal.isOpen) return;
    
    const panel = getActivePanelState();
    
    switch (e.key) {
      case 'F5':
        e.preventDefault();
        handleCopy();
        break;
      case 'F6':
        e.preventDefault();
        handleMove();
        break;
      case 'F7':
        e.preventDefault();
        handleMkdir();
        break;
      case 'F8':
        e.preventDefault();
        handleDelete();
        break;
      case 'Tab':
        e.preventDefault();
        setActivePanel(prev => prev === 'left' ? 'right' : 'left');
        break;
      case 'r':
        if (e.ctrlKey) {
          e.preventDefault();
          handleRefresh();
        }
        break;
    }
  }, [activePanel, files, leftPanel, rightPanel, modal.isOpen]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const getPathString = (panelState: PanelState): string => {
    if (panelState.currentPath.length === 0) return '/';
    return '/' + panelState.currentPath.join('/');
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
      {/* Toolbar */}
      <Toolbar
        onCopy={handleCopy}
        onMove={handleMove}
        onDelete={handleDelete}
        onMkdir={handleMkdir}
        onNewFile={handleNewFile}
        onRefresh={handleRefresh}
        onSwap={handleSwap}
        hasSelection={getActivePanelState().selectedItems.length > 0}
      />

      {/* Main Content - Two Panels */}
      <div className="flex-1 flex gap-1 p-1 min-h-0">
        <div className="flex-1 min-w-0">
          <FilePanel
            title="Left Panel"
            files={getFilesForPanel(leftPanel)}
            currentPath={leftPanel.currentPath}
            selectedItems={leftPanel.selectedItems}
            isActive={activePanel === 'left'}
            onSelect={handleSelect}
            onNavigate={handleNavigate}
            onPanelClick={() => setActivePanel('left')}
            sortBy={leftPanel.sortBy}
            sortOrder={leftPanel.sortOrder}
            onSort={handleSort}
          />
        </div>
        <div className="flex-1 min-w-0">
          <FilePanel
            title="Right Panel"
            files={getFilesForPanel(rightPanel)}
            currentPath={rightPanel.currentPath}
            selectedItems={rightPanel.selectedItems}
            isActive={activePanel === 'right'}
            onSelect={handleSelect}
            onNavigate={handleNavigate}
            onPanelClick={() => setActivePanel('right')}
            sortBy={rightPanel.sortBy}
            sortOrder={rightPanel.sortOrder}
            onSort={handleSort}
          />
        </div>
      </div>

      {/* Status Bar */}
      <StatusBar
        leftPath={getPathString(leftPanel)}
        rightPath={getPathString(rightPanel)}
        totalFiles={files.filter(f => f.type === 'file').length}
        totalFolders={files.filter(f => f.type === 'folder').length}
      />

      {/* Modal */}
      <Modal
        isOpen={modal.isOpen}
        title={modal.title}
        type={modal.type}
        placeholder={modal.placeholder}
        message={modal.message}
        onClose={() => setModal({ isOpen: false, type: 'input', title: '' })}
        onConfirm={(value) => modal.action?.(value)}
      />

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-12 right-4 px-4 py-2.5 rounded-lg shadow-lg border backdrop-blur-sm z-50 animate-slide-in ${
          toast.type === 'success' ? 'bg-green-900/80 border-green-700/50 text-green-200' :
          toast.type === 'error' ? 'bg-red-900/80 border-red-700/50 text-red-200' :
          'bg-gray-800/80 border-gray-700/50 text-gray-200'
        }`}>
          <div className="flex items-center gap-2">
            <i className={`fa-solid ${
              toast.type === 'success' ? 'fa-check-circle text-green-400' :
              toast.type === 'error' ? 'fa-exclamation-circle text-red-400' :
              'fa-info-circle text-cyan-400'
            }`}></i>
            <span className="text-sm">{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
