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
    this.realAllowedPaths = null;
    this.realBlockedPaths = null;
  }

  async list(targetPath) {
    const resolvedPath = (await this.validateExistingPath(targetPath)).path;
    const entries = await fs.promises.readdir(resolvedPath, { withFileTypes: true });

    return Promise.all(entries.map(async entry => {
      const entryPath = path.join(resolvedPath, entry.name);
      const entryStats = await this.validateExistingPath(entryPath);
      return this.toFileEntry(entryPath, entry.name, entryStats.stats, resolvedPath);
    }));
  }

  async stat(targetPath) {
    const result = await this.validateExistingPath(targetPath);
    return this.toFileEntry(result.path, path.basename(result.path), result.stats, path.dirname(result.path));
  }

  async read(targetPath) {
    const resolvedPath = await this.validateExistingPath(targetPath);
    return fs.promises.readFile(resolvedPath.path, 'utf8');
  }

  async write(targetPath, data) {
    const resolvedPath = await this.validateDestinationPath(targetPath);
    await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.promises.writeFile(resolvedPath, data, 'utf8');
  }

  async mkdir(targetPath) {
    const resolvedPath = await this.validateDestinationPath(targetPath);
    await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.promises.mkdir(resolvedPath);
  }

  async delete(targetPath, options = {}) {
    const lexicalPath = this.resolvePath(targetPath);
    const linkStats = await fs.promises.lstat(lexicalPath);

    if (linkStats.isSymbolicLink()) {
      await this.validateLinkEntry(lexicalPath);
      await fs.promises.unlink(lexicalPath);
      return;
    }

    const result = await this.validateExistingPath(targetPath);
    const resolvedPath = result.path;
    const stats = result.stats;

    if (stats.isDirectory()) {
      if (options.recursive === true) {
        await this.removeDirectory(resolvedPath);
      } else {
        await fs.promises.rm(resolvedPath, { force: options.force === true });
      }
      return;
    }

    await fs.promises.unlink(resolvedPath);
  }

  async rename(oldPath, newPath) {
    const lexicalOldPath = this.resolvePath(oldPath);
    const oldStats = await fs.promises.lstat(lexicalOldPath);
    const resolvedOldPath = oldStats.isSymbolicLink()
      ? (await this.validateLinkEntry(lexicalOldPath)).path
      : (await this.validateExistingPath(oldPath)).path;
    const resolvedNewPath = await this.validateDestinationPath(newPath);
    await fs.promises.rename(resolvedOldPath, resolvedNewPath);
  }

  joinPath(basePath, name) {
    return path.join(basePath, name);
  }

  getFilesystemId() {
    const allowedPaths = (this.allowedPaths || [this.rootPath])
      .map(targetPath => path.resolve(targetPath))
      .sort()
      .join('|');
    const blockedPaths = (this.blockedPaths || [])
      .map(targetPath => path.resolve(targetPath))
      .sort()
      .join('|');

    return `local:${this.rootPath}|allowed:${allowedPaths}|blocked:${blockedPaths}`;
  }

  normalizePath(targetPath) {
    return this.resolvePath(targetPath);
  }

  isSamePath(leftPath, rightPath) {
    return this.normalizePath(leftPath) === this.normalizePath(rightPath);
  }

  isDescendantPath(parentPath, childPath) {
    const relativePath = path.relative(this.normalizePath(parentPath), this.normalizePath(childPath));
    return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
  }

  createReadStream(targetPath) {
    const result = this.validateExistingPathSync(targetPath);
    return fs.createReadStream(result.path);
  }

  createWriteStream(targetPath) {
    return fs.createWriteStream(this.validateDestinationPathSync(targetPath));
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

  async validateExistingPath(targetPath) {
    const lexicalPath = this.resolvePath(targetPath);
    const stats = await fs.promises.lstat(lexicalPath);
    const realPath = await fs.promises.realpath(lexicalPath);
    await this.validateRealPath(realPath);
    return { path: lexicalPath, realPath, stats: stats.isSymbolicLink() ? await fs.promises.stat(lexicalPath) : stats };
  }

  async validateDestinationPath(targetPath) {
    const lexicalPath = this.resolvePath(targetPath);
    const ancestor = await this.resolveNearestExistingAncestor(lexicalPath);
    await this.validateRealPath(ancestor.realPath);
    return lexicalPath;
  }

  async validateLinkEntry(lexicalPath) {
    const ancestor = await this.resolveNearestExistingAncestor(path.dirname(lexicalPath));
    await this.validateRealPath(ancestor.realPath);
    return { path: lexicalPath, realPath: lexicalPath };
  }

  async resolveNearestExistingAncestor(targetPath) {
    let currentPath = targetPath;
    while (true) {
      try {
        await fs.promises.lstat(currentPath);
        return { path: currentPath, realPath: await fs.promises.realpath(currentPath) };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) throw error;
        currentPath = parentPath;
      }
    }
  }

  async validateRealPath(realPath) {
    const [allowedPaths, blockedPaths] = await Promise.all([
      this.getRealConfiguredPaths('allowed'),
      this.getRealConfiguredPaths('blocked'),
    ]);

    if (blockedPaths.some(blockedPath => this.isWithin(blockedPath, realPath))) {
      throw this.pathSecurityError('Path is blocked');
    }

    if (allowedPaths.length > 0 && !allowedPaths.some(allowedPath => this.isWithin(allowedPath, realPath))) {
      throw this.pathSecurityError('Path not in allowed directories');
    }
  }

  async getRealConfiguredPaths(kind) {
    const property = kind === 'allowed' ? 'realAllowedPaths' : 'realBlockedPaths';
    if (this[property]) return this[property];

    const configuredPaths = kind === 'allowed'
      ? (this.allowedPaths || [this.rootPath])
      : (this.blockedPaths || []);
    const resolvedPaths = [];
    let hasMissingPath = false;
    for (const configuredPath of configuredPaths) {
      try {
        resolvedPaths.push(await fs.promises.realpath(path.resolve(configuredPath)));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        hasMissingPath = true;
      }
    }
    if (!hasMissingPath) this[property] = resolvedPaths;
    return resolvedPaths;
  }

  validateExistingPathSync(targetPath) {
    const lexicalPath = this.resolvePath(targetPath);
    const stats = fs.lstatSync(lexicalPath);
    const realPath = fs.realpathSync(lexicalPath);
    this.validateRealPathSync(realPath);
    return { path: lexicalPath, realPath, stats: stats.isSymbolicLink() ? fs.statSync(lexicalPath) : stats };
  }

  validateDestinationPathSync(targetPath) {
    const lexicalPath = this.resolvePath(targetPath);
    const ancestor = this.resolveNearestExistingAncestorSync(lexicalPath);
    this.validateRealPathSync(ancestor.realPath);
    return lexicalPath;
  }

  resolveNearestExistingAncestorSync(targetPath) {
    let currentPath = targetPath;
    while (true) {
      try {
        fs.lstatSync(currentPath);
        return { path: currentPath, realPath: fs.realpathSync(currentPath) };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) throw error;
        currentPath = parentPath;
      }
    }
  }

  validateRealPathSync(realPath) {
    const allowedPaths = this.getRealConfiguredPathsSync('allowed');
    const blockedPaths = this.getRealConfiguredPathsSync('blocked');
    if (blockedPaths.some(blockedPath => this.isWithin(blockedPath, realPath))) {
      throw this.pathSecurityError('Path is blocked');
    }
    if (allowedPaths.length > 0 && !allowedPaths.some(allowedPath => this.isWithin(allowedPath, realPath))) {
      throw this.pathSecurityError('Path not in allowed directories');
    }
  }

  getRealConfiguredPathsSync(kind) {
    const property = kind === 'allowed' ? 'realAllowedPaths' : 'realBlockedPaths';
    if (this[property]) return this[property];
    const configuredPaths = kind === 'allowed'
      ? (this.allowedPaths || [this.rootPath])
      : (this.blockedPaths || []);
    let hasMissingPath = false;
    const resolvedPaths = configuredPaths.flatMap(configuredPath => {
      try {
        return [fs.realpathSync(path.resolve(configuredPath))];
      } catch (error) {
        if (error.code === 'ENOENT') {
          hasMissingPath = true;
          return [];
        }
        throw error;
      }
    });
    if (!hasMissingPath) this[property] = resolvedPaths;
    return resolvedPaths;
  }

  isWithin(basePath, targetPath) {
    const relativePath = path.relative(basePath, targetPath);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
  }

  pathSecurityError(message) {
    const error = new Error(message);
    error.code = 'PATH_VALIDATION';
    error.statusCode = 403;
    return error;
  }

  async removeDirectory(directoryPath) {
    const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isSymbolicLink()) {
        await fs.promises.unlink(entryPath);
      } else if (entry.isDirectory()) {
        await this.removeDirectory(entryPath);
      } else {
        await fs.promises.unlink(entryPath);
      }
    }
    await fs.promises.rmdir(directoryPath);
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
