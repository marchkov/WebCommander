const archiver = require('archiver');
const { pipeline } = require('stream/promises');
const { once } = require('events');
const unzipper = require('unzipper');

class ArchiveConflictError extends Error {
  constructor(targetPath, message = `Destination already exists: ${targetPath}`) {
    super(message);
    this.code = 'EEXIST';
    this.statusCode = 409;
  }
}

class ArchiveSecurityError extends Error {
  constructor(message) {
    super(message);
    this.code = 'ZIP_SLIP';
    this.statusCode = 400;
  }
}

class ArchiveService {
  async createZip({ provider, sourcePaths, destinationPath }) {
    await this.initializeProvider(provider);
    if (!Array.isArray(sourcePaths) || !sourcePaths.length) {
      throw new ArchiveSecurityError('Select at least one source');
    }
    if (await this.tryStat(provider, destinationPath)) {
      throw new ArchiveConflictError(destinationPath);
    }
    // Preflight metadata before opening output: prevent self-inclusion,
    // link cycles, and ambiguous duplicate names without buffering file data.
    const destinationParent = await provider.realpath(provider.joinPath(destinationPath, '..'));
    const entries = [];
    const names = new Set();
    for (const sourcePath of sourcePaths) {
      const info = await provider.stat(sourcePath);
      const realSource = await provider.realpath(sourcePath);
      if (info.type === 'folder' && this.contains(provider, realSource, destinationParent)) {
        throw new ArchiveSecurityError('Archive destination must be outside selected directories');
      }
      await this.collectEntries(provider, sourcePath, info.name, entries, names, new Set());
    }
    const archive = new archiver.ZipArchive({ zlib: { level: 9 } });
    const output = provider.createWriteStream(destinationPath);
    const completion = pipeline(archive, output);
    completion.catch(() => {}); // Observe failures while appending entries.
    let input;
    try {
      for (const entry of entries) {
        const appended = once(archive, 'entry');
        appended.catch(() => {});
        if (entry.directory) {
          archive.append(Buffer.alloc(0), { name: `${entry.name}/` });
        } else {
          input = provider.createReadStream(entry.path);
          input.once('error', error => archive.destroy(error));
          archive.append(input, { name: entry.name });
        }
        // Keep at most one source file open and honor stream backpressure.
        await Promise.race([appended, completion]);
        input = null;
      }
      await archive.finalize();
      await completion;
    } catch (error) {
      input?.destroy();
      archive.destroy();
      output.destroy();
      await completion.catch(() => {});
      await provider.delete(destinationPath).catch(() => {});
      throw error;
    }
    return { success: true, destinationPath };
  }

  async collectEntries(provider, sourcePath, name, entries, names, ancestors) {
    name = validateArchiveEntryName(name);
    if (names.has(name)) throw new ArchiveConflictError(name, `Duplicate archive entry: ${name}`);
    names.add(name);
    const info = await provider.stat(sourcePath);
    const realPath = await provider.realpath(sourcePath);
    if (ancestors.has(realPath)) throw new ArchiveSecurityError('Symbolic link cycle in selected directory');
    const directory = info.type === 'folder';
    entries.push({ path: sourcePath, name, directory });
    if (directory) {
      const nextAncestors = new Set([...ancestors, realPath]);
      for (const child of await provider.list(sourcePath)) {
        await this.collectEntries(provider, provider.joinPath(sourcePath, child.name),
          `${name}/${child.name}`, entries, names, nextAncestors);
      }
    }
  }

  async extractZip({ provider, archivePath, destinationPath, overwrite = false }) {
    await this.initializeProvider(provider);
    const archiveRealPath = await provider.realpath(archivePath);
    await this.ensureRoot(provider, destinationPath);
    const root = await provider.realpath(destinationPath);
    const createdDirectories = new Set();
    const parser = unzipper.Parse({ forceStream: true });
    const source = provider.createReadStream(archivePath);
    // unzipper emits close at writable finish before its readable side ends;
    // Node pipeline treats valid stored ZIPs as prematurely closed here.
    const completion = parser.promise();
    completion.catch(() => {});
    let activeEntry;
    parser.on('error', error => activeEntry?.destroy(error));
    source.on('error', error => parser.destroy(error));
    source.pipe(parser);
    let filesExtracted = 0;
    try {
      for await (const entry of parser) {
        activeEntry = entry;
        // Errors may arrive while awaiting provider metadata, before pipeline
        // has attached its own error listener.
        entry.on('error', () => {});
        const relativePath = validateArchiveEntryName(entry.path);
        const segments = relativePath.split('/');
        const directory = entry.type === 'Directory' || /[/\\]$/.test(entry.path);
        let current = destinationPath;
        for (let index = 0; index < segments.length; index += 1) {
          // Check canonical parent and target paths, including existing links.
          await this.assertContained(provider, root, current);
          current = provider.joinPath(current, segments[index]);
          const existing = await this.tryStat(provider, current);
          if (existing) await this.assertContained(provider, root, current);
          const last = index === segments.length - 1;
          if (!last || directory) {
            if (existing && (existing.type !== 'folder' ||
              (last && !overwrite && !createdDirectories.has(current)))) {
              throw new ArchiveConflictError(current);
            }
            if (!existing) {
              await provider.mkdir(current);
              createdDirectories.add(current);
            }
          } else {
            if (existing && (!overwrite || existing.type === 'folder')) {
              throw new ArchiveConflictError(current);
            }
            if (existing && provider.isSamePath(await provider.realpath(current), archiveRealPath)) {
              throw new ArchiveConflictError(current, 'Cannot overwrite the archive being extracted');
            }
            await pipeline(entry, provider.createWriteStream(current));
            filesExtracted += 1;
          }
        }
        if (directory) await entry.autodrain().promise();
        activeEntry = null;
      }
      await completion;
    } finally {
      activeEntry?.destroy();
      parser.destroy();
      source.destroy();
    }
    return { success: true, filesExtracted, directoriesCreated: createdDirectories.size };
  }

  contains(provider, root, target) {
    return provider.isSamePath(root, target) || provider.isDescendantPath(root, target);
  }

  async assertContained(provider, root, target) {
    if (!this.contains(provider, root, await provider.realpath(target))) {
      throw new ArchiveSecurityError('Archive entry escapes the extraction directory');
    }
  }

  async ensureRoot(provider, target) {
    const existing = await this.tryStat(provider, target);
    if (existing) {
      if (existing.type !== 'folder') throw new ArchiveConflictError(target);
      return;
    }
    const parent = provider.joinPath(target, '..');
    if (provider.isSamePath(parent, target)) throw new ArchiveSecurityError('Invalid extraction directory');
    await this.ensureRoot(provider, parent);
    await provider.mkdir(target);
  }

  async initializeProvider(provider) {
    if (typeof provider.initialize === 'function') await provider.initialize();
  }

  async tryStat(provider, target) {
    try {
      return await provider.lstat(target);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'SSH_FX_NO_SUCH_FILE' || error.code === 2) return null;
      throw error;
    }
  }
}

function validateArchiveEntryName(entryName) {
  const normalized = String(entryName || '').replace(/\\/g, '/');
  const parts = normalized.replace(/\/$/, '').split('/');
  // Also reject drive-relative paths, ADS and Windows trailing-dot aliases.
  if (!normalized || normalized.startsWith('/') || /[:\0]/.test(normalized) ||
      parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) {
    throw new ArchiveSecurityError(`Unsafe archive entry: ${entryName}`);
  }
  return parts.join('/');
}

module.exports = ArchiveService;
module.exports.ArchiveConflictError = ArchiveConflictError;
module.exports.ArchiveSecurityError = ArchiveSecurityError;
module.exports.validateArchiveEntryName = validateArchiveEntryName;
