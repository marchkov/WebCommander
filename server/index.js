const express = require('express');
const http = require('http');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const requestSecurity = require('./requestSecurity');
const registerUploadRoutes = require('./uploadRoutes');
const { validateFilename, createExclusiveFile } = require('./fileSecurity');
const mime = require('mime-types');
const archiver = require('archiver');
const SSHManager = require('./sshManager');
const { validatePath } = require('./pathUtils');
const LocalProvider = require('./providers/localProvider');
const SftpProvider = require('./providers/sftpProvider');
const TransferService = require('./services/transferService');
const ArchiveService = require('./services/archiveService');
const TerminalService = require('./services/terminalService');
const attachTerminalWebSocket = require('./terminalWebSocket');
const { resolveAuthConfig, validateSecurityConfig, sessionSettings } = require('./configSecurity');
const { registerAuthRoutes } = require('./authRoutes');

const rawConfig = (() => {
  try {
    return require(path.join(__dirname, '..', 'config.json'));
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') return {};
    throw new Error('Failed to load config.json');
  }
})();

const parseEnvList = (value, fallback = []) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (Array.isArray(value)) {
    return value;
  }

  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
};

const parseEnvInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const defaultRootPath = process.env.WC_ROOT_PATH || rawConfig.rootPath || path.resolve(__dirname, '..');
const config = {
  host: process.env.WC_HOST || rawConfig.host,
  port: parseEnvInt(process.env.WC_PORT, rawConfig.port || 3001),
  rootPath: process.env.WC_ROOT_PATH || rawConfig.rootPath || defaultRootPath,
  auth: resolveAuthConfig(rawConfig),
  security: {
    allowedPaths: parseEnvList(process.env.WC_ALLOWED_PATHS, rawConfig.security?.allowedPaths || [defaultRootPath]),
    blockedPaths: parseEnvList(process.env.WC_BLOCKED_PATHS, rawConfig.security?.blockedPaths || []),
    maxFileSize: Number(process.env.WC_MAX_FILE_SIZE ?? rawConfig.security?.maxFileSize ?? 104857600),
    allowedExtensions: parseEnvList(process.env.WC_ALLOWED_EXTENSIONS, rawConfig.security?.allowedExtensions || ['*'])
  }
};

for (const warning of validateSecurityConfig(config)) console.warn(`[security] ${warning}`);
console.log('[security]', JSON.stringify({ authEnabled: config.auth.enabled, cookieSecure: config.auth.cookieSecure,
  trustProxyConfigured: config.auth.trustProxy !== false, sessionStore: 'MemoryStore', users: config.auth.users.length,
  cors: config.auth.corsOrigins.length ? `approved origins: ${config.auth.corsOrigins.length}` : 'same-origin' }));

const app = express();
if (config.auth.trustProxy !== false) app.set('trust proxy', config.auth.trustProxy);
const PORT = config.port;
const localProvider = new LocalProvider({
  rootPath: config.rootPath,
  allowedPaths: config.security.allowedPaths,
  blockedPaths: config.security.blockedPaths,
});
const transferService = new TransferService();
const archiveService = new ArchiveService();
const createSftpProvider = sessionId => new SftpProvider({
  sessionId,
  sshManager: SSHManager,
});
const initializeSftpProvider = async (sessionId, req) => {
  SSHManager.getConnection(sessionId, config.auth.enabled ? req.sessionID : undefined);
  const provider = createSftpProvider(sessionId);
  await provider.initialize();
  return provider;
};
const createProviderFromDescriptor = async (descriptor, req) => {
  if (!descriptor || !descriptor.provider || !descriptor.path) {
    throw new Error('provider and path are required');
  }

  const provider = await createProvider(descriptor.provider, descriptor.sessionId, req);
  return { provider, path: await provider.resolvePath(descriptor.path) };
};
const createProvider = async (providerType, sessionId, req) => {
  if (providerType === 'local') return localProvider;
  if (providerType === 'sftp') return initializeSftpProvider(sessionId, req);
  throw new Error(`Unsupported provider: ${providerType}`);
};

// Middleware
if (config.auth.corsOrigins.length) {
  app.use(cors({
    origin: (origin, callback) => callback(null, config.auth.corsOrigins.includes(origin)),
    credentials: true,
  }));
}

// One session middleware instance serves HTTP and terminal WebSocket upgrades.
const { cookieOptions, options: sessionOptions } = sessionSettings(config.auth);
const sessionMiddleware = session(sessionOptions);
app.use(sessionMiddleware);
app.use('/api', requestSecurity({ authEnabled: config.auth.enabled, corsOrigins: config.auth.corsOrigins }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Auth middleware
const requireAuth = (req, res, next) => {
  if (!config.auth.enabled) {
    return next();
  }
  
  if (!req.session || !req.session.authenticated) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
};

// Security: Validate path
const validateServerPath = (targetPath) => {
  return validatePath(targetPath, {
    rootPath: config.rootPath,
    allowedPaths: config.security.allowedPaths,
    blockedPaths: config.security.blockedPaths,
  });
};

// ============ AUTH ROUTES ============

registerAuthRoutes(app, { auth: config.auth, sshManager: SSHManager, cookieOptions });

// ============ FILE OPERATIONS ============

// List directory
app.get('/api/files', requireAuth, async (req, res) => {
  const dirPath = req.query.path || config.rootPath;

  try {
    const files = await localProvider.list(dirPath);
    
    res.json({
      path: localProvider.resolvePath(dirPath),
      files: files
    });
  } catch (error) {
    if (error.statusCode === 403) {
      return res.status(403).json({ error: error.message });
    }
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Directory not found' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Read file content
app.get('/api/files/read', requireAuth, async (req, res) => {
  const filePath = req.query.path;

  try {
    const info = await localProvider.stat(filePath);
    if (info.type === 'folder') {
      return res.status(400).json({ error: 'Cannot read directory' });
    }

    const content = await localProvider.read(filePath);
    res.json({ content, path: info.path });
  } catch (error) {
    if (error.statusCode === 403) {
      return res.status(403).json({ error: error.message });
    }
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Write file content
app.post('/api/files/write', requireAuth, async (req, res) => {
  const { path: filePath, content } = req.body;

  try {
    await localProvider.write(filePath, content);
    res.json({ success: true, path: localProvider.resolvePath(filePath) });
  } catch (error) {
    if (error.statusCode === 403) {
      return res.status(403).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

// Create directory
app.post('/api/files/mkdir', requireAuth, async (req, res) => {
  const { path: dirPath, name } = req.body;
  const fullPath = path.join(dirPath, name);

  try {
    await localProvider.mkdir(fullPath);
    res.json({ success: true, path: localProvider.resolvePath(fullPath) });
  } catch (error) {
    if (error.statusCode === 403) {
      return res.status(403).json({ error: error.message });
    }
    if (error.code === 'EEXIST') {
      return res.status(400).json({ error: 'Directory already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Delete file or directory
app.post('/api/files/delete', requireAuth, async (req, res) => {
  const { path: targetPath } = req.body;

  try {
    await localProvider.delete(targetPath, { recursive: true, force: true });
    res.json({ success: true });
  } catch (error) {
    if (error.statusCode === 403) {
      return res.status(403).json({ error: error.message });
    }
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Path not found' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Copy file or directory
app.post('/api/files/copy', requireAuth, async (req, res) => {
  const { source, destination } = req.body;

  const srcValidation = validateServerPath(source);
  const destValidation = validateServerPath(destination);

  if (!srcValidation.valid || !destValidation.valid) {
    return res.status(403).json({ error: 'Invalid path' });
  }

  try {
    await transferService.copy({
      sourceProvider: localProvider,
      sourcePath: srcValidation.path,
      destinationProvider: localProvider,
      destinationPath: destValidation.path,
    });
    res.json({ success: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Source not found' });
    }
    if (error.statusCode === 409) {
      return res.status(409).json({ error: error.message, conflictType: error.conflictType });
    }
    res.status(500).json({ error: error.message });
  }
});

// Move file or directory
app.post('/api/files/move', requireAuth, async (req, res) => {
  const { source, destination } = req.body;

  const srcValidation = validateServerPath(source);
  const destValidation = validateServerPath(destination);

  if (!srcValidation.valid || !destValidation.valid) {
    return res.status(403).json({ error: 'Invalid path' });
  }

  try {
    await transferService.move({
      sourceProvider: localProvider,
      sourcePath: srcValidation.path,
      destinationProvider: localProvider,
      destinationPath: destValidation.path,
    });
    res.json({ success: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Source not found' });
    }
    if (error.statusCode === 409) {
      return res.status(409).json({ error: error.message, conflictType: error.conflictType });
    }
    res.status(500).json({ error: error.message });
  }
});

// Generic provider-to-provider transfer
app.post('/api/transfers', requireAuth, async (req, res) => {
  const { operation, source, destination, overwrite = false } = req.body;

  if (operation !== 'copy' && operation !== 'move') {
    return res.status(400).json({ error: 'operation must be copy or move' });
  }

  try {
    const sourceDescriptor = await createProviderFromDescriptor(source, req);
    const destinationDescriptor = await createProviderFromDescriptor(destination, req);
    const transfer = {
      sourceProvider: sourceDescriptor.provider,
      sourcePath: sourceDescriptor.path,
      destinationProvider: destinationDescriptor.provider,
      destinationPath: destinationDescriptor.path,
      options: { overwrite: overwrite === true },
    };
    const result = operation === 'move'
      ? await transferService.move(transfer)
      : await transferService.copy(transfer);

    res.json({ success: true, ...result });
  } catch (error) {
    if (error.statusCode === 403) {
      return res.status(403).json({ error: error.message });
    }
    if (error.statusCode === 409) {
      return res.status(409).json({ error: error.message, conflictType: error.conflictType });
    }
    if (error.code === 'ENOENT' || error.code === 'SSH_FX_NO_SUCH_FILE') {
      return res.status(404).json({ error: 'Source or destination path not found' });
    }
    if (error.message === 'provider and path are required' || error.message.startsWith('Unsupported provider:')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(error.status || 500).json({ error: error.message, code: error.code });
  }
});

// Create a ZIP archive
app.post('/api/archives/create', requireAuth, async (req, res) => {
  const { provider: providerType, sessionId, sources, destination } = req.body;

  if (!['local', 'sftp'].includes(providerType) || !Array.isArray(sources) || sources.length === 0 ||
      sources.some(source => typeof source !== 'string' || !source.trim()) ||
      typeof destination !== 'string' || !destination.trim() ||
      (providerType === 'sftp' && (typeof sessionId !== 'string' || !sessionId.trim()))) {
    return res.status(400).json({ error: 'provider, sources and destination are required' });
  }

  try {
    const provider = await createProvider(providerType, sessionId, req);
    const result = await archiveService.createZip({
      provider,
      sourcePaths: sources,
      destinationPath: destination,
    });
    res.json(result);
  } catch (error) {
    if (error.statusCode === 409) {
      return res.status(409).json({ error: error.message });
    }
    if (error.statusCode === 400 || error.statusCode === 403) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(error.status || 500).json({ error: error.message, code: error.code });
  }
});

// Extract a ZIP archive
app.post('/api/archives/extract', requireAuth, async (req, res) => {
  const { provider: providerType, sessionId, archive, destination, overwrite = false } = req.body;

  if (!['local', 'sftp'].includes(providerType) || typeof archive !== 'string' || !archive.trim() ||
      typeof destination !== 'string' || !destination.trim() || typeof overwrite !== 'boolean' ||
      (providerType === 'sftp' && (typeof sessionId !== 'string' || !sessionId.trim()))) {
    return res.status(400).json({ error: 'provider, archive and destination are required' });
  }

  try {
    const provider = await createProvider(providerType, sessionId, req);
    const result = await archiveService.extractZip({
      provider,
      archivePath: archive,
      destinationPath: destination,
      overwrite: overwrite === true,
    });
    res.json(result);
  } catch (error) {
    if (error.statusCode === 409) {
      return res.status(409).json({ error: error.message });
    }
    if (error.statusCode === 400 || error.statusCode === 403) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(error.status || 500).json({ error: error.message, code: error.code });
  }
});

// Create an empty file using the same policy as uploads.
app.post('/api/files/create', requireAuth, async (req, res) => {
  const { provider: providerType, sessionId, directory, name } = req.body;
  if (!['local', 'sftp'].includes(providerType) || typeof directory !== 'string' || !directory.trim() ||
      (providerType === 'sftp' && (typeof sessionId !== 'string' || !sessionId.trim()))) {
    return res.status(400).json({ error: 'provider, directory and name are required' });
  }
  try {
    const provider = await createProvider(providerType, sessionId, req);
    const destination = await createExclusiveFile({ provider, directory, name, data: '',
      allowedExtensions: config.security.allowedExtensions });
    res.json({ success: true, path: destination });
  } catch (error) {
    res.status(error.statusCode || error.status || 500).json({ error: error.message, code: error.code });
  }
});

// Rename file or directory
app.post('/api/files/rename', requireAuth, async (req, res) => {
  const { path: targetPath, newName } = req.body;

  try {
    validateFilename(newName);
    const currentPath = localProvider.resolvePath(targetPath);
    const dir = path.dirname(currentPath);
    const newPath = path.join(dir, newName);

    try {
      await localProvider.rename(currentPath, newPath);
    } catch (error) {
      if (error.statusCode === 403) {
        return res.status(403).json({ error: 'Invalid new path' });
      }
      throw error;
    }

    res.json({ success: true, newPath: localProvider.resolvePath(newPath) });
  } catch (error) {
    if (error.status === 409) {
      return res.status(409).json({ error: error.message, code: error.code });
    }
    if (error.statusCode === 403) {
      return res.status(403).json({ error: error.message });
    }
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Path not found' });
    }
    res.status(error.status || 500).json({ error: error.message, code: error.code });
  }
});

registerUploadRoutes(app, { requireAuth, createProvider, security: config.security, rootPath: config.rootPath });

// Download file
app.get('/api/files/download', requireAuth, async (req, res) => {
  const filePath = req.query.path;

  try {
    const info = await localProvider.stat(filePath);

    if (info.type === 'folder') {
      // Create zip archive for directory
      res.setHeader('Content-Type', 'application/zip');
      res.attachment(path.basename(info.path) + '.zip');
      
      const archive = new archiver.ZipArchive({ zlib: { level: 9 } });
      archive.pipe(res);
      archive.directory(info.path, false);
      archive.finalize();
    } else {
      const mimeType = mime.lookup(info.path) || 'application/octet-stream';
      res.setHeader('Content-Type', mimeType);
      res.attachment(path.basename(info.path));
      localProvider.createReadStream(info.path).pipe(res);
    }
  } catch (error) {
    if (error.statusCode === 403) {
      return res.status(403).json({ error: error.message });
    }
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Get file info
app.get('/api/files/info', requireAuth, async (req, res) => {
  const filePath = req.query.path;

  try {
    const info = await localProvider.stat(filePath);
    res.json({
      path: info.path,
      name: info.name,
      type: info.type,
      size: info.size,
      created: info.created,
      modified: info.modified,
      accessed: info.accessed,
      permissions: info.permissions,
      uid: info.uid,
      gid: info.gid,
    });
  } catch (error) {
    if (error.statusCode === 403) {
      return res.status(403).json({ error: error.message });
    }
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Path not found' });
    }
    res.status(500).json({ error: error.message });
  }
});

// ============ SSH ROUTES ============

// Подключение к SSH
app.post('/api/ssh/connect', requireAuth, async (req, res) => {
  const { sessionId, host, port, username, password, privateKey, passphrase } = req.body;
  
  if (!sessionId || !host || !username) {
    return res.status(400).json({ error: 'sessionId, host and username are required' });
  }
  
  try {
    const result = await SSHManager.connect(sessionId, {
      host,
      port: port || 22,
      username,
      password,
      privateKey,
      passphrase,
    }, req.sessionID);
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, code: error.code });
  }
});

// Отключение от SSH
app.post('/api/ssh/disconnect', requireAuth, (req, res) => {
  const { sessionId } = req.body;
  
  try {
    SSHManager.disconnect(sessionId, config.auth.enabled ? req.sessionID : undefined);
    res.json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, code: error.code });
  }
});

// Список активных сессий
app.get('/api/ssh/sessions', requireAuth, (req, res) => {
  res.json(SSHManager.getActiveSessions(config.auth.enabled ? req.sessionID : undefined));
});

// Листинг директории через SSH
app.get('/api/ssh/files', requireAuth, async (req, res) => {
  const { sessionId, path: dirPath } = req.query;

  try {
    const provider = await initializeSftpProvider(sessionId, req);
    const remotePath = await provider.resolvePath(dirPath || '~');
    const files = await provider.list(remotePath);
    res.json({ path: remotePath, files });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, code: error.code });
  }
});

// Чтение файла через SSH
app.get('/api/ssh/files/read', requireAuth, async (req, res) => {
  const { sessionId, path: filePath } = req.query;

  try {
    const content = await (await initializeSftpProvider(sessionId, req)).read(filePath);
    res.json({ content, path: filePath });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, code: error.code });
  }
});

// Запись файла через SSH
app.post('/api/ssh/files/write', requireAuth, async (req, res) => {
  const { sessionId, path: filePath, content } = req.body;

  try {
    await (await initializeSftpProvider(sessionId, req)).write(filePath, content);
    res.json({ success: true, path: filePath });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, code: error.code });
  }
});

// Создание директории через SSH
app.post('/api/ssh/files/mkdir', requireAuth, async (req, res) => {
  const { sessionId, path: dirPath } = req.body;

  try {
    await (await initializeSftpProvider(sessionId, req)).mkdir(dirPath);
    res.json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, code: error.code });
  }
});

// Удаление через SSH
app.post('/api/ssh/files/delete', requireAuth, async (req, res) => {
  const { sessionId, path: targetPath, isDirectory } = req.body;

  try {
    await (await initializeSftpProvider(sessionId, req)).delete(targetPath, {
      recursive: Boolean(isDirectory),
      force: true,
    });
    res.json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, code: error.code });
  }
});

// Переименование через SSH
app.post('/api/ssh/files/rename', requireAuth, async (req, res) => {
  const { sessionId, path: oldPath, newPath } = req.body;

  try {
    const provider = await initializeSftpProvider(sessionId, req);
    validateFilename(typeof newPath === 'string' ? path.posix.basename(newPath) : newPath);
    if (newPath.includes('\\') || newPath.split('/').some(part => part === '..' || part === '.')) {
      return res.status(400).json({ error: 'Invalid rename path', code: 'INVALID_FILENAME' });
    }
    await provider.rename(oldPath, newPath);
    res.json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, code: error.code });
  }
});

// Скачивание файла через SSH
app.get('/api/ssh/files/download', requireAuth, async (req, res) => {
  const { sessionId, path: filePath } = req.query;

  try {
    const provider = await initializeSftpProvider(sessionId, req);
    const info = await provider.stat(filePath);
    const fileName = path.posix.basename(info.path);
    const mimeType = mime.lookup(info.path) || 'application/octet-stream';
    
    res.setHeader('Content-Type', mimeType);
    res.attachment(fileName);
    res.setHeader('Content-Length', info.size);
    provider.createReadStream(info.path).pipe(res);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, code: error.code });
  }
});



// Информация о файле через SSH
app.get('/api/ssh/files/info', requireAuth, async (req, res) => {
  const { sessionId, path: filePath } = req.query;

  try {
    const info = await (await initializeSftpProvider(sessionId, req)).stat(filePath);
    res.json(info);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, code: error.code });
  }
});





// Serve static files in production
if (process.env.NODE_ENV === 'production' || process.env.WC_SERVE_STATIC === 'true') {
  app.use(express.static(path.join(__dirname, '../dist')));
  
  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

// Start server
const server = http.createServer(app);
const terminalService = new TerminalService({ localProvider, sshManager: SSHManager, authEnabled: config.auth.enabled });
const terminals = attachTerminalWebSocket({ server, sessionMiddleware, terminalService, authEnabled: config.auth.enabled });
// Synchronous PTY cleanup also runs for normal Node process termination.
process.once('exit', () => terminalService.close());
const shutdown = () => {
  terminals.close();
  SSHManager.disconnectAll();
  server.close();
  const deadline = setTimeout(() => process.exit(0), 5000);
  deadline.unref();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
server.listen({ port: PORT, ...(config.host ? { host: config.host } : {}) }, () => {
  console.log(`WebCommander server running on port ${PORT}`);
  console.log(`Root path: ${config.rootPath}`);
  console.log(`Auth enabled: ${config.auth.enabled}`);
});
