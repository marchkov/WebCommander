const { Readable, Writable } = require('stream');

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

  list(_path) {
    return this.#notImplemented('list');
  }

  stat(_path) {
    return this.#notImplemented('stat');
  }

  read(_path) {
    return this.#notImplemented('read');
  }

  write(_path, _data) {
    return this.#notImplemented('write');
  }

  mkdir(_path) {
    return this.#notImplemented('mkdir');
  }

  delete(_path, _options = {}) {
    return this.#notImplemented('delete');
  }

  rename(_oldPath, _newPath) {
    return this.#notImplemented('rename');
  }

  createReadStream(_path) {
    this.#notImplemented('createReadStream');
    return Readable.toWeb ? Readable.from([]) : Readable.from([]);
  }

  createWriteStream(_path) {
    this.#notImplemented('createWriteStream');
    return new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  }

  #notImplemented(operation) {
    throw new Error(`${this.constructor.name}.${operation} is not implemented`);
  }
}

module.exports = FileProvider;
