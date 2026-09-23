const { pipeline } = require('stream/promises');

class TransferConflictError extends Error {
  constructor(destinationPath, message = `Destination already exists: ${destinationPath}`) {
    super(message);
    this.name = 'TransferConflictError';
    this.code = 'EEXIST';
    this.statusCode = 409;
    this.destinationPath = destinationPath;
  }
}

class TransferService {
  async copy({ sourceProvider, sourcePath, destinationProvider, destinationPath, options = {} }) {
    const context = {
      overwrite: options.overwrite === true,
      signal: options.signal,
      onProgress: options.onProgress,
      result: {
        filesCopied: 0,
        directoriesCreated: 0,
        bytesCopied: 0,
      },
    };

    await this.initializeProvider(sourceProvider);
    await this.initializeProvider(destinationProvider);
    await this.validateSameProviderPaths(sourceProvider, sourcePath, destinationProvider, destinationPath);
    const sourceEntry = await sourceProvider.stat(sourcePath);
    const destinationEntry = await this.tryStat(destinationProvider, destinationPath);

    this.validateDestinationRoot(sourceEntry, destinationEntry, destinationPath, context.overwrite);

    if (sourceEntry.type === 'folder') {
      await this.copyDirectory(sourceProvider, sourcePath, destinationProvider, destinationPath, context, true, destinationEntry);
    } else {
      await this.copyFile(sourceProvider, sourcePath, sourceEntry, destinationProvider, destinationPath, context);
    }

    return context.result;
  }

  async move({ sourceProvider, sourcePath, destinationProvider, destinationPath, options = {} }) {
    await this.initializeProvider(sourceProvider);
    const sourceEntry = await sourceProvider.stat(sourcePath);
    const result = await this.copy({
      sourceProvider,
      sourcePath,
      destinationProvider,
      destinationPath,
      options,
    });

    await sourceProvider.delete(sourcePath, { recursive: sourceEntry.type === 'folder' });
    return result;
  }

  async copyDirectory(sourceProvider, sourcePath, destinationProvider, destinationPath, context, isRoot = false, knownDestinationEntry = undefined) {
    const destinationEntry = knownDestinationEntry === undefined
      ? await this.tryStat(destinationProvider, destinationPath)
      : knownDestinationEntry;

    if (destinationEntry) {
      if (destinationEntry.type !== 'folder') {
        throw new TransferConflictError(destinationPath);
      }
      if (!isRoot && !context.overwrite) {
        throw new TransferConflictError(destinationPath);
      }
    } else {
      await destinationProvider.mkdir(destinationPath);
      context.result.directoriesCreated += 1;
    }

    const entries = await sourceProvider.list(sourcePath);
    for (const entry of entries) {
      const sourceChildPath = entry.path || sourceProvider.joinPath(sourcePath, entry.name);
      const destinationChildPath = destinationProvider.joinPath(destinationPath, entry.name);

      if (entry.type === 'folder') {
        await this.copyDirectory(
          sourceProvider,
          sourceChildPath,
          destinationProvider,
          destinationChildPath,
          context,
          false,
        );
      } else {
        await this.copyFile(
          sourceProvider,
          sourceChildPath,
          entry,
          destinationProvider,
          destinationChildPath,
          context,
        );
      }
    }
  }

  async copyFile(sourceProvider, sourcePath, sourceEntry, destinationProvider, destinationPath, context) {
    const destinationEntry = await this.tryStat(destinationProvider, destinationPath);

    if (destinationEntry) {
      if (!context.overwrite || destinationEntry.type === 'folder') {
        throw new TransferConflictError(destinationPath);
      }
    }

    const sourceStream = sourceProvider.createReadStream(sourcePath);
    const destinationStream = destinationProvider.createWriteStream(destinationPath);
    let bytesTransferred = 0;

    sourceStream.on('data', chunk => {
      bytesTransferred += chunk.length;
      context.result.bytesCopied += chunk.length;
      if (context.onProgress) {
        context.onProgress({
          sourcePath,
          destinationPath,
          bytesTransferred,
          totalBytes: sourceEntry.size,
        });
      }
    });

    await pipeline(sourceStream, destinationStream, { signal: context.signal });
    context.result.filesCopied += 1;
  }

  async initializeProvider(provider) {
    if (typeof provider.initialize === 'function') {
      await provider.initialize();
      return;
    }

    if (typeof provider.ready === 'function') {
      await provider.ready();
    }
  }

  async validateSameProviderPaths(sourceProvider, sourcePath, destinationProvider, destinationPath) {
    if (!this.sameFilesystem(sourceProvider, destinationProvider)) {
      return;
    }

    if (typeof sourceProvider.normalizePath !== 'function'
      || typeof sourceProvider.isSamePath !== 'function'
      || typeof sourceProvider.isDescendantPath !== 'function') {
      throw new Error('Provider does not support safe same-provider path comparison');
    }

    const normalizedSource = sourceProvider.normalizePath(sourcePath);
    const normalizedDestination = sourceProvider.normalizePath(destinationPath);

    if (sourceProvider.isSamePath(normalizedSource, normalizedDestination)) {
      throw new TransferConflictError(
        destinationPath,
        `Source and destination are the same path: ${destinationPath}`,
      );
    }

    const sourceEntry = await sourceProvider.stat(sourcePath);
    if (sourceEntry.type === 'folder' && sourceProvider.isDescendantPath(normalizedSource, normalizedDestination)) {
      throw new TransferConflictError(
        destinationPath,
        `Destination is inside the source directory: ${destinationPath}`,
      );
    }
  }

  sameFilesystem(sourceProvider, destinationProvider) {
    const sourceId = sourceProvider.getFilesystemId();
    const destinationId = destinationProvider.getFilesystemId();
    return sourceId === destinationId;
  }

  validateDestinationRoot(sourceEntry, destinationEntry, destinationPath, overwrite) {
    if (!destinationEntry) {
      return;
    }

    if (!overwrite) {
      throw new TransferConflictError(destinationPath);
    }

    if (sourceEntry.type !== destinationEntry.type) {
      throw new TransferConflictError(
        destinationPath,
        `Cannot replace ${destinationEntry.type} with ${sourceEntry.type}: ${destinationPath}`,
      );
    }
  }

  async tryStat(provider, targetPath) {
    try {
      return await provider.stat(targetPath);
    } catch (error) {
      if (this.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  isNotFound(error) {
    return error && (
      error.code === 'ENOENT' ||
      error.code === 'SSH_FX_NO_SUCH_FILE' ||
      error.statusCode === 404
    );
  }
}

module.exports = TransferService;
module.exports.TransferConflictError = TransferConflictError;
