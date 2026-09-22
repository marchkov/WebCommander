const API_BASE = 'http://localhost:3001/api';

class ApiClient {
  private async request<T>(url: string, options: RequestInit = {}): Promise<T> {
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
}

export const api = new ApiClient();
