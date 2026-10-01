const multer = require('multer');
const { createExclusiveFile, failure, missing } = require('./fileSecurity');

function registerUploadRoutes(app, { requireAuth, createProvider, security, rootPath }) {
  if (!Number.isSafeInteger(security.maxFileSize) || security.maxFileSize <= 0) {
    throw new Error('maxFileSize must be a positive safe integer');
  }
  const parse = multer({
    storage: multer.memoryStorage(),
    preservePath: true, // Reject traversal; Busboy must not strip its path components.
    limits: { fileSize: security.maxFileSize, files: 1, fields: 4, parts: 5, fieldSize: 4096 },
  }).single('file');
  app.post('/api/files/upload', requireAuth, (req, res) => {
    parse(req, res, async error => {
      if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
        error: error.code === 'LIMIT_FILE_SIZE' ? 'File too large' : 'Invalid multipart upload',
        code: error.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'INVALID_MULTIPART',
      });
      try {
        if (!req.file) throw failure('No file uploaded', 400, 'INVALID_MULTIPART');
        const providerType = req.body.provider || 'local';
        if (!['local', 'sftp'].includes(providerType)) throw failure('Invalid provider', 400, 'INVALID_PROVIDER');
        const directory = req.body.path || (providerType === 'local' ? rootPath : '~');
        if (typeof directory !== 'string' || !directory.trim() || directory.includes('\0')) {
          throw failure('Invalid destination path', 403, 'INVALID_PATH');
        }
        const provider = await createProvider(providerType, req.body.sessionId, req);
        const destination = await createExclusiveFile({ provider, directory, name: req.file.originalname,
          data: req.file.buffer, allowedExtensions: security.allowedExtensions });
        res.json({ success: true, filename: req.file.originalname, path: destination, size: req.file.size });
      } catch (error) {
        const status = error.statusCode || error.status || (missing(error) ? 403 : 500);
        res.status(status).json({ error: status === 500 ? 'Upload failed' : error.message, code: error.code });
      }
    });
  });
}

module.exports = registerUploadRoutes;
