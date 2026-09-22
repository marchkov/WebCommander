const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const mime = require('mime-types');
const archiver = require('archiver');
const SSHManager = require('./sshManager');
const config = require('../config.json');

const app = express();
const PORT = config.port || 3001;

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware
app.use(session({
  secret: config.auth.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    httpOnly: true,
    maxAge: config.auth.sessionMaxAge
  }
}));

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
const validatePath = (targetPath) => {
  const resolvedPath = path.resolve(targetPath);
  
  // Check if path is within allowed paths
  const isAllowed = config.security.allowedPaths.some(allowedPath => {
    const resolvedAllowed = path.resolve(allowedPath);
    return resolvedPath.startsWith(resolvedAllowed);
  });
  
  if (!isAllowed) {
    return { valid: false, error: 'Path not in allowed directories' };
  }
  
  // Check if path is blocked
  const isBlocked = config.security.blockedPaths.some(blockedPath => {
    const resolvedBlocked = path.resolve(blockedPath);
    return resolvedPath.startsWith(resolvedBlocked);
  });
  
  if (isBlocked) {
    return { valid: false, error: 'Path is blocked' };
  }
  
  return { valid: true, path: resolvedPath };
};

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const destPath = req.body.path || config.rootPath;
    const validation = validatePath(destPath);
    
    if (!validation.valid) {
      return cb(new Error(validation.error));
    }
    
    if (!fs.existsSync(validation.path)) {
      fs.mkdirSync(validation.path, { recursive: true });
    }
    
    cb(null, validation.path);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: config.security.maxFileSize
  }
});

// ============ AUTH ROUTES ============

app.post('/api/auth/login', (req, res) => {
  if (!config.auth.enabled) {
    req.session.authenticated = true;
    req.session.username = 'anonymous';
    return res.json({ success: true, username: 'anonymous' });
  }
  
  const { username, password } = req.body;
  
  const user = config.auth.users.find(
    u => u.username === username && u.password === password
  );
  
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  req.session.authenticated = true;
  req.session.username = user.username;
  
  res.json({ success: true, username: user.username });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/check', (req, res) => {
  if (!config.auth.enabled) {
    return res.json({ authenticated: true, username: 'anonymous' });
  }
  
  res.json({
    authenticated: req.session && req.session.authenticated,
    username: req.session ? req.session.username : null
  });
});

// ============ FILE OPERATIONS ============

// List directory
app.get('/api/files', requireAuth, (req, res) => {
  const dirPath = req.query.path || config.rootPath;
  const validation = validatePath(dirPath);
  
  if (!validation.valid) {
    return res.status(403).json({ error: validation.error });
  }
  
  try {
    if (!fs.existsSync(validation.path)) {
      return res.status(404).json({ error: 'Directory not found' });
    }
    
    const entries = fs.readdirSync(validation.path, { withFileTypes: true });
    const files = entries.map(entry => {
      const fullPath = path.join(validation.path, entry.name);
      const stats = fs.statSync(fullPath);
      
      return {
        id: fullPath,
        name: entry.name,
        type: entry.isDirectory() ? 'folder' : 'file',
        size: stats.size,
        modified: stats.mtime,
        extension: entry.isFile() ? path.extname(entry.name).slice(1) : undefined,
        parentId: validation.path
      };
    });
    
    res.json({
      path: validation.path,
      files: files
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Read file content
app.get('/api/files/read', requireAuth, (req, res) => {
  const filePath = req.query.path;
  const validation = validatePath(filePath);
  
  if (!validation.valid) {
    return res.status(403).json({ error: validation.error });
  }
  
  try {
    if (!fs.existsSync(validation.path)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const stats = fs.statSync(validation.path);
    
    if (stats.isDirectory()) {
      return res.status(400).json({ error: 'Cannot read directory' });
    }
    
    const content = fs.readFileSync(validation.path, 'utf-8');
    res.json({ content, path: validation.path });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Write file content
app.post('/api/files/write', requireAuth, (req, res) => {
  const { path: filePath, content } = req.body;
  const validation = validatePath(filePath);
  
  if (!validation.valid) {
    return res.status(403).json({ error: validation.error });
  }
  
  try {
    const dir = path.dirname(validation.path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(validation.path, content, 'utf-8');
    res.json({ success: true, path: validation.path });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create directory
app.post('/api/files/mkdir', requireAuth, (req, res) => {
  const { path: dirPath, name } = req.body;
  const fullPath = path.join(dirPath, name);
  const validation = validatePath(fullPath);
  
  if (!validation.valid) {
    return res.status(403).json({ error: validation.error });
  }
  
  try {
    if (fs.existsSync(validation.path)) {
      return res.status(400).json({ error: 'Directory already exists' });
    }
    
    fs.mkdirSync(validation.path, { recursive: true });
    res.json({ success: true, path: validation.path });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete file or directory
app.post('/api/files/delete', requireAuth, (req, res) => {
  const { path: targetPath } = req.body;
  const validation = validatePath(targetPath);
  
  if (!validation.valid) {
    return res.status(403).json({ error: validation.error });
  }
  
  try {
    if (!fs.existsSync(validation.path)) {
      return res.status(404).json({ error: 'Path not found' });
    }
    
    const stats = fs.statSync(validation.path);
    
    if (stats.isDirectory()) {
      fs.rmSync(validation.path, { recursive: true, force: true });
    } else {
      fs.unlinkSync(validation.path);
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Copy file or directory
app.post('/api/files/copy', requireAuth, (req, res) => {
  const { source, destination } = req.body;
  
  const srcValidation = validatePath(source);
  const destValidation = validatePath(destination);
  
  if (!srcValidation.valid || !destValidation.valid) {
    return res.status(403).json({ error: 'Invalid path' });
  }
  
  try {
    if (!fs.existsSync(srcValidation.path)) {
      return res.status(404).json({ error: 'Source not found' });
    }
    
    const stats = fs.statSync(srcValidation.path);
    
    if (stats.isDirectory()) {
      fs.cpSync(srcValidation.path, destValidation.path, { recursive: true });
    } else {
      fs.copyFileSync(srcValidation.path, destValidation.path);
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Move file or directory
app.post('/api/files/move', requireAuth, (req, res) => {
  const { source, destination } = req.body;
  
  const srcValidation = validatePath(source);
  const destValidation = validatePath(destination);
  
  if (!srcValidation.valid || !destValidation.valid) {
    return res.status(403).json({ error: 'Invalid path' });
  }
  
  try {
    if (!fs.existsSync(srcValidation.path)) {
      return res.status(404).json({ error: 'Source not found' });
    }
    
    fs.renameSync(srcValidation.path, destValidation.path);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rename file or directory
app.post('/api/files/rename', requireAuth, (req, res) => {
  const { path: targetPath, newName } = req.body;
  const validation = validatePath(targetPath);
  
  if (!validation.valid) {
    return res.status(403).json({ error: validation.error });
  }
  
  try {
    if (!fs.existsSync(validation.path)) {
      return res.status(404).json({ error: 'Path not found' });
    }
    
    const dir = path.dirname(validation.path);
    const newPath = path.join(dir, newName);
    const newValidation = validatePath(newPath);
    
    if (!newValidation.valid) {
      return res.status(403).json({ error: 'Invalid new path' });
    }
    
    fs.renameSync(validation.path, newValidation.path);
    res.json({ success: true, newPath: newValidation.path });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload file
app.post('/api/files/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  res.json({
    success: true,
    filename: req.file.originalname,
    path: req.file.path,
    size: req.file.size
  });
});

// Download file
app.get('/api/files/download', requireAuth, (req, res) => {
  const filePath = req.query.path;
  const validation = validatePath(filePath);
  
  if (!validation.valid) {
    return res.status(403).json({ error: validation.error });
  }
  
  try {
    if (!fs.existsSync(validation.path)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const stats = fs.statSync(validation.path);
    
    if (stats.isDirectory()) {
      // Create zip archive for directory
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(validation.path)}.zip"`);
      
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.pipe(res);
      archive.directory(validation.path, false);
      archive.finalize();
    } else {
      const mimeType = mime.lookup(validation.path) || 'application/octet-stream';
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(validation.path)}"`);
      fs.createReadStream(validation.path).pipe(res);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get file info
app.get('/api/files/info', requireAuth, (req, res) => {
  const filePath = req.query.path;
  const validation = validatePath(filePath);
  
  if (!validation.valid) {
    return res.status(403).json({ error: validation.error });
  }
  
  try {
    if (!fs.existsSync(validation.path)) {
      return res.status(404).json({ error: 'Path not found' });
    }
    
    const stats = fs.statSync(validation.path);
    
    res.json({
      path: validation.path,
      name: path.basename(validation.path),
      type: stats.isDirectory() ? 'folder' : 'file',
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      accessed: stats.atime,
      permissions: stats.mode.toString(8).slice(-3)
    });
  } catch (error) {
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
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Отключение от SSH
app.post('/api/ssh/disconnect', requireAuth, (req, res) => {
  const { sessionId } = req.body;
  
  try {
    SSHManager.disconnect(sessionId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Список активных сессий
app.get('/api/ssh/sessions', requireAuth, (req, res) => {
  res.json(SSHManager.getActiveSessions());
});

// Листинг директории через SSH
app.get('/api/ssh/files', requireAuth, async (req, res) => {
  const { sessionId, path: dirPath } = req.query;
  
  try {
    const files = await SSHManager.listDir(sessionId, dirPath || '~');
    res.json({ path: dirPath || '~', files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Чтение файла через SSH
app.get('/api/ssh/files/read', requireAuth, async (req, res) => {
  const { sessionId, path: filePath } = req.query;
  
  try {
    const content = await SSHManager.readFile(sessionId, filePath);
    res.json({ content, path: filePath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Запись файла через SSH
app.post('/api/ssh/files/write', requireAuth, async (req, res) => {
  const { sessionId, path: filePath, content } = req.body;
  
  try {
    await SSHManager.writeFile(sessionId, filePath, content);
    res.json({ success: true, path: filePath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Создание директории через SSH
app.post('/api/ssh/files/mkdir', requireAuth, async (req, res) => {
  const { sessionId, path: dirPath } = req.body;
  
  try {
    await SSHManager.mkdir(sessionId, dirPath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Удаление через SSH
app.post('/api/ssh/files/delete', requireAuth, async (req, res) => {
  const { sessionId, path: targetPath, isDirectory } = req.body;
  
  try {
    await SSHManager.delete(sessionId, targetPath, isDirectory);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Переименование через SSH
app.post('/api/ssh/files/rename', requireAuth, async (req, res) => {
  const { sessionId, path: oldPath, newPath } = req.body;
  
  try {
    await SSHManager.rename(sessionId, oldPath, newPath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Скачивание файла через SSH
app.get('/api/ssh/files/download', requireAuth, async (req, res) => {
  const { sessionId, path: filePath } = req.query;
  
  try {
    const buffer = await SSHManager.downloadFile(sessionId, filePath);
    const fileName = path.basename(filePath);
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';
    
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Загрузка файла через SSH
app.post('/api/ssh/files/upload', requireAuth, async (req, res) => {
  const { sessionId, path: filePath } = req.body;
  
  try {
    // Получаем буфер из запроса
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      const buffer = Buffer.concat(chunks);
      
      try {
        await SSHManager.uploadFile(sessionId, filePath, buffer);
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Информация о файле через SSH
app.get('/api/ssh/files/info', requireAuth, async (req, res) => {
  const { sessionId, path: filePath } = req.query;
  
  try {
    const info = await SSHManager.stat(sessionId, filePath);
    res.json(info);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Трансфер между локальным и SSH
app.post('/api/ssh/transfer', requireAuth, async (req, res) => {
  const { sessionId, sourcePath, destPath, direction } = req.body;
  
  try {
    await SSHManager.transferFile(sessionId, sourcePath, destPath, direction);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Выполнение команды через SSH
app.post('/api/ssh/exec', requireAuth, async (req, res) => {
  const { sessionId, command } = req.body;
  
  try {
    const result = await SSHManager.exec(sessionId, command);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

// Start server
app.listen(PORT, () => {
  console.log(`DockCommander server running on port ${PORT}`);
  console.log(`Root path: ${config.rootPath}`);
  console.log(`Auth enabled: ${config.auth.enabled}`);
});
