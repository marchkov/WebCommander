const path = require('path');
const FileProvider = require('./fileProvider');

function normalizeRemotePath(remotePath) {
  const normalized = String(remotePath || '.').replace(/\\/g, '/');
  const posixPath = path.posix.normalize(normalized);
  if (posixPath === '.') return '/';
  const absolutePath = posixPath.startsWith('/') ? posixPath : `/${posixPath}`;
  return absolutePath.length > 1 ? absolutePath.replace(/\/$/, '') : absolutePath;
}

/**
 * Future SFTP provider.
 *
 * Remote paths are deliberately normalized with POSIX semantics. This avoids
 * using Windows path.join() when the server runs on a Windows host.
 */
class SftpProvider extends FileProvider {
  /** @param {{ sessionId: string, sshManager: object, rootPath?: string, sftp?: object }} options */
  constructor({ sessionId, sshManager, rootPath, sftp } = {}) {
    super('sftp');

    if (!sessionId || !sshManager || typeof sshManager.getSftp !== 'function') {
      throw new TypeError('SftpProvider requires sessionId and sshManager');
    }

    this.sessionId = sessionId;
    this.sshManager = sshManager;
    this.sftp = sftp;
    this.rootPath = rootPath && rootPath !== '~' ? normalizeRemotePath(rootPath) : null;
  }

  async getSftp() {
    if (!this.sftp) {
      this.sftp = await this.sshManager.getSftp(this.sessionId);
    }
    return this.sftp;
  }

  async resolvePath(remotePath) {
    const requestedPath = String(remotePath || '.');
    const sftp = await this.getSftp();

    if (!this.rootPath) {
      this.rootPath = normalizeRemotePath(await this.call(sftp, 'realpath', '.'));
    }

    if (requestedPath === '~') {
      return this.rootPath;
    }

    if (requestedPath.startsWith('~/')) {
      return path.posix.join(this.rootPath, normalizeRemotePath(requestedPath.slice(2)).slice(1));
    }

    if (requestedPath.startsWith('/')) {
      return normalizeRemotePath(requestedPath);
    }

    return path.posix.join(this.rootPath, normalizeRemotePath(requestedPath).slice(1));
  }

  async list(remotePath) {
    const resolvedPath = await this.resolvePath(remotePath);
    const sftp = await this.getSftp();
    const entries = await this.call(sftp, 'readdir', resolvedPath);

    return entries.map(entry => {
      const entryPath = path.posix.join(resolvedPath, entry.filename);
      return this.toFileEntry(entryPath, entry.filename, entry.attrs, resolvedPath);
    });
  }

  async stat(remotePath) {
    const resolvedPath = await this.resolvePath(remotePath);
    const sftp = await this.getSftp();
    const attrs = await this.call(sftp, 'stat', resolvedPath);
    return this.toFileEntry(resolvedPath, path.posix.basename(resolvedPath), attrs, path.posix.dirname(resolvedPath));
  }

  async read(remotePath) {
    const resolvedPath = await this.resolvePath(remotePath);
    const sftp = await this.getSftp();
    const stream = sftp.createReadStream(resolvedPath);
    let data = '';

    for await (const chunk of stream) {
      data += chunk.toString('utf8');
    }

    return data;
  }

  async write(remotePath, data) {
    const resolvedPath = await this.resolvePath(remotePath);
    const sftp = await this.getSftp();
    const stream = sftp.createWriteStream(resolvedPath);
    stream.end(data, 'utf8');
    await this.waitForStream(stream);
  }

  async mkdir(remotePath) {
    const resolvedPath = await this.resolvePath(remotePath);
    const sftp = await this.getSftp();
    await this.call(sftp, 'mkdir', resolvedPath);
  }

  async delete(remotePath, options = {}) {
    const resolvedPath = await this.resolvePath(remotePath);
    const sftp = await this.getSftp();
    const attrs = await this.call(sftp, 'stat', resolvedPath);

    if (!this.isDirectory(attrs)) {
      await this.call(sftp, 'unlink', resolvedPath);
      return;
    }

    if (options.recursive === true) {
      await this.deleteDirectory(sftp, resolvedPath);
      return;
    }

    await this.call(sftp, 'rmdir', resolvedPath);
  }

  async rename(oldRemotePath, newRemotePath) {
    const oldPath = await this.resolvePath(oldRemotePath);
    const newPath = await this.resolvePath(newRemotePath);
    const sftp = await this.getSftp();
    await this.call(sftp, 'rename', oldPath, newPath);
  }

  createReadStream(remotePath) {
    const resolvedPath = this.resolveStreamPath(remotePath);
    if (!this.sftp) {
      throw new Error('SftpProvider.createReadStream requires an initialized SFTP client');
    }

    return this.sftp.createReadStream(resolvedPath);
  }

  createWriteStream(remotePath) {
    const resolvedPath = this.resolveStreamPath(remotePath);
    if (!this.sftp) {
      throw new Error('SftpProvider.createWriteStream requires an initialized SFTP client');
    }

    return this.sftp.createWriteStream(resolvedPath);
  }

  async deleteDirectory(sftp, directoryPath) {
    const entries = await this.call(sftp, 'readdir', directoryPath);

    for (const entry of entries) {
      const entryPath = path.posix.join(directoryPath, entry.filename);
      if (this.isDirectory(entry.attrs)) {
        await this.deleteDirectory(sftp, entryPath);
      } else {
        await this.call(sftp, 'unlink', entryPath);
      }
    }

    await this.call(sftp, 'rmdir', directoryPath);
  }

  resolveStreamPath(remotePath) {
    const requestedPath = String(remotePath || '.');
    if (!this.rootPath) {
      throw new Error('SftpProvider must resolve an absolute root before creating streams');
    }

    if (requestedPath === '~') {
      return this.rootPath;
    }

    if (requestedPath.startsWith('~/')) {
      return path.posix.join(this.rootPath, normalizeRemotePath(requestedPath.slice(2)).slice(1));
    }

    return requestedPath.startsWith('/')
      ? normalizeRemotePath(requestedPath)
      : path.posix.join(this.rootPath, normalizeRemotePath(requestedPath).slice(1));
  }

  isDirectory(attrs) {
    return typeof attrs.isDirectory === 'function'
      ? attrs.isDirectory()
      : (attrs.mode & 0o170000) === 0o040000;
  }

  toFileEntry(entryPath, name, attrs, parentPath) {
    const isFolder = this.isDirectory(attrs);
    const modified = new Date((attrs.mtime || 0) * 1000);
    const accessed = new Date((attrs.atime || attrs.mtime || 0) * 1000);

    return {
      id: entryPath,
      path: entryPath,
      name,
      type: isFolder ? 'folder' : 'file',
      size: attrs.size || 0,
      modified,
      extension: isFolder ? undefined : path.posix.extname(name).slice(1),
      parentId: parentPath,
      permissions: attrs.mode === undefined ? undefined : (attrs.mode & 0o777).toString(8),
      uid: attrs.uid,
      gid: attrs.gid,
      created: accessed,
      accessed,
    };
  }

  call(sftp, method, ...args) {
    return new Promise((resolve, reject) => {
      sftp[method](...args, (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    });
  }

  waitForStream(stream) {
    return new Promise((resolve, reject) => {
      stream.once('error', reject);
      stream.once('close', resolve);
    });
  }
}

module.exports = SftpProvider;
module.exports.normalizeRemotePath = normalizeRemotePath;
