const path = require('path');

const failure = (message, status, code) => Object.assign(new Error(message), { status, code });
const missing = error => ['ENOENT', 'SSH_FX_NO_SUCH_FILE', 2].includes(error.code);

function validateFilename(name) {
  if (typeof name !== 'string' || !name.trim() || name === '.' || name === '..' ||
      /[\\/:<>"|?*\x00-\x1f\x7f]/.test(name) || /[. ]$/.test(name) ||
      /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) {
    throw failure('Invalid file name: a single basename is required', 400, 'INVALID_FILENAME');
  }
  return name;
}

function validateExtension(name, allowedExtensions = ['*']) {
  const allowed = allowedExtensions.map(value => String(value).trim().toLowerCase().replace(/^\./, ''));
  const extension = path.posix.extname(name).slice(1).toLowerCase() || '<none>';
  if (!allowed.includes('*') && !allowed.includes(extension)) {
    throw failure('File extension is not allowed', 415, 'EXTENSION_NOT_ALLOWED');
  }
}

async function createExclusiveFile({ provider, directory, name, data, allowedExtensions }) {
  validateFilename(name);
  validateExtension(name, allowedExtensions);
  const parent = await provider.stat(directory);
  if (parent.type !== 'folder') throw failure('Destination must be a directory', 403, 'INVALID_PATH');
  const destination = provider.joinPath(parent.path, name);
  try {
    await provider.lstat(destination);
    throw failure('Destination already exists', 409, 'DESTINATION_EXISTS');
  } catch (error) {
    if (!missing(error)) throw error;
  }
  try {
    // The pre-check handles directories and links; exclusive creation closes the file race.
    await provider.write(destination, data, { exclusive: true });
  } catch (error) {
    if (error.code === 'EEXIST' || error.code === 11) {
      throw failure('Destination already exists', 409, 'DESTINATION_EXISTS');
    }
    // SFTP v3 may report an exclusive-open collision as generic SSH_FX_FAILURE.
    if (error.code === 4) {
      let exists = false;
      try { await provider.lstat(destination); exists = true; } catch { /* Retain the original failure. */ }
      if (exists) throw failure('Destination already exists', 409, 'DESTINATION_EXISTS');
    }
    throw error;
  }
  return destination;
}

module.exports = { validateFilename, validateExtension, createExclusiveFile, failure, missing };
