const { Client } = require('ssh2');
const path = require('path');
const { validateDimensions, closeShellChannel } = require('./services/terminalShell');

// Хранилище активных SSH-соединений
const connections = new Map();

class SSHManager {
  // Подключение к серверу
  static async connect(sessionId, config, ownerSessionId) {
    if (connections.has(sessionId)) throw Object.assign(new Error('SSH session already exists'), { status: 409 });
    return new Promise((resolve, reject) => {
      const conn = new Client();
      
      const connectionConfig = {
        host: config.host,
        port: config.port || 22,
        username: config.username,
        readyTimeout: 10000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
      };

      // Аутентификация
      if (config.privateKey) {
        connectionConfig.privateKey = config.privateKey;
        if (config.passphrase) {
          connectionConfig.passphrase = config.passphrase;
        }
      } else if (config.password) {
        connectionConfig.password = config.password;
      } else {
        return reject(new Error('Password or private key required'));
      }

      const session = { conn, config: { host: config.host, port: config.port || 22, username: config.username }, ownerSessionId, status: 'connecting' };
      connections.set(sessionId, session);
      const remove = status => {
        session.status = status;
        if (connections.get(sessionId) === session) connections.delete(sessionId);
      };
      conn.on('ready', () => {
        if (connections.get(sessionId) !== session) return conn.end();
        session.status = 'ready';
        session.connectedAt = new Date();
        resolve({ success: true, host: config.host, username: config.username });
      });

      conn.on('error', (err) => {
        remove('error');
        conn.end();
        reject(new Error(`SSH connection failed: ${err.message}`));
      });

      conn.on('close', () => {
        remove('closed');
        reject(new Error('SSH connection closed'));
      });

      conn.on('end', () => {
        remove('closed');
        conn.end();
        reject(new Error('SSH connection closed'));
      });
      try { conn.connect(connectionConfig); }
      catch (error) { remove('error'); conn.end(); reject(error); }
    });
  }

  // Проверка соединения
  static getConnection(sessionId, ownerSessionId) {
    const session = connections.get(sessionId);
    if (!session || session.status !== 'ready' || (ownerSessionId !== undefined && session.ownerSessionId !== ownerSessionId)) {
      throw Object.assign(new Error('SSH connection lost'), { code: 'SSH_SESSION_NOT_FOUND', status: 404 });
    }
    return session;
  }

  // Allocate a PTY channel on the existing login, never a second connection.
  static openShell(sessionId, { cols = 80, rows = 24, ownerSessionId, signal } = {}) {
    validateDimensions(cols, rows);
    const session = this.getConnection(sessionId);
    if (ownerSessionId !== undefined && session.ownerSessionId !== ownerSessionId) {
      throw new Error('SSH session does not belong to this web session');
    }
    return new Promise((resolve, reject) => {
      const { conn } = session;
      let settled = false;
      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort);
        conn.removeListener('close', onClose);
        conn.removeListener('error', onError);
      };
      const fail = error => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onAbort = () => fail(new Error('SSH shell opening cancelled'));
      const onClose = () => fail(new Error('SSH connection closed'));
      const onError = error => fail(error);
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      conn.once('close', onClose);
      conn.once('error', onError);
      try {
        conn.shell({ term: 'xterm-256color', cols, rows, height: 0, width: 0 }, (error, channel) => {
          if (settled) {
            if (channel) closeShellChannel(channel);
            return;
          }
          if (error) return fail(error);
          settled = true;
          cleanup();
          resolve(channel);
        });
      } catch (error) { fail(error); }
    });
  }

  // Получить существующий SFTP-канал для сессии
  static getSftp(sessionId) {
    const session = this.getConnection(sessionId);

    return new Promise((resolve, reject) => {
      session.conn.sftp((error, sftp) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(sftp);
      });
    });
  }

  // Отключение
  static disconnect(sessionId, ownerSessionId) {
    const session = connections.get(sessionId);
    if (session) {
      if (ownerSessionId !== undefined && session.ownerSessionId !== ownerSessionId) this.getConnection(sessionId, ownerSessionId);
      connections.delete(sessionId);
      session.conn.end();
    }
  }

  // Отключение всех сессий
  static disconnectAll() {
    for (const [sessionId, session] of connections) {
      session.conn.end();
    }
    connections.clear();
  }

  // Листинг директории
  static async listDir(sessionId, dirPath) {
    const session = this.getConnection(sessionId);
    
    return new Promise((resolve, reject) => {
      session.conn.sftp((err, sftp) => {
        if (err) return reject(err);
        
        sftp.readdir(dirPath, (err, list) => {
          if (err) return reject(err);
          
          const files = list.map(item => {
            const fullPath = path.join(dirPath, item.filename);
            return {
              id: fullPath,
              name: item.filename,
              type: item.attrs.isDirectory() ? 'folder' : 'file',
              size: item.attrs.size,
              modified: new Date(item.attrs.mtime * 1000),
              extension: item.attrs.isDirectory() ? undefined : path.extname(item.filename).slice(1),
              parentId: dirPath,
              permissions: (item.attrs.mode & 0o777).toString(8),
              uid: item.attrs.uid,
              gid: item.attrs.gid,
            };
          });
          
          resolve(files);
        });
      });
    });
  }

  // Чтение файла
  static async readFile(sessionId, filePath) {
    const session = this.getConnection(sessionId);
    
    return new Promise((resolve, reject) => {
      session.conn.sftp((err, sftp) => {
        if (err) return reject(err);
        
        let data = '';
        const stream = sftp.createReadStream(filePath, { encoding: 'utf8' });
        
        stream.on('data', (chunk) => {
          data += chunk;
        });
        
        stream.on('end', () => {
          resolve(data);
        });
        
        stream.on('error', (err) => {
          reject(err);
        });
      });
    });
  }

  // Запись файла
  static async writeFile(sessionId, filePath, content) {
    const session = this.getConnection(sessionId);
    
    return new Promise((resolve, reject) => {
      session.conn.sftp((err, sftp) => {
        if (err) return reject(err);
        
        const stream = sftp.createWriteStream(filePath);
        
        stream.on('close', () => {
          resolve({ success: true });
        });
        
        stream.on('error', (err) => {
          reject(err);
        });
        
        stream.end(content);
      });
    });
  }

  // Создание директории
  static async mkdir(sessionId, dirPath) {
    const session = this.getConnection(sessionId);
    
    return new Promise((resolve, reject) => {
      session.conn.sftp((err, sftp) => {
        if (err) return reject(err);
        
        sftp.mkdir(dirPath, (err) => {
          if (err) return reject(err);
          resolve({ success: true });
        });
      });
    });
  }

  // Удаление файла или директории
  static async delete(sessionId, targetPath, isDirectory) {
    const SftpProvider = require('./providers/sftpProvider');
    const provider = new SftpProvider({
      sessionId,
      sshManager: this,
    });

    await provider.delete(targetPath, { recursive: Boolean(isDirectory), force: true });
    return { success: true };
  }

  // Переименование
  static async rename(sessionId, oldPath, newPath) {
    const session = this.getConnection(sessionId);
    
    return new Promise((resolve, reject) => {
      session.conn.sftp((err, sftp) => {
        if (err) return reject(err);
        
        sftp.rename(oldPath, newPath, (err) => {
          if (err) return reject(err);
          resolve({ success: true });
        });
      });
    });
  }

  // Скачивание файла как буфер
  static async downloadFile(sessionId, filePath) {
    const session = this.getConnection(sessionId);
    
    return new Promise((resolve, reject) => {
      session.conn.sftp((err, sftp) => {
        if (err) return reject(err);
        
        const chunks = [];
        const stream = sftp.createReadStream(filePath);
        
        stream.on('data', (chunk) => {
          chunks.push(chunk);
        });
        
        stream.on('end', () => {
          resolve(Buffer.concat(chunks));
        });
        
        stream.on('error', (err) => {
          reject(err);
        });
      });
    });
  }

  // Загрузка файла из буфера
  static async uploadFile(sessionId, filePath, buffer) {
    const session = this.getConnection(sessionId);
    
    return new Promise((resolve, reject) => {
      session.conn.sftp((err, sftp) => {
        if (err) return reject(err);
        
        const stream = sftp.createWriteStream(filePath);
        
        stream.on('close', () => {
          resolve({ success: true });
        });
        
        stream.on('error', (err) => {
          reject(err);
        });
        
        stream.end(buffer);
      });
    });
  }

  // Информация о файле
  static async stat(sessionId, filePath) {
    const session = this.getConnection(sessionId);
    
    return new Promise((resolve, reject) => {
      session.conn.sftp((err, sftp) => {
        if (err) return reject(err);
        
        sftp.stat(filePath, (err, stats) => {
          if (err) return reject(err);
          
          resolve({
            path: filePath,
            name: path.basename(filePath),
            type: stats.isDirectory() ? 'folder' : 'file',
            size: stats.size,
            created: new Date(stats.atime * 1000),
            modified: new Date(stats.mtime * 1000),
            accessed: new Date(stats.atime * 1000),
            permissions: (stats.mode & 0o777).toString(8),
            uid: stats.uid,
            gid: stats.gid,
          });
        });
      });
    });
  }

  // Выполнение команды
  static async exec(sessionId, command) {
    const session = this.getConnection(sessionId);
    
    return new Promise((resolve, reject) => {
      session.conn.exec(command, (err, stream) => {
        if (err) return reject(err);
        
        let stdout = '';
        let stderr = '';
        
        stream.on('data', (data) => {
          stdout += data.toString();
        });
        
        stream.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        stream.on('close', (code) => {
          resolve({ stdout, stderr, code });
        });
      });
    });
  }

  // Копирование файла между локальным и SSH (или наоборот)
  static async transferFile(sessionId, sourcePath, destPath, direction) {
    const session = this.getConnection(sessionId);
    
    return new Promise((resolve, reject) => {
      session.conn.sftp((err, sftp) => {
        if (err) return reject(err);
        
        if (direction === 'upload') {
          // Локальный -> SSH
          sftp.fastPut(sourcePath, destPath, (err) => {
            if (err) return reject(err);
            resolve({ success: true });
          });
        } else {
          // SSH -> Локальный
          sftp.fastGet(sourcePath, destPath, (err) => {
            if (err) return reject(err);
            resolve({ success: true });
          });
        }
      });
    });
  }

  // Получить список активных сессий
  static getActiveSessions(ownerSessionId) {
    const sessions = [];
    for (const [sessionId, session] of connections) {
      if (session.status !== 'ready' || (ownerSessionId !== undefined && session.ownerSessionId !== ownerSessionId)) continue;
      sessions.push({
        sessionId,
        host: session.config.host,
        port: session.config.port || 22,
        username: session.config.username,
        connectedAt: session.connectedAt,
        status: session.status,
      });
    }
    return sessions;
  }
}

module.exports = SSHManager;
