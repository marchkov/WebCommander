type PathMode = 'local' | 'ssh';

function normalize(value: string, mode: PathMode) {
  // Backslash is a separator locally, but a valid filename character on SSH.
  return mode === 'ssh' ? value : value.replace(/\\/g, '/');
}

export function getParentPath(value: string, mode: PathMode = 'local'): string {
  const normalized = normalize(value, mode).replace(/\/+$/, '');
  if (!normalized) return '/';
  if (mode === 'local' && /^[A-Za-z]:$/.test(normalized)) return `${normalized}/`;
  // Preserve UNC share roots, as well as POSIX and drive roots.
  if (mode === 'local' && /^\/\/[^/]+\/[^/]+$/.test(normalized)) return normalized;
  const separator = normalized.lastIndexOf('/');
  if (separator <= 0) return normalized.startsWith('/') ? '/' : '.';
  const parent = normalized.slice(0, separator);
  return mode === 'local' && /^[A-Za-z]:$/.test(parent) ? `${parent}/` : parent;
}

export function isRootPath(value: string, mode: PathMode = 'local') {
  const normalized = normalize(value, mode).replace(/\/+$/, '') || '/';
  const parent = getParentPath(value, mode).replace(/\/+$/, '') || '/';
  return normalized === parent;
}

export function joinPath(base: string, name: string, mode: PathMode = 'local') {
  const root = normalize(base, mode).replace(/\/+$/, '');
  const child = normalize(name, mode).replace(/^\/+/, '');
  if (!child) return root && !/^[A-Za-z]:$/.test(root) ? root : `${root}/`;
  return `${root}/${child}`;
}
