const path = require('path');
const FileProvider = require('./fileProvider');

function normalizeRemotePath(remotePath) {
  const normalized = String(remotePath || '.').replace(/\\/g, '/');
  const posixPath = path.posix.normalize(normalized);
  if (posixPath === '.') return '/';
  return posixPath.length > 1 ? posixPath.replace(/\/$/, '') : posixPath;
}

/**
 * Future SFTP provider.
 *
 * Remote paths are deliberately normalized with POSIX semantics. This avoids
 * using Windows path.join() when the server runs on a Windows host.
 */
class SftpProvider extends FileProvider {
  /** @param {{ client?: object, rootPath?: string }} [options] */
  constructor({ client, rootPath = '/' } = {}) {
    super('sftp');
    this.client = client;
    this.rootPath = normalizeRemotePath(rootPath);
  }
}

module.exports = SftpProvider;
module.exports.normalizeRemotePath = normalizeRemotePath;
