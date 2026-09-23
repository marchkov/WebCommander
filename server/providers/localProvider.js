const fs = require('fs');
const path = require('path');
const FileProvider = require('./fileProvider');
const { validatePath } = require('../pathUtils');

/**
 * Local filesystem provider.
 */
class LocalProvider extends FileProvider {
  /** @param {{ rootPath: string, allowedPaths?: string[], blockedPaths?: string[] }} options */
  constructor({ rootPath, allowedPaths, blockedPaths }) {
    super('local');

    if (!rootPath || typeof rootPath !== 'string') {
      throw new TypeError('LocalProvider requires a rootPath string');
    }

    this.rootPath = path.resolve(rootPath);
    this.allowedPaths = allowedPaths;
    this.blockedPaths = blockedPaths;
  }

  async list(targetPath) {
    const resolvedPath = this.resolvePath(targetPath);
    const entries = await fs.promises.readdir(resolvedPath, { withFileTypes: true });

    return Promise.all(entries.map(async entry => {
      const entryPath = path.join(resolvedPath, entry.name);
      return this.toFileEntry(entryPath, entry.name, await fs.promises.stat(entryPath), resolvedPath);
    }));
  }

  async stat(targetPath) {
    const resolvedPath = this.resolvePath(targetPath);
    const stats = await fs.promises.stat(resolvedPath);
    return this.toFileEntry(resolvedPath, path.basename(resolvedPath), stats, path.dirname(resolvedPath));
  }

  async read(targetPath) {
    return fs.promises.readFile(this.resolvePath(targetPath), 'utf8');
  }

  async write(targetPath, data) {
    const resolvedPath = this.resolvePath(targetPath);
    await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.promises.writeFile(resolvedPath, data, 'utf8');
  }

  async mkdir(targetPath) {
    const resolvedPath = this.resolvePath(targetPath);
    await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.promises.mkdir(resolvedPath);
  }

  async delete(targetPath, options = {}) {
    const resolvedPath = this.resolvePath(targetPath);
    const stats = await fs.promises.stat(resolvedPath);

    if (stats.isDirectory()) {
      await fs.promises.rm(resolvedPath, {
        recursive: options.recursive === true,
        force: options.force === true,
      });
      return;
    }

    await fs.promises.unlink(resolvedPath);
  }

  async rename(oldPath, newPath) {
    const resolvedOldPath = this.resolvePath(oldPath);
    const resolvedNewPath = this.resolvePath(newPath);
    await fs.promises.rename(resolvedOldPath, resolvedNewPath);
  }

  joinPath(basePath, name) {
    return path.join(basePath, name);
  }

  createReadStream(targetPath) {
    return fs.createReadStream(this.resolvePath(targetPath));
  }

  createWriteStream(targetPath) {
    return fs.createWriteStream(this.resolvePath(targetPath));
  }

  resolvePath(targetPath) {
    const validation = validatePath(targetPath, {
      rootPath: this.rootPath,
      allowedPaths: this.allowedPaths,
      blockedPaths: this.blockedPaths,
    });

    if (!validation.valid) {
      const error = new Error(validation.error);
      error.code = 'PATH_VALIDATION';
      error.statusCode = 403;
      throw error;
    }

    return validation.path;
  }

  async toFileEntry(entryPath, name, stats, parentPath) {
    const isFolder = stats.isDirectory();
    return {
      id: entryPath,
      path: entryPath,
      name,
      type: isFolder ? 'folder' : 'file',
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      accessed: stats.atime,
      extension: isFolder ? undefined : path.extname(name).slice(1),
      parentId: parentPath,
      permissions: stats.mode.toString(8).slice(-3),
      uid: stats.uid,
      gid: stats.gid,
    };
  }
}

module.exports = LocalProvider;
