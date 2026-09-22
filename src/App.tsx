import React, { useState, useEffect, useCallback } from 'react';
import FilePanel from './components/FilePanel';
import Toolbar from './components/Toolbar';
import Modal from './components/Modal';
import StatusBar from './components/StatusBar';
import Login from './components/Login';
import FileEditor from './components/FileEditor';
import SSHConnectModal from './components/SSHConnectModal';
import { api } from './api/client';
import { FileItem, PanelState } from './types';

type PanelSide = 'left' | 'right';

function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [activePanel, setActivePanel] = useState<PanelSide>('left');
  const [leftPanel, setLeftPanel] = useState<PanelState>({
    currentPath: '/',
    selectedItems: [],
    files: [],
    sortBy: 'name',
    sortOrder: 'asc',
    mode: 'local',
  });
  const [rightPanel, setRightPanel] = useState<PanelState>({
    currentPath: '/',
    selectedItems: [],
    files: [],
    sortBy: 'name',
    sortOrder: 'asc',
    mode: 'local',
  });

  const [modal, setModal] = useState<{
    isOpen: boolean;
    type: 'input' | 'confirm';
    title: string;
    placeholder?: string;
    message?: string;
    action?: (value: string) => void;
  }>({ isOpen: false, type: 'input', title: '' });

  const [editor, setEditor] = useState<{ isOpen: boolean; filePath: string; sessionId?: string }>({
    isOpen: false,
    filePath: '',
  });

  const [sshModal, setSSHModal] = useState<{ isOpen: boolean; targetPanel: PanelSide }>({
    isOpen: false,
    targetPanel: 'left',
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
      const leftData = await api.listFiles('/');
      setLeftPanel(prev => ({
        ...prev,
        currentPath: leftData.path,
        files: leftData.files,
      }));

      const rightData = await api.listFiles('/');
      setRightPanel(prev => ({
        ...prev,
        currentPath: rightData.path,
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

  const setPanelState = (panel: PanelSide, state: PanelState) => {
    if (panel === 'left') {
      setLeftPanel(state);
    } else {
      setRightPanel(state);
    }
  };

  const loadDirectory = async (path: string, panel: PanelSide) => {
    const panelState = panel === 'left' ? leftPanel : rightPanel;
    
    try {
      if (panelState.mode === 'ssh' && panelState.sshSessionId) {
        // SSH mode
        const data = await api.sshListFiles(panelState.sshSessionId, path);
        setPanelState(panel, {
          ...panelState,
          currentPath: data.path,
          files: data.files,
          selectedItems: [],
        });
      } else {
        // Local mode
        const data = await api.listFiles(path);
        setPanelState(panel, {
          ...panelState,
          currentPath: data.path,
          files: data.files,
          selectedItems: [],
        });
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
      const parentPath = panel.currentPath.split('/').slice(0, -1).join('/') || '/';
      await loadDirectory(parentPath, activePanel);
    } else if (folderId === null) {
      await loadDirectory(panel.mode === 'ssh' ? '~' : '/', activePanel);
    } else {
      await loadDirectory(folderId, activePanel);
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

  const handleToggleSSH = (panel: PanelSide) => {
    const panelState = panel === 'left' ? leftPanel : rightPanel;
    
    if (panelState.mode === 'ssh') {
      // Disconnect from SSH
      if (panelState.sshSessionId) {
        api.sshDisconnect(panelState.sshSessionId).catch(console.error);
      }
      // Switch back to local
      setPanelState(panel, {
        ...panelState,
        mode: 'local',
        sshSessionId: undefined,
        sshHost: undefined,
        sshUser: undefined,
        currentPath: '/',
        selectedItems: [],
      });
      loadDirectory('/', panel);
      showToast('Switched to local mode', 'info');
    } else {
      // Open SSH connect modal
      setSSHModal({ isOpen: true, targetPanel: panel });
    }
  };

  const handleSSHConnect = async (sessionId: string, host: string, sshUser: string) => {
    const panel = sshModal.targetPanel;
    
    setPanelState(panel, {
      ...(panel === 'left' ? leftPanel : rightPanel),
      mode: 'ssh',
      sshSessionId: sessionId,
      sshHost: host,
      sshUser: sshUser,
      currentPath: '~',
      selectedItems: [],
    });
    
    await loadDirectory('~', panel);
    setSSHModal({ isOpen: false, targetPanel: 'left' });
    showToast(`Connected to ${host}`, 'success');
  };

  const handleCopy = async () => {
    const panel = getActivePanelState();
    const targetPanel = getInactivePanelState();
    
    if (panel.selectedItems.length === 0) return;

    try {
      if (panel.mode === 'local' && targetPanel.mode === 'local') {
        // Local to Local
        for (const itemId of panel.selectedItems) {
          const item = panel.files.find(f => f.id === itemId);
          if (item) {
            const destPath = `${targetPanel.currentPath}/${item.name}`;
            await api.copy(item.id, destPath);
          }
        }
      } else if (panel.mode === 'ssh' && targetPanel.mode === 'local') {
        // SSH to Local - download files
        for (const itemId of panel.selectedItems) {
          const item = panel.files.find(f => f.id === itemId);
          if (item && panel.sshSessionId) {
            await api.sshDownload(panel.sshSessionId, item.id);
          }
        }
      } else if (panel.mode === 'local' && targetPanel.mode === 'ssh') {
        // Local to SSH - upload files
        showToast('Upload to SSH not yet implemented', 'info');
        return;
      } else {
        // SSH to SSH
        showToast('SSH to SSH transfer not yet implemented', 'info');
        return;
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
      if (panel.mode === 'local' && targetPanel.mode === 'local') {
        for (const itemId of panel.selectedItems) {
          const item = panel.files.find(f => f.id === itemId);
          if (item) {
            const destPath = `${targetPanel.currentPath}/${item.name}`;
            await api.move(item.id, destPath);
          }
        }
      } else {
        showToast('Cross-mode move not supported. Use copy + delete.', 'info');
        return;
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
          if (panel.mode === 'ssh' && panel.sshSessionId) {
            for (const itemId of panel.selectedItems) {
              const item = panel.files.find(f => f.id === itemId);
              if (item) {
                await api.sshDelete(panel.sshSessionId, item.id, item.type === 'folder');
              }
            }
          } else {
            for (const itemId of panel.selectedItems) {
              await api.delete(itemId);
            }
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
          
          if (panel.mode === 'ssh' && panel.sshSessionId) {
            const newPath = `${panel.currentPath}/${name}`;
            await api.sshMkdir(panel.sshSessionId, newPath);
          } else {
            await api.mkdir(panel.currentPath, name);
          }
          
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
      if (panel.mode === 'ssh' && panel.sshSessionId) {
        setEditor({ isOpen: true, filePath: file.id, sessionId: panel.sshSessionId });
      } else {
        setEditor({ isOpen: true, filePath: file.id });
      }
    }
  };

  const handleDownload = async () => {
    const panel = getActivePanelState();
    if (panel.selectedItems.length === 0) return;

    try {
      if (panel.mode === 'ssh' && panel.sshSessionId) {
        for (const itemId of panel.selectedItems) {
          await api.sshDownload(panel.sshSessionId, itemId);
        }
      } else {
        for (const itemId of panel.selectedItems) {
          await api.download(itemId);
        }
      }
      showToast('Download started', 'info');
    } catch (err) {
      showToast('Download failed', 'error');
    }
  };

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (modal.isOpen || editor.isOpen || sshModal.isOpen) return;
    
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
  }, [activePanel, leftPanel, rightPanel, modal.isOpen, editor.isOpen, sshModal.isOpen]);

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
        onToggleSSHLeft={() => handleToggleSSH('left')}
        onToggleSSHRight={() => handleToggleSSH('right')}
        leftMode={leftPanel.mode}
        rightMode={rightPanel.mode}
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
            mode={leftPanel.mode}
            sshHost={leftPanel.sshHost}
            sshUser={leftPanel.sshUser}
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
            mode={rightPanel.mode}
            sshHost={rightPanel.sshHost}
            sshUser={rightPanel.sshUser}
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

      {/* SSH Connect Modal */}
      <SSHConnectModal
        isOpen={sshModal.isOpen}
        onClose={() => setSSHModal({ isOpen: false, targetPanel: 'left' })}
        onConnect={handleSSHConnect}
      />

      {/* File Editor */}
      {editor.isOpen && (
        <FileEditor
          filePath={editor.filePath}
          sessionId={editor.sessionId}
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
