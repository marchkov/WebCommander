/**
 * @typedef {'file' | 'folder'} FileEntryType
 */

/**
 * @typedef {Object} FileEntry
 * @property {string} id Stable provider-specific identifier.
 * @property {string} path Full provider path.
 * @property {string} name Display name.
 * @property {FileEntryType} type Entry kind.
 * @property {number} size Size in bytes.
 * @property {Date|string} modified Last modification time.
 * @property {string|undefined} extension File extension without a leading dot.
 * @property {string|undefined} parentId Parent entry identifier or path.
 * @property {string|number|undefined} permissions Provider-specific permissions.
 * @property {number|string|undefined} uid Owner user identifier.
 * @property {number|string|undefined} gid Owner group identifier.
 */

/**
 * @typedef {'local' | 'sftp' | 'ftp'} FileProviderType
 */

/**
 * @typedef {Object} DeleteOptions
 * @property {boolean} [recursive] Delete directories recursively.
 * @property {boolean} [force] Ignore a missing target when supported.
 */

module.exports = {};
