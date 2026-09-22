import React, { useState, useEffect, useCallback } from 'react';
import FilePanel from './components/FilePanel';
import Toolbar from './components/Toolbar';
import Modal from './components/Modal';
import StatusBar from './components/StatusBar';
import Login from './components/Login';
import FileEditor from './components/FileEditor';
import { api } from './api/client';
import { FileItem } from './types';

type PanelSide = 'left' | 'right';

interface PanelState {
  currentPath: string;
  selectedItems: string[];
  files: FileItem[];
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [activePanel, setActivePanel] = useState<PanelSide>('left');
  const [leftPanel, setLeftPanel] = useState<PanelState>({
    currentPath: '',
    selectedItems: [],
    files: [],
    sortBy: 'name',
    sortOrder: 'asc',
  });
  const [rightPanel, setRightPanel] = useState<PanelState>({
    currentPath: '',
    selectedItems: [],
    files: [],
    sortBy: 'name',
    sortOrder: 'asc',
  });

  const [modal, setModal] = useState<{
    isOpen: boolean;
    type: 'input' | 'confirm';
    title: string;
    placeholder?: string;
    message?: string;
    action?: (value: string) => void;
  }>({ isOpen: false, type: 'input', title: '' });

  const [editor, setEditor] = useState<{ isOpen: boolean; filePath: string }>({
    isOpen: false,
    filePath: '',
  });

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Check authentication on mount
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const result = await api.checkAuth();
      if (result.authenticated) {
        setAuthenticated(true);
        setUsername(result.username || '');
        loadInitialData();
      }
    } catch (err) {
      console.error('Auth check failed:', err);
    }
  };

  const handleLoginSuccess = (user: string) => {
    setAuthenticated(true);
    setUsername(user);
    loadInitialData();
  };

  const handleLogout = async () => {
    try {
      await api.logout();
      setAuthenticated(false);
      setUsername('');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const loadInitialData = async () => {
    try {
      // Load root directory for both panels
      const leftData = await api.listFiles('/');
      setLeftPanel(prev => ({
        ...prev,
        currentPath: '/',
        files: leftData.files,
      }));

      const rightData = await api.listFiles('/');
      setRightPanel(prev => ({
        ...prev,
        currentPath: '/',
        files: rightData.files,
      }));
    } catch (err) {
      showToast('Failed to load files', 'error');
    }
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

  const loadDirectory = async (path: string, panel: PanelSide) => {
    try {
      const data = await api.listFiles(path);
      if (panel === 'left') {
        setLeftPanel(prev => ({
          ...prev,
          currentPath: data.path,
          files: data.files,
          selectedItems: [],
        }));
      } else {
        setRightPanel(prev => ({
          ...prev,
          currentPath: data.path,
          files: data.files,
          selectedItems: [],
        }));
      }
    } catch (err) {
      showToast('Failed to load directory', 'error');
    }
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

  const handleNavigate = async (folderId: string | null) => {
    const panel = getActivePanelState();
    
    if (folderId === '..') {
      // Go up
      const parentPath = panel.currentPath.split('/').slice(0, -1).join('/') || '/';
      await loadDirectory(parentPath, activePanel);
    } else if (folderId === null) {
      // Go to root
      await loadDirectory('/', activePanel);
    } else {
      // Go into folder
      const folder = panel.files.find(f => f.id === folderId);
      if (folder) {
        await loadDirectory(folder.id, activePanel);
      }
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

  const handleCopy = async () => {
    const panel = getActivePanelState();
    const targetPanel = getInactivePanelState();
    
    if (panel.selectedItems.length === 0) return;

    try {
      for (const itemId of panel.selectedItems) {
        const item = panel.files.find(f => f.id === itemId);
        if (item) {
          const destPath = `${targetPanel.currentPath}/${item.name}`;
          await api.copy(item.id, destPath);
        }
      }
      await loadDirectory(targetPanel.currentPath, activePanel === 'left' ? 'right' : 'left');
      showToast(`Copied ${panel.selectedItems.length} item(s)`, 'success');
    } catch (err) {
      showToast('Copy failed', 'error');
    }
  };

  const handleMove = async () => {
    const panel = getActivePanelState();
    const targetPanel = getInactivePanelState();
    
    if (panel.selectedItems.length === 0) return;

    try {
      for (const itemId of panel.selectedItems) {
        const item = panel.files.find(f => f.id === itemId);
        if (item) {
          const destPath = `${targetPanel.currentPath}/${item.name}`;
          await api.move(item.id, destPath);
        }
      }
      await loadDirectory(panel.currentPath, activePanel);
      await loadDirectory(targetPanel.currentPath, activePanel === 'left' ? 'right' : 'left');
      showToast(`Moved ${panel.selectedItems.length} item(s)`, 'success');
    } catch (err) {
      showToast('Move failed', 'error');
    }
  };

  const handleDelete = () => {
    const panel = getActivePanelState();
    if (panel.selectedItems.length === 0) return;

    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Delete Files',
      message: `Are you sure you want to delete ${panel.selectedItems.length} item(s)? This action cannot be undone.`,
      action: async () => {
        try {
          for (const itemId of panel.selectedItems) {
            await api.delete(itemId);
          }
          await loadDirectory(panel.currentPath, activePanel);
          showToast(`Deleted ${panel.selectedItems.length} item(s)`, 'success');
          setModal({ isOpen: false, type: 'input', title: '' });
        } catch (err) {
          showToast('Delete failed', 'error');
        }
      },
    });
  };

  const handleMkdir = () => {
    setModal({
      isOpen: true,
      type: 'input',
      title: 'Create New Folder',
      placeholder: 'Folder name...',
      action: async (name: string) => {
        if (!name) return;
        try {
          const panel = getActivePanelState();
          await api.mkdir(panel.currentPath, name);
          await loadDirectory(panel.currentPath, activePanel);
          showToast(`Created folder "${name}"`, 'success');
          setModal({ isOpen: false, type: 'input', title: '' });
        } catch (err) {
          showToast('Failed to create folder', 'error');
        }
      },
    });
  };

  const handleRefresh = async () => {
    const panel = getActivePanelState();
    await loadDirectory(panel.currentPath, activePanel);
    showToast('Refreshed', 'info');
  };

  const handleFileDoubleClick = (fileId: string) => {
    const panel = getActivePanelState();
    const file = panel.files.find(f => f.id === fileId);
    
    if (file?.type === 'file') {
      // Open in editor
      setEditor({ isOpen: true, filePath: file.id });
    }
  };

  const handleDownload = async () => {
    const panel = getActivePanelState();
    if (panel.selectedItems.length === 0) return;

    try {
      for (const itemId of panel.selectedItems) {
        await api.download(itemId);
      }
      showToast('Download started', 'info');
    } catch (err) {
      showToast('Download failed', 'error');
    }
  };

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (modal.isOpen || editor.isOpen) return;
    
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
    }
  }, [activePanel, leftPanel, rightPanel, modal.isOpen, editor.isOpen]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!authenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
      {/* Toolbar */}
      <Toolbar
        onCopy={handleCopy}
        onMove={handleMove}
        onDelete={handleDelete}
        onMkdir={handleMkdir}
        onRefresh={handleRefresh}
        onSwap={handleSwap}
        hasSelection={getActivePanelState().selectedItems.length > 0}
      />

      {/* Main Content */}
      <div className="flex-1 flex gap-1 p-1 min-h-0">
        <div className="flex-1 min-w-0">
          <FilePanel
            title="Left Panel"
            files={leftPanel.files}
            currentPath={leftPanel.currentPath}
            selectedItems={leftPanel.selectedItems}
            isActive={activePanel === 'left'}
            onSelect={handleSelect}
            onNavigate={handleNavigate}
            onPanelClick={() => setActivePanel('left')}
            sortBy={leftPanel.sortBy}
            sortOrder={leftPanel.sortOrder}
            onSort={handleSort}
            onDoubleClick={handleFileDoubleClick}
          />
        </div>
        <div className="flex-1 min-w-0">
          <FilePanel
            title="Right Panel"
            files={rightPanel.files}
            currentPath={rightPanel.currentPath}
            selectedItems={rightPanel.selectedItems}
            isActive={activePanel === 'right'}
            onSelect={handleSelect}
            onNavigate={handleNavigate}
            onPanelClick={() => setActivePanel('right')}
            sortBy={rightPanel.sortBy}
            sortOrder={rightPanel.sortOrder}
            onSort={handleSort}
            onDoubleClick={handleFileDoubleClick}
          />
        </div>
      </div>

      {/* Status Bar */}
      <StatusBar
        leftPath={leftPanel.currentPath}
        rightPath={rightPanel.currentPath}
        totalFiles={leftPanel.files.filter(f => f.type === 'file').length + rightPanel.files.filter(f => f.type === 'file').length}
        totalFolders={leftPanel.files.filter(f => f.type === 'folder').length + rightPanel.files.filter(f => f.type === 'folder').length}
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

      {/* File Editor */}
      {editor.isOpen && (
        <FileEditor
          filePath={editor.filePath}
          onClose={() => setEditor({ isOpen: false, filePath: '' })}
          onSave={() => loadDirectory(getActivePanelState().currentPath, activePanel)}
        />
      )}

      {/* Toast */}
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
