/**
 * Common contract for filesystem providers.
 *
 * Provider implementations intentionally remain separate from the current HTTP
 * handlers until the filesystem migration is scheduled.
 */
class FileProvider {
  /** @param {'local' | 'sftp' | 'ftp'} type */
  constructor(type) {
    this.type = type;
  }

  async list(_path) {
    this.#notImplemented('list');
  }

  async stat(_path) {
    this.#notImplemented('stat');
  }

  async read(_path) {
    this.#notImplemented('read');
  }

  async write(_path, _data) {
    this.#notImplemented('write');
  }

  async mkdir(_path) {
    this.#notImplemented('mkdir');
  }

  async delete(_path, _options = {}) {
    this.#notImplemented('delete');
  }

  async rename(_oldPath, _newPath) {
    this.#notImplemented('rename');
  }

  joinPath(_basePath, _name) {
    this.#notImplemented('joinPath');
  }

  createReadStream(_path) {
    this.#notImplemented('createReadStream');
  }

  createWriteStream(_path) {
    this.#notImplemented('createWriteStream');
  }

  #notImplemented(operation) {
    throw new Error(`${this.constructor.name}.${operation} is not implemented`);
  }
}

module.exports = FileProvider;
