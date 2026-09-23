const path = require('path');
const FileProvider = require('./fileProvider');

/**
 * Future local filesystem provider.
 *
 * This class is intentionally not connected to server/index.js yet. Keeping
 * the root here establishes the API boundary for the later migration.
 */
class LocalProvider extends FileProvider {
  /** @param {{ rootPath: string }} options */
  constructor({ rootPath }) {
    super('local');

    if (!rootPath || typeof rootPath !== 'string') {
      throw new TypeError('LocalProvider requires a rootPath string');
    }

    this.rootPath = path.resolve(rootPath);
  }
}

module.exports = LocalProvider;
