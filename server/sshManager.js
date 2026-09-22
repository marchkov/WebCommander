const { Client } = require('ssh2');
const path = require('path');

// Хранилище активных SSH-соединений
const connections = new Map();

class SSHManager {
  // Подключение к серверу
  static async connect(sessionId, config) {
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

      conn.on('ready', () => {
        connections.set(sessionId, {
          conn,
          config,
          connectedAt: new Date()
        });
        resolve({ success: true, host: config.host, username: config.username });
      });

      conn.on('error', (err) => {
        connections.delete(sessionId);
        reject(new Error(`SSH connection failed: ${err.message}`));
      });

      conn.on('close', () => {
        connections.delete(sessionId);
      });

      conn.connect(connectionConfig);
    });
  }

  // Проверка соединения
  static getConnection(sessionId) {
    const session = connections.get(sessionId);
    if (!session) {
      throw new Error('SSH session not found. Please connect first.');
    }
    return session;
  }

  // Отключение
  static disconnect(sessionId) {
    const session = connections.get(sessionId);
    if (session) {
      session.conn.end();
      connections.delete(sessionId);
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
    const session = this.getConnection(sessionId);
    
    return new Promise((resolve, reject) => {
      if (isDirectory) {
        // Рекурсивное удаление через exec
        session.conn.exec(`rm -rf "${targetPath}"`, (err, stream) => {
          if (err) return reject(err);
          
          stream.on('close', (code) => {
            if (code === 0) {
              resolve({ success: true });
            } else {
              reject(new Error(`Delete failed with code ${code}`));
            }
          });
          
          stream.stderr.on('data', (data) => {
            reject(new Error(data.toString()));
          });
        });
      } else {
        session.conn.sftp((err, sftp) => {
          if (err) return reject(err);
          
          sftp.unlink(targetPath, (err) => {
            if (err) return reject(err);
            resolve({ success: true });
          });
        });
      }
    });
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
  static getActiveSessions() {
    const sessions = [];
    for (const [sessionId, session] of connections) {
      sessions.push({
        sessionId,
        host: session.config.host,
        port: session.config.port || 22,
        username: session.config.username,
        connectedAt: session.connectedAt,
      });
    }
    return sessions;
  }
}

module.exports = SSHManager;
