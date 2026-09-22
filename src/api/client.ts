const API_BASE = 'http://localhost:3001/api';

// Demo mode flag - работает без сервера
let demoMode = false;

class ApiClient {
  private async request<T>(url: string, options: RequestInit = {}): Promise<T> {
    // Если в demo режиме, используем mock данные
    if (demoMode) {
      return this.mockRequest<T>(url, options);
    }

    try {
      const response = await fetch(`${API_BASE}${url}`, {
        ...options,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (response.status === 401) {
        window.location.href = '/login';
        throw new Error('Authentication required');
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Request failed');
      }

      return response.json();
    } catch (error) {
      // Если сервер недоступен, переключаемся в demo режим
      if (error instanceof TypeError && error.message.includes('fetch')) {
        console.warn('Server not available, switching to demo mode');
        demoMode = true;
        return this.mockRequest<T>(url, options);
      }
      throw error;
    }
  }

  // Mock запросы для demo режима
  private async mockRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
    await new Promise(resolve => setTimeout(resolve, 300)); // Имитация задержки

    // Auth endpoints
    if (url === '/auth/login') {
      const body = JSON.parse(options.body as string);
      if (body.username === 'admin' && body.password === 'admin123') {
        localStorage.setItem('demo_auth', 'true');
        return { success: true, username: 'admin' } as T;
      }
      throw new Error('Invalid credentials');
    }

    if (url === '/auth/logout') {
      localStorage.removeItem('demo_auth');
      return { success: true } as T;
    }

    if (url === '/auth/check') {
      const authenticated = localStorage.getItem('demo_auth') === 'true';
      return { authenticated, username: authenticated ? 'admin' : null } as T;
    }

    // Files endpoints
    if (url.startsWith('/files?')) {
      const params = new URLSearchParams(url.split('?')[1]);
      const path = params.get('path') || '/';
      
      // Mock file system
      const mockFiles = this.getMockFiles(path);
      return { path, files: mockFiles } as T;
    }

    if (url.startsWith('/files/read?')) {
      const params = new URLSearchParams(url.split('?')[1]);
      const path = params.get('path') || '';
      return { 
        content: `# Sample file content\n\nThis is a demo file at ${path}\n\nYou can edit this content.`,
        path 
      } as T;
    }

    if (url === '/files/write') {
      return { success: true, path: '/demo/file.txt' } as T;
    }

    if (url === '/files/mkdir') {
      return { success: true, path: '/demo/new-folder' } as T;
    }

    if (url === '/files/delete') {
      return { success: true } as T;
    }

    if (url === '/files/copy') {
      return { success: true } as T;
    }

    if (url === '/files/move') {
      return { success: true } as T;
    }

    if (url === '/files/rename') {
      return { success: true, newPath: '/demo/renamed' } as T;
    }

    if (url.startsWith('/files/info?')) {
      return {
        path: '/demo/file.txt',
        name: 'file.txt',
        type: 'file',
        size: 1024,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        accessed: new Date().toISOString(),
        permissions: '644'
      } as T;
    }

    throw new Error('Mock endpoint not implemented');
  }

  private getMockFiles(path: string): any[] {
    if (path === '/' || path === '') {
      return [
        { id: '/Documents', name: 'Documents', type: 'folder', size: 0, modified: new Date('2025-12-01'), parentId: '/' },
        { id: '/Downloads', name: 'Downloads', type: 'folder', size: 0, modified: new Date('2025-11-15'), parentId: '/' },
        { id: '/Pictures', name: 'Pictures', type: 'folder', size: 0, modified: new Date('2025-10-20'), parentId: '/' },
        { id: '/Projects', name: 'Projects', type: 'folder', size: 0, modified: new Date('2026-01-10'), parentId: '/' },
        { id: '/readme.txt', name: 'readme.txt', type: 'file', size: 2048, modified: new Date('2025-12-20'), extension: 'txt', parentId: '/' },
        { id: '/config.json', name: 'config.json', type: 'file', size: 1024, modified: new Date('2026-01-12'), extension: 'json', parentId: '/' },
      ];
    }

    if (path === '/Documents') {
      return [
        { id: '/Documents/Work', name: 'Work', type: 'folder', size: 0, modified: new Date('2025-11-01'), parentId: '/Documents' },
        { id: '/Documents/report.pdf', name: 'report.pdf', type: 'file', size: 524288, modified: new Date('2025-12-10'), extension: 'pdf', parentId: '/Documents' },
        { id: '/Documents/notes.md', name: 'notes.md', type: 'file', size: 4096, modified: new Date('2026-01-05'), extension: 'md', parentId: '/Documents' },
      ];
    }

    if (path === '/Downloads') {
      return [
        { id: '/Downloads/archive.zip', name: 'archive.zip', type: 'file', size: 10485760, modified: new Date('2025-12-25'), extension: 'zip', parentId: '/Downloads' },
        { id: '/Downloads/image.png', name: 'image.png', type: 'file', size: 2097152, modified: new Date('2026-01-13'), extension: 'png', parentId: '/Downloads' },
      ];
    }

    if (path === '/Pictures') {
      return [
        { id: '/Pictures/wallpaper.jpg', name: 'wallpaper.jpg', type: 'file', size: 4194304, modified: new Date('2025-10-01'), extension: 'jpg', parentId: '/Pictures' },
        { id: '/Pictures/avatar.png', name: 'avatar.png', type: 'file', size: 524288, modified: new Date('2025-12-05'), extension: 'png', parentId: '/Pictures' },
      ];
    }

    if (path === '/Projects') {
      return [
        { id: '/Projects/webapp', name: 'webapp', type: 'folder', size: 0, modified: new Date('2026-01-14'), parentId: '/Projects' },
        { id: '/Projects/TODO.md', name: 'TODO.md', type: 'file', size: 2048, modified: new Date('2026-01-14'), extension: 'md', parentId: '/Projects' },
      ];
    }

    if (path === '/Documents/Work') {
      return [
        { id: '/Documents/Work/project-plan.docx', name: 'project-plan.docx', type: 'file', size: 81920, modified: new Date('2025-11-15'), extension: 'docx', parentId: '/Documents/Work' },
        { id: '/Documents/Work/meeting-notes.txt', name: 'meeting-notes.txt', type: 'file', size: 4096, modified: new Date('2026-01-08'), extension: 'txt', parentId: '/Documents/Work' },
      ];
    }

    if (path === '/Projects/webapp') {
      return [
        { id: '/Projects/webapp/index.html', name: 'index.html', type: 'file', size: 4096, modified: new Date('2026-01-14'), extension: 'html', parentId: '/Projects/webapp' },
        { id: '/Projects/webapp/styles.css', name: 'styles.css', type: 'file', size: 8192, modified: new Date('2026-01-13'), extension: 'css', parentId: '/Projects/webapp' },
        { id: '/Projects/webapp/app.js', name: 'app.js', type: 'file', size: 16384, modified: new Date('2026-01-14'), extension: 'js', parentId: '/Projects/webapp' },
      ];
    }

    return [];
  }

  // Auth
  async login(username: string, password: string) {
    return this.request<{ success: boolean; username: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  async logout() {
    return this.request<{ success: boolean }>('/auth/logout', {
      method: 'POST',
    });
  }

  async checkAuth() {
    return this.request<{ authenticated: boolean; username: string | null }>('/auth/check');
  }

  // Files
  async listFiles(path: string) {
    return this.request<{ path: string; files: any[] }>(`/files?path=${encodeURIComponent(path)}`);
  }

  async readFile(path: string) {
    return this.request<{ content: string; path: string }>(`/files/read?path=${encodeURIComponent(path)}`);
  }

  async writeFile(path: string, content: string) {
    return this.request<{ success: boolean; path: string }>('/files/write', {
      method: 'POST',
      body: JSON.stringify({ path, content }),
    });
  }

  async mkdir(path: string, name: string) {
    return this.request<{ success: boolean; path: string }>('/files/mkdir', {
      method: 'POST',
      body: JSON.stringify({ path, name }),
    });
  }

  async delete(path: string) {
    return this.request<{ success: boolean }>('/files/delete', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  }

  async copy(source: string, destination: string) {
    return this.request<{ success: boolean }>('/files/copy', {
      method: 'POST',
      body: JSON.stringify({ source, destination }),
    });
  }

  async move(source: string, destination: string) {
    return this.request<{ success: boolean }>('/files/move', {
      method: 'POST',
      body: JSON.stringify({ source, destination }),
    });
  }

  async rename(path: string, newName: string) {
    return this.request<{ success: boolean; newPath: string }>('/files/rename', {
      method: 'POST',
      body: JSON.stringify({ path, newName }),
    });
  }

  async upload(path: string, file: File) {
    if (demoMode) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return { success: true, filename: file.name, path: `${path}/${file.name}`, size: file.size };
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', path);

    const response = await fetch(`${API_BASE}/files/upload`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Upload failed');
    }

    return response.json();
  }

  async download(path: string) {
    if (demoMode) {
      alert('Download is not available in demo mode');
      return;
    }
    window.open(`${API_BASE}/files/download?path=${encodeURIComponent(path)}`, '_blank');
  }

  async getFileInfo(path: string) {
    return this.request<{
      path: string;
      name: string;
      type: string;
      size: number;
      created: string;
      modified: string;
      accessed: string;
      permissions: string;
    }>(`/files/info?path=${encodeURIComponent(path)}`);
  }

  // ============ SSH Methods ============

  async sshConnect(sessionId: string, config: {
    host: string;
    port?: number;
    username: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
  }) {
    if (demoMode) {
      await new Promise(resolve => setTimeout(resolve, 500));
      return { success: true, host: config.host, username: config.username };
    }

    return this.request<{ success: boolean; host: string; username: string }>('/ssh/connect', {
      method: 'POST',
      body: JSON.stringify({ sessionId, ...config }),
    });
  }

  async sshDisconnect(sessionId: string) {
    if (demoMode) {
      await new Promise(resolve => setTimeout(resolve, 200));
      return { success: true };
    }

    return this.request<{ success: boolean }>('/ssh/disconnect', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
  }

  async sshGetSessions() {
    if (demoMode) {
      return [];
    }

    return this.request<Array<{
      sessionId: string;
      host: string;
      port: number;
      username: string;
      connectedAt: string;
    }>>('/ssh/sessions');
  }

  async sshListFiles(sessionId: string, path: string) {
    if (demoMode) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return {
        path,
        files: [
          { id: `${path}/etc`, name: 'etc', type: 'folder', size: 0, modified: new Date('2025-01-01'), parentId: path },
          { id: `${path}/var`, name: 'var', type: 'folder', size: 0, modified: new Date('2025-01-01'), parentId: path },
          { id: `${path}/home`, name: 'home', type: 'folder', size: 0, modified: new Date('2025-01-01'), parentId: path },
          { id: `${path}/README.md`, name: 'README.md', type: 'file', size: 1024, modified: new Date('2026-01-10'), extension: 'md', parentId: path },
        ]
      };
    }

    return this.request<{ path: string; files: any[] }>(
      `/ssh/files?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`
    );
  }

  async sshReadFile(sessionId: string, path: string) {
    if (demoMode) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return {
        content: `# SSH File\n\nThis is a demo SSH file at ${path}\n\nYou can edit this content in demo mode.`,
        path
      };
    }

    return this.request<{ content: string; path: string }>(
      `/ssh/files/read?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`
    );
  }

  async sshWriteFile(sessionId: string, path: string, content: string) {
    if (demoMode) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return { success: true, path };
    }

    return this.request<{ success: boolean; path: string }>('/ssh/files/write', {
      method: 'POST',
      body: JSON.stringify({ sessionId, path, content }),
    });
  }

  async sshMkdir(sessionId: string, path: string) {
    if (demoMode) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return { success: true };
    }

    return this.request<{ success: boolean }>('/ssh/files/mkdir', {
      method: 'POST',
      body: JSON.stringify({ sessionId, path }),
    });
  }

  async sshDelete(sessionId: string, path: string, isDirectory: boolean) {
    if (demoMode) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return { success: true };
    }

    return this.request<{ success: boolean }>('/ssh/files/delete', {
      method: 'POST',
      body: JSON.stringify({ sessionId, path, isDirectory }),
    });
  }

  async sshRename(sessionId: string, oldPath: string, newPath: string) {
    if (demoMode) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return { success: true };
    }

    return this.request<{ success: boolean }>('/ssh/files/rename', {
      method: 'POST',
      body: JSON.stringify({ sessionId, path: oldPath, newPath }),
    });
  }

  async sshDownload(sessionId: string, path: string) {
    if (demoMode) {
      alert('SSH download is not available in demo mode');
      return;
    }

    window.open(
      `${API_BASE}/ssh/files/download?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`,
      '_blank'
    );
  }

  async sshTransfer(sessionId: string, sourcePath: string, destPath: string, direction: 'upload' | 'download') {
    if (demoMode) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return { success: true };
    }

    return this.request<{ success: boolean }>('/ssh/transfer', {
      method: 'POST',
      body: JSON.stringify({ sessionId, sourcePath, destPath, direction }),
    });
  }

  async sshExec(sessionId: string, command: string) {
    if (demoMode) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return { stdout: `Demo output for: ${command}`, stderr: '', code: 0 };
    }

    return this.request<{ stdout: string; stderr: string; code: number }>('/ssh/exec', {
      method: 'POST',
      body: JSON.stringify({ sessionId, command }),
    });
  }

  // Проверка режима
  isDemoMode() {
    return demoMode;
  }
}

export const api = new ApiClient();
