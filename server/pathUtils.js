const path = require('path');

function normalizePathForFs(targetPath) {
  if (!targetPath || targetPath === '/' || targetPath === '\\' || targetPath === '.') {
    return path.resolve('.');
  }

  return String(targetPath)
    .replace(/\\/g, '/')
    .replace(/[/\\]+$/, '') || path.resolve('.');
}

function isWithinDirectory(basePath, targetPath) {
  const normalizedBase = normalizePathForFs(basePath);
  const normalizedTarget = normalizePathForFs(targetPath);
  const relative = path.relative(normalizedBase, normalizedTarget);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validatePath(targetPath, config) {
  const rootPath = config.rootPath || process.cwd();
  const allowedPaths = Array.isArray(config.allowedPaths) ? config.allowedPaths : [rootPath];
  const blockedPaths = Array.isArray(config.blockedPaths) ? config.blockedPaths : [];

  const normalizedTarget = normalizePathForFs(targetPath);
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(normalizedTarget);

  const isBlocked = blockedPaths.some(blockedPath => {
    const resolvedBlocked = path.resolve(blockedPath);
    return isWithinDirectory(resolvedBlocked, resolvedTarget) || resolvedTarget === resolvedBlocked;
  });

  if (isBlocked) {
    return { valid: false, error: 'Path is blocked' };
  }

  const isAllowed = allowedPaths.some(allowedPath => {
    const resolvedAllowed = path.resolve(allowedPath);
    return isWithinDirectory(resolvedAllowed, resolvedTarget) || resolvedTarget === resolvedAllowed;
  });

  if (!isAllowed && resolvedTarget !== resolvedRoot) {
    return { valid: false, error: 'Path not in allowed directories' };
  }

  return { valid: true, path: resolvedTarget };
}

module.exports = {
  normalizePathForFs,
  isWithinDirectory,
  validatePath,
};
