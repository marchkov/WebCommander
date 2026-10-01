import React, { useState, useEffect, useCallback, useRef } from 'react';
import FilePanel, { FilePanelHandle } from './components/FilePanel';
import PropertiesModal from './components/PropertiesModal';
import { createTextFile, renameCurrentItem, currentItemProperties } from './utils/fileCommands';
import Toolbar from './components/Toolbar';
import Modal from './components/Modal';
import StatusBar from './components/StatusBar';
import Login from './components/Login';
import FileEditor from './components/FileEditor';
import ConnectionsModal from './components/ConnectionsModal';
import { attachSession, localPanel, PANEL_STORAGE_KEY, readBindings, restorePanel, serializePanels, SSHSession } from './utils/connections';
import SSHConnectModal from './components/SSHConnectModal';
import { ApiError, api, ProviderDescriptor, FileInfo } from './api/client';
import { FileItem, PanelState } from './types';
import { getParentPath, isRootPath, joinPath } from './utils/paths';
import { connectionShortcut, selectionAction, itemAction, moveCursor, selectItem, currentItem } from './utils/navigation';

type PanelSide = 'left' | 'right';

function App() {
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [restored, setRestored] = useState(false);
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
    defaultValue?: string;
    message?: string;
    action?: (value: string) => void;
  }>({ isOpen: false, type: 'input', title: '' });

  const [editor, setEditor] = useState<{ isOpen: boolean; filePath: string; sessionId?: string; readOnly?: boolean }>({
    isOpen: false,
    filePath: '',
  });

  const [sshModal, setSSHModal] = useState<{ isOpen: boolean; targetPanel: PanelSide }>({
    isOpen: false,
    targetPanel: 'left',
  });

  const leftPanelRef = useRef<FilePanelHandle>(null);
  const rightPanelRef = useRef<FilePanelHandle>(null);
  const [properties, setProperties] = useState<FileInfo | null>(null);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Check authentication on mount
  useEffect(() => {
    checkAuth();
  }, []);

  // Check if in demo mode
  const isDemoMode = api.isDemoMode();

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
    let bindings = {} as Record<string, any>;
    try { bindings = readBindings(sessionStorage.getItem(PANEL_STORAGE_KEY)); } catch { /* Storage may be disabled. */ }
    let sessions: SSHSession[] = [];
    try { sessions = await api.sshSessions(); } catch { showToast('Could not recover SSH connections', 'error'); }
    const read = (panel: PanelState, path: string) => panel.mode === 'ssh' && panel.sshSessionId
      ? api.sshListFiles(panel.sshSessionId, path) : api.listFiles(path);
    const [left, right] = await Promise.all([
      restorePanel(leftPanel, bindings.left, sessions, read),
      restorePanel(rightPanel, bindings.right, sessions, read),
    ]);
    setLeftPanel(left); setRightPanel(right); setRestored(true);
  };

  useEffect(() => {
    if (!authenticated || !restored) return;
    try { sessionStorage.setItem(PANEL_STORAGE_KEY, serializePanels(leftPanel, rightPanel)); } catch { /* Storage may be disabled. */ }
  }, [authenticated, restored, leftPanel.mode, leftPanel.sshSessionId, leftPanel.currentPath,
    rightPanel.mode, rightPanel.sshSessionId, rightPanel.currentPath]);

  useEffect(() => {
    if (!authenticated) return;
    const recover = async () => {
      showToast('SSH connection lost', 'error');
      try {
        const sessions = await api.sshSessions();
        for (const [side, panel] of [['left', leftPanel], ['right', rightPanel]] as const) {
          if (panel.mode === 'ssh' && !sessions.some(session => session.sessionId === panel.sshSessionId)) {
            const next = localPanel(panel);
            setPanelState(side, next);
            await loadDirectory('/', side, next);
          }
        }
      } catch { /* A backend outage is not an instruction to reconnect. */ }
    };
    window.addEventListener('ssh-connection-lost', recover);
    return () => window.removeEventListener('ssh-connection-lost', recover);
  }, [authenticated, leftPanel, rightPanel]);

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

  const loadDirectory = async (path: string, panel: PanelSide, stateOverride?: PanelState) => {
    const panelState = stateOverride || (panel === 'left' ? leftPanel : rightPanel);
    
    try {
      if (panelState.mode === 'ssh' && panelState.sshSessionId) {
        // SSH mode
        const data = await api.sshListFiles(panelState.sshSessionId, path);
        setPanelState(panel, {
          ...panelState,
          currentPath: data.path,
          files: data.files,
          selectedItems: [],
          focusedItemId: undefined,
        });
      } else {
        // Local mode
        const data = await api.listFiles(path);
        setPanelState(panel, {
          ...panelState,
          currentPath: data.path,
          files: data.files,
          selectedItems: [],
          focusedItemId: undefined,
        });
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load directory', 'error');
    }
  };

  const handleSelect = (id: string, multi: boolean, side: PanelSide = activePanel) => {
    setActivePanel(side);
    const update = side === 'left' ? setLeftPanel : setRightPanel;
    update(panel => selectItem(panel, id, multi));
  };

  const handleNavigate = async (folderId: string | null, side: PanelSide = activePanel) => {
    const panel = side === 'left' ? leftPanel : rightPanel;
    setActivePanel(side);
    
    if (folderId === '..') {
      if (isRootPath(panel.currentPath, panel.mode)) return;
      const parentPath = getParentPath(panel.currentPath, panel.mode);
      await loadDirectory(parentPath, side);
    } else if (folderId === null) {
      await loadDirectory(panel.mode === 'ssh' ? '~' : '/', side);
    } else {
      await loadDirectory(folderId, side);
    }
  };

  const handleSort = (column: string, side: PanelSide = activePanel) => {
    const panel = side === 'left' ? leftPanel : rightPanel;
    setActivePanel(side);
    const newOrder = panel.sortBy === column && panel.sortOrder === 'asc' ? 'desc' : 'asc';
    setPanelState(side, {
      ...panel,
      sortBy: column,
      sortOrder: newOrder,
    });
  };

  const handleSwap = () => {
    setLeftPanel(rightPanel);
    setRightPanel(leftPanel);
    setActivePanel(prev => (prev === 'left' ? 'right' : 'left'));
  };

  const refreshBothPanels = async () => {
    await Promise.all([
      loadDirectory(leftPanel.currentPath, 'left'),
      loadDirectory(rightPanel.currentPath, 'right'),
    ]);
  };

  const handleToggleSSH = async (side: PanelSide) => {
    const panel = side === 'left' ? leftPanel : rightPanel;
    if (panel.mode === 'ssh') {
      const next = localPanel(panel);
      setPanelState(side, next);
      await loadDirectory('/', side, next);
      showToast('Switched to local mode', 'info');
    } else setSSHModal({ isOpen: true, targetPanel: side });
  };

  const useConnection = async (session: SSHSession) => {
    const next = attachSession(getActivePanelState(), session);
    setPanelState(activePanel, next);
    await loadDirectory('~', activePanel, next);
    setConnectionsOpen(false);
  };

  const disconnectConnection = async (session: SSHSession) => {
    await api.sshDisconnect(session.sessionId);
    await Promise.all((['left', 'right'] as const).map(async side => {
      const panel = side === 'left' ? leftPanel : rightPanel;
      if (panel.sshSessionId === session.sessionId) {
        const next = localPanel(panel);
        setPanelState(side, next);
        await loadDirectory('/', side, next);
      }
    }));
  };

  const handleSSHConnect = async (sessionId: string, host: string, sshUser: string) => {
    const panel = sshModal.targetPanel;
    const panelState = panel === 'left' ? leftPanel : rightPanel;

    if (!sessionId || !host || !sshUser) {
      showToast('SSH connection data is incomplete', 'error');
      return;
    }

    const nextPanelState: PanelState = {
      ...panelState,
      mode: 'ssh',
      sshSessionId: sessionId,
      sshHost: host,
      sshUser: sshUser,
      currentPath: '~',
      selectedItems: [],
    };
    setPanelState(panel, nextPanelState);

    try {
      await loadDirectory('~', panel, nextPanelState);
      setSSHModal({ isOpen: false, targetPanel: 'left' });
      showToast(`Connected to ${host}`, 'success');
    } catch (err) {
      showToast('Failed to load SSH directory', 'error');
    }
  };

  const getProviderDescriptor = (panel: PanelState, itemPath: string): ProviderDescriptor => {
    if (panel.mode === 'ssh') {
      if (!panel.sshSessionId) {
        throw new Error('SSH session is not active');
      }

      return {
        provider: 'sftp',
        sessionId: panel.sshSessionId,
        path: itemPath,
      };
    }

    return { provider: 'local', path: itemPath };
  };

  const transferSelectedItems = async (operation: 'copy' | 'move') => {
    const panel = getActivePanelState();
    const targetPanel = getInactivePanelState();
    const sourceSide = activePanel;
    const destinationSide: PanelSide = activePanel === 'left' ? 'right' : 'left';
    let completedItems = 0;

    try {
      for (const itemId of panel.selectedItems) {
        const item = panel.files.find(file => file.id === itemId);
        if (!item) continue;

        const request = {
          operation,
          source: getProviderDescriptor(panel, item.id),
          destination: getProviderDescriptor(targetPanel, joinPath(targetPanel.currentPath, item.name, targetPanel.mode)),
        } as const;

        try {
          await api.transfer(request);
        } catch (error) {
          if (error instanceof ApiError && error.status === 409 && error.conflictType === 'destination_exists') {
            const overwrite = window.confirm('Overwrite the destination?');
            if (!overwrite) {
              throw new Error('Transfer cancelled');
            }

            await api.transfer({ ...request, overwrite: true });
          } else {
            throw error;
          }
        }

        completedItems += 1;
      }
    } finally {
      await Promise.all([
        loadDirectory(panel.currentPath, sourceSide, panel),
        loadDirectory(targetPanel.currentPath, destinationSide, targetPanel),
      ]);
    }

    return completedItems;
  };

  const handleCopy = async () => {
    try {
      const panel = getActivePanelState();
      if (panel.selectedItems.length === 0) return;
      const completedItems = await transferSelectedItems('copy');
      showToast(`Copied ${completedItems} item(s)`, 'success');
    } catch (err) {
      console.error('Copy failed:', err);
      showToast(err instanceof Error ? err.message : 'Copy failed', 'error');
    }
  };

  const handleMove = async () => {
    try {
      const panel = getActivePanelState();
      if (panel.selectedItems.length === 0) return;
      const completedItems = await transferSelectedItems('move');
      showToast(`Moved ${completedItems} item(s)`, 'success');
    } catch (err) {
      console.error('Move failed:', err);
      showToast(err instanceof Error ? err.message : 'Move failed', 'error');
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
          console.error('Delete failed:', err);
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
            const newPath = joinPath(panel.currentPath, name, panel.mode);
            await api.sshMkdir(panel.sshSessionId, newPath);
          } else {
            await api.mkdir(panel.currentPath, name);
          }
          
          await loadDirectory(panel.currentPath, activePanel);
          showToast(`Created folder "${name}"`, 'success');
          setModal({ isOpen: false, type: 'input', title: '' });
        } catch (err) {
          console.error('Create folder failed:', err);
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

  const handleFileOpen = (fileId: string, readOnly = false, side: PanelSide = activePanel) => {
    const panel = side === 'left' ? leftPanel : rightPanel;
    const file = panel.files.find(f => f.id === fileId);
    
    if (file?.type === 'file') {
      if (panel.mode === 'ssh' && panel.sshSessionId) {
        setEditor({ isOpen: true, filePath: file.id, sessionId: panel.sshSessionId, readOnly });
      } else {
        if (panel.mode === 'ssh') return;
        setEditor({ isOpen: true, filePath: file.id, readOnly });
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

  const handlePack = () => {
    const panel = getActivePanelState();
    const selectedFiles = panel.selectedItems
      .map(itemId => panel.files.find(file => file.id === itemId))
      .filter((file): file is FileItem => Boolean(file));
    if (selectedFiles.length === 0) return;

    const defaultName = selectedFiles.length === 1 && selectedFiles[0]?.type === 'folder'
      ? `${selectedFiles[0].name}.zip`
      : 'archive.zip';

    setModal({
      isOpen: true,
      type: 'input',
      title: 'Pack to ZIP',
      placeholder: defaultName,
      defaultValue: defaultName,
      action: async (archiveName: string) => {
        if (!archiveName.trim() || /[\\/:\x00]/.test(archiveName) || /[. ]$/.test(archiveName)) {
          showToast('Enter a file name without directory separators', 'error');
          return;
        }
        const normalizedName = archiveName.toLowerCase().endsWith('.zip')
          ? archiveName
          : `${archiveName}.zip`;
        const provider = panel.mode === 'ssh' ? 'sftp' : 'local';
        const sources = selectedFiles.map(file => file.id);

        try {
          await api.createArchive(
            provider,
            sources,
            joinPath(panel.currentPath, normalizedName, panel.mode),
            panel.sshSessionId,
          );
          await loadDirectory(panel.currentPath, activePanel, panel);
          showToast('Archive created', 'success');
          setModal({ isOpen: false, type: 'input', title: '' });
        } catch (error) {
          console.error('Archive creation failed:', error);
          showToast(error instanceof Error ? error.message : 'Failed to create archive', 'error');
        }
      },
    });
  };

  const handleExtract = async () => {
    const panel = getActivePanelState();
    const archives = panel.selectedItems
      .map(itemId => panel.files.find(file => file.id === itemId))
      .filter((file): file is FileItem => Boolean(file && file.type === 'file' && file.name.toLowerCase().endsWith('.zip')));
    if (archives.length === 0) return;

    try {
      const provider = panel.mode === 'ssh' ? 'sftp' : 'local';
      for (const archive of archives) {
        try {
          await api.extractArchive(provider, archive.id, panel.currentPath, false, panel.sshSessionId);
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            const overwrite = window.confirm(`${error.message}\n\nOverwrite existing files?`);
            if (!overwrite) throw new Error('Extraction cancelled');
            await api.extractArchive(provider, archive.id, panel.currentPath, true, panel.sshSessionId);
          } else {
            throw error;
          }
        }
      }

      showToast(`Extracted ${archives.length} archive(s)`, 'success');
    } catch (error) {
      console.error('Archive extraction failed:', error);
      showToast(error instanceof Error ? error.message : 'Failed to extract archive', 'error');
    } finally {
      // A conflict or invalid later entry can leave earlier extracted files.
      await loadDirectory(panel.currentPath, activePanel, panel);
    }
  };

  const handleNewFile = () => {
    const panel = getActivePanelState();
    const side = activePanel;
    let pending = false;
    setModal({
      isOpen: true, type: 'input', title: 'New Text File', placeholder: 'File name...',
      action: async (name: string) => {
        if (pending) return;
        pending = true;
        try {
          const path = await createTextFile(panel, name);
          await loadDirectory(panel.currentPath, side, panel);
          const update = side === 'left' ? setLeftPanel : setRightPanel;
          update(state => ({ ...state, focusedItemId: path, selectedItems: [path] }));
          setModal({ isOpen: false, type: 'input', title: '' });
          setEditor({ isOpen: true, filePath: path, sessionId: panel.mode === 'ssh' ? panel.sshSessionId : undefined, readOnly: false });
        } catch (error) {
          showToast(error instanceof Error ? error.message : 'File creation failed', 'error');
        } finally { pending = false; }
      },
    });
  };

  const handleRename = () => {
    const panel = getActivePanelState();
    const item = currentItem(panel);
    if (!item) return;
    const side = activePanel;
    let pending = false;
    setModal({
      isOpen: true, type: 'input', title: 'Rename', defaultValue: item.name,
      action: async (name: string) => {
        if (pending) return;
        pending = true;
        try {
          const path = await renameCurrentItem(panel, name);
          await loadDirectory(panel.currentPath, side, panel);
          const update = side === 'left' ? setLeftPanel : setRightPanel;
          update(state => ({ ...state, focusedItemId: path, selectedItems: path ? [path] : [] }));
          setModal({ isOpen: false, type: 'input', title: '' });
        } catch (error) {
          showToast(error instanceof Error ? error.message : 'Rename failed', 'error');
        } finally { pending = false; }
      },
    });
  };

  const handleProperties = async () => {
    try {
      const info = await currentItemProperties(getActivePanelState());
      if (info) setProperties(info);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to load properties', 'error');
    }
  };

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!authenticated || !restored || e.defaultPrevented) return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-terminal-drawer]')) return;
    if (modal.isOpen || editor.isOpen || sshModal.isOpen || connectionsOpen || properties) return;
    const command = connectionShortcut(e);
    if (!command) return;
    e.preventDefault();
    const panel = getActivePanelState();
    switch (command) {
      case 'connections': setConnectionsOpen(true); break;
      case 'refresh': handleRefresh(); break;
      case 'swap': handleSwap(); break;
      case 'pack': handlePack(); break;
      case 'extract': handleExtract(); break;
      case 'newFile': handleNewFile(); break;
      case 'rename': handleRename(); break;
      case 'properties': handleProperties(); break;
      case 'terminal': (activePanel === 'left' ? leftPanelRef : rightPanelRef).current?.toggleTerminal(); break;
      case 'all': case 'clear': case 'invert': case 'insert': {
        const update = activePanel === 'left' ? setLeftPanel : setRightPanel;
        update(state => selectionAction(state, command));
        break;
      }
      case 'down': case 'up': {
        const update = activePanel === 'left' ? setLeftPanel : setRightPanel;
        update(state => moveCursor(state, command === 'down' ? 1 : -1));
        break;
      }
      case 'parent': handleNavigate('..'); break;
      case 'open': case 'view': case 'edit': {
        const action = itemAction(panel, command === 'open' ? 'Enter' : command === 'view' ? 'F3' : 'F4');
        if (action?.type === 'navigate') handleNavigate(action.path);
        else if (action?.type === 'open') handleFileOpen(action.path, action.readOnly);
        break;
      }
      case 'copy': handleCopy(); break;
      case 'move': handleMove(); break;
      case 'mkdir': handleMkdir(); break;
      case 'delete': handleDelete(); break;
      case 'switchPanel': setActivePanel(prev => prev === 'left' ? 'right' : 'left'); break;
    }
  }, [authenticated, restored, connectionsOpen, properties, activePanel, leftPanel, rightPanel, modal.isOpen, editor.isOpen, sshModal.isOpen]);

  useEffect(() => {
    if (!authenticated) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [authenticated, handleKeyDown]);

  if (!authenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
      {/* Toolbar */}
      <Toolbar
        onConnections={() => setConnectionsOpen(true)}
        onCopy={handleCopy}
        onMove={handleMove}
        onDelete={handleDelete}
        onMkdir={handleMkdir}
        onRefresh={handleRefresh}
        onPack={handlePack}
        onExtract={handleExtract}
        onSwap={handleSwap}
        onToggleSSHLeft={() => handleToggleSSH('left')}
        onToggleSSHRight={() => handleToggleSSH('right')}
        leftMode={leftPanel.mode}
        rightMode={rightPanel.mode}
        hasSelection={getActivePanelState().selectedItems.length > 0}
        canExtract={getActivePanelState().files.some(file =>
          getActivePanelState().selectedItems.includes(file.id)
          && file.type === 'file'
          && file.name.toLowerCase().endsWith('.zip')
        )}
      />

      {/* Main Content */}
      <div className="flex-1 flex gap-1 p-1 min-h-0">
        <div className="flex-1 min-w-0">
          <FilePanel
            ref={leftPanelRef}
            title="Left Panel"
            files={leftPanel.files}
            currentPath={leftPanel.currentPath}
            selectedItems={leftPanel.selectedItems}
            focusedItemId={leftPanel.focusedItemId}
            isActive={activePanel === 'left'}
            onSelect={(id, multi) => handleSelect(id, multi, 'left')}
            onNavigate={id => handleNavigate(id, 'left')}
            onPanelClick={() => setActivePanel('left')}
            sortBy={leftPanel.sortBy}
            sortOrder={leftPanel.sortOrder}
            onSort={column => handleSort(column, 'left')}
            onDoubleClick={id => handleFileOpen(id, false, 'left')}
            mode={leftPanel.mode}
            sshHost={leftPanel.sshHost}
            sshSessionId={leftPanel.sshSessionId}
            sshUser={leftPanel.sshUser}
          />
        </div>
        <div className="flex-1 min-w-0">
          <FilePanel
            ref={rightPanelRef}
            title="Right Panel"
            files={rightPanel.files}
            currentPath={rightPanel.currentPath}
            selectedItems={rightPanel.selectedItems}
            focusedItemId={rightPanel.focusedItemId}
            isActive={activePanel === 'right'}
            onSelect={(id, multi) => handleSelect(id, multi, 'right')}
            onNavigate={id => handleNavigate(id, 'right')}
            onPanelClick={() => setActivePanel('right')}
            sortBy={rightPanel.sortBy}
            sortOrder={rightPanel.sortOrder}
            onSort={column => handleSort(column, 'right')}
            onDoubleClick={id => handleFileOpen(id, false, 'right')}
            mode={rightPanel.mode}
            sshHost={rightPanel.sshHost}
            sshSessionId={rightPanel.sshSessionId}
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
        defaultValue={modal.defaultValue}
        message={modal.message}
        onClose={() => setModal({ isOpen: false, type: 'input', title: '' })}
        onConfirm={(value) => modal.action?.(value)}
      />

      {connectionsOpen && <ConnectionsModal onClose={() => setConnectionsOpen(false)} onUse={useConnection}
        onDisconnect={disconnectConnection} onNew={() => {
          setConnectionsOpen(false); setSSHModal({ isOpen: true, targetPanel: activePanel });
        }} />}
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
          readOnly={editor.readOnly}
          onClose={() => setEditor({ isOpen: false, filePath: '' })}
          onSave={() => loadDirectory(getActivePanelState().currentPath, activePanel)}
        />
      )}

      {properties && <PropertiesModal info={properties} onClose={() => setProperties(null)} />}

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
