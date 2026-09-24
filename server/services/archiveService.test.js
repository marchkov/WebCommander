const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const unzipper = require('unzipper');
const LocalProvider = require('../providers/localProvider');
const ArchiveService = require('./archiveService');
const { validateArchiveEntryName } = require('./archiveService');
const SftpProvider = require('../providers/sftpProvider');
const { Readable, Writable } = require('stream');
const fixtures = new Set();

async function createFixture() {
  const rootPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webcommander-archive-'));
  fixtures.add(rootPath);
  return {
    rootPath,
    provider: new LocalProvider({ rootPath, allowedPaths: [rootPath], blockedPaths: [] }),
    service: new ArchiveService(),
  };
}

test.afterEach(async () => {
  for (const root of fixtures) {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('webcommander-archive-'));
    await fs.promises.rm(root, { recursive: true, force: true });
    fixtures.delete(root);
  }
});

test('creates ZIP archives from files, directories, empty directories, and binary data', async () => {
  const { rootPath, provider, service } = await createFixture();
  const photosPath = path.join(rootPath, 'photos');
  await fs.promises.mkdir(path.join(photosPath, 'empty'), { recursive: true });
  await fs.promises.writeFile(path.join(rootPath, 'notes.txt'), 'notes');
  const binary = Buffer.from([0, 1, 2, 127, 128, 254, 255]);
  await fs.promises.writeFile(path.join(photosPath, 'image.bin'), binary);

  const archivePath = path.join(rootPath, 'bundle.zip');
  await service.createZip({
    provider,
    sourcePaths: [path.join(rootPath, 'notes.txt'), photosPath],
    destinationPath: archivePath,
  });

  const archive = await unzipper.Open.file(archivePath);
  const names = archive.files.map(file => file.path).sort();
  assert.deepEqual(names, ['notes.txt', 'photos/', 'photos/empty/', 'photos/image.bin'].sort());
  assert.deepEqual(await archive.files.find(file => file.path === 'photos/image.bin').buffer(), binary);
});

test('extracts nested ZIP content and supports overwrite conflicts', async () => {
  const { rootPath, provider, service } = await createFixture();
  const sourcePath = path.join(rootPath, 'source');
  await fs.promises.mkdir(path.join(sourcePath, 'nested'), { recursive: true });
  await fs.promises.writeFile(path.join(sourcePath, 'nested', 'file.txt'), 'new');
  const archivePath = path.join(rootPath, 'source.zip');
  await service.createZip({ provider, sourcePaths: [sourcePath], destinationPath: archivePath });

  const destinationPath = path.join(rootPath, 'extracted');
  await fs.promises.mkdir(destinationPath);
  const first = await service.extractZip({ provider, archivePath, destinationPath, overwrite: false });
  assert.equal(first.filesExtracted, 1);
  assert.equal(await fs.promises.readFile(path.join(destinationPath, 'source', 'nested', 'file.txt'), 'utf8'), 'new');

  await assert.rejects(
    () => service.extractZip({ provider, archivePath, destinationPath, overwrite: false }),
    error => error.statusCode === 409,
  );

  await fs.promises.writeFile(path.join(destinationPath, 'source', 'nested', 'file.txt'), 'old');
  await service.extractZip({ provider, archivePath, destinationPath, overwrite: true });
  assert.equal(await fs.promises.readFile(path.join(destinationPath, 'source', 'nested', 'file.txt'), 'utf8'), 'new');
});

test('rejects unsafe ZIP entry names', () => {
  for (const entryName of ['../outside.txt', '../../etc/passwd', '/absolute.txt', 'C:/Windows/system32.txt', 'C:\\Windows\\system32.txt']) {
    assert.throws(() => validateArchiveEntryName(entryName), { code: 'ZIP_SLIP', statusCode: 400 });
  }
  assert.equal(validateArchiveEntryName('nested/file.txt'), 'nested/file.txt');
});

// Construct stored ZIPs directly: archiver sanitizes unsafe names, which would
// otherwise make malicious-entry tests pass without exercising extraction.
function rawZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, content = 'payload'] of entries) {
    const filename = Buffer.from(name);
    const data = Buffer.from(content);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    local.push(header, filename, data);
    central.push(directory, filename);
    offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

for (const filenames of [['single.txt'], ['one.txt', 'two.bin']]) {
  test(`packs ${filenames.length} selected files preserving names and binary bytes`, async () => {
    const { rootPath, provider, service } = await createFixture();
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const sourcePaths = filenames.map(name => path.join(rootPath, name));
    for (const source of sourcePaths) await fs.promises.writeFile(source, bytes);
    const archivePath = path.join(rootPath, 'out.zip');
    await service.createZip({ provider, sourcePaths, destinationPath: archivePath });
    const zip = await unzipper.Open.file(archivePath);
    assert.deepEqual(zip.files.map(entry => entry.path), filenames);
    for (const file of zip.files) assert.deepEqual(await file.buffer(), bytes);
  });
}

for (const name of ['../outside.txt', '../../etc/passwd', '/absolute.txt', 'C:/outside.txt',
  'C:\\outside.txt', 'C:outside.txt', '\\\\server\\share\\file', 'dir/../../outside.txt', '.. /outside.txt']) {
  test(`extraction rejects unsafe ZIP entry ${JSON.stringify(name)}`, async () => {
    const { rootPath, provider, service } = await createFixture();
    const archivePath = path.join(rootPath, 'bad.zip');
    await fs.promises.writeFile(archivePath, rawZip([[name]]));
    const destinationPath = path.join(rootPath, 'out');
    await assert.rejects(service.extractZip({ provider, archivePath, destinationPath }), { code: 'ZIP_SLIP' });
    assert.deepEqual(await fs.promises.readdir(destinationPath), []);
  });
}

test('extracts implicit nested directories, empty directories, and binary files', async () => {
  const { rootPath, provider, service } = await createFixture();
  const archivePath = path.join(rootPath, 'nested.zip');
  const bytes = Buffer.from([0, 255, 128, 1]);
  await fs.promises.writeFile(archivePath, rawZip([
    ['a/b/file.bin', bytes], ['a/', ''], ['empty/', ''],
  ]));
  const destinationPath = path.join(rootPath, 'new', 'destination');
  const result = await service.extractZip({ provider, archivePath, destinationPath });
  assert.equal(result.filesExtracted, 1);
  assert.equal(result.directoriesCreated, 3);
  assert.deepEqual(await fs.promises.readFile(path.join(destinationPath, 'a/b/file.bin')), bytes);
  assert.deepEqual(await fs.promises.readdir(path.join(destinationPath, 'empty')), []);
});

test('file conflicts preserve old bytes unless overwrite=true, including extraction at provider root', async () => {
  const { rootPath, provider, service } = await createFixture();
  const archivePath = path.join(rootPath, 'a.zip');
  const target = path.join(rootPath, 'file.txt');
  await fs.promises.writeFile(archivePath, rawZip([['file.txt', 'new']]));
  await fs.promises.writeFile(target, 'old');
  await assert.rejects(service.extractZip({ provider, archivePath, destinationPath: rootPath }), { statusCode: 409 });
  assert.equal(await fs.promises.readFile(target, 'utf8'), 'old');
  await service.extractZip({ provider, archivePath, destinationPath: rootPath, overwrite: true });
  assert.equal(await fs.promises.readFile(target, 'utf8'), 'new');
});

for (const directory of [false, true]) {
  test(`overwrite=true never replaces ${directory ? 'file with directory' : 'directory with file'}`, async () => {
    const { rootPath, provider, service } = await createFixture();
    const archivePath = path.join(rootPath, 'a.zip');
    const target = path.join(rootPath, 'target');
    await fs.promises.writeFile(archivePath, rawZip([[directory ? 'target/' : 'target', '']]));
    if (directory) await fs.promises.writeFile(target, 'old');
    else await fs.promises.mkdir(target);
    await assert.rejects(service.extractZip({ provider, archivePath, destinationPath: rootPath, overwrite: true }), { statusCode: 409 });
    assert.equal((await fs.promises.stat(target)).isDirectory(), !directory);
  });
}

test('cannot extract outside LocalProvider allowed paths or into blocked descendants', async () => {
  const { rootPath, service } = await createFixture();
  const allowed = path.join(rootPath, 'allowed');
  const blocked = path.join(allowed, 'blocked');
  await fs.promises.mkdir(blocked, { recursive: true });
  const provider = new LocalProvider({ rootPath: allowed, allowedPaths: [allowed], blockedPaths: [blocked] });
  const archivePath = path.join(allowed, 'a.zip');
  await fs.promises.writeFile(archivePath, rawZip([['blocked/file.txt']]));
  await assert.rejects(service.extractZip({ provider, archivePath, destinationPath: path.join(rootPath, 'outside') }), { statusCode: 403 });
  await assert.rejects(service.extractZip({ provider, archivePath, destinationPath: allowed, overwrite: true }), { statusCode: 403 });
  assert.deepEqual(await fs.promises.readdir(blocked), []);
});

async function directoryLink(target, link) {
  // Windows junctions exercise real link escapes without requiring symlink privileges.
  await fs.promises.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

for (const outsideAllowed of [false, true]) {
  test(`rejects symlink extraction escape ${outsideAllowed ? 'outside allowed paths' : 'inside allowed paths but outside destination'}`, async () => {
    const { rootPath, service } = await createFixture();
    const allowed = path.join(rootPath, 'allowed');
    const out = path.join(allowed, 'out');
    const outside = path.join(rootPath, outsideAllowed ? 'outside' : 'allowed/sibling');
    await fs.promises.mkdir(out, { recursive: true });
    await fs.promises.mkdir(outside, { recursive: true });
    await directoryLink(outside, path.join(out, 'link'));
    const provider = new LocalProvider({ rootPath: allowed, allowedPaths: [allowed] });
    const archivePath = path.join(allowed, 'a.zip');
    await fs.promises.writeFile(archivePath, rawZip([['link/file.txt']]));
    await assert.rejects(service.extractZip({ provider, archivePath, destinationPath: out, overwrite: true }),
      error => error.code === 'ZIP_SLIP' || error.statusCode === 403);
    assert.deepEqual(await fs.promises.readdir(outside), []);
  });
}

test('rejects dangling links without creating their targets', async () => {
  const { rootPath, provider, service } = await createFixture();
  const out = path.join(rootPath, 'out');
  await fs.promises.mkdir(out);
  const missing = path.join(rootPath, 'missing');
  await directoryLink(missing, path.join(out, 'link'));
  const archivePath = path.join(rootPath, 'a.zip');
  await fs.promises.writeFile(archivePath, rawZip([['link/file.txt']]));
  await assert.rejects(service.extractZip({ provider, archivePath, destinationPath: out, overwrite: true }));
  assert.equal(fs.existsSync(missing), false);
});

test('creation rejects existing output, self-inclusion, source link escapes and cycles', async () => {
  const { rootPath, service } = await createFixture();
  const allowed = path.join(rootPath, 'allowed');
  const outside = path.join(rootPath, 'outside');
  await fs.promises.mkdir(allowed);
  await fs.promises.mkdir(outside);
  const provider = new LocalProvider({ rootPath: allowed, allowedPaths: [allowed] });
  const archivePath = path.join(allowed, 'out.zip');
  await fs.promises.writeFile(archivePath, 'keep');
  await assert.rejects(service.createZip({ provider, sourcePaths: [allowed], destinationPath: archivePath }), { statusCode: 409 });
  assert.equal(await fs.promises.readFile(archivePath, 'utf8'), 'keep');
  await assert.rejects(service.createZip({ provider, sourcePaths: [allowed], destinationPath: path.join(allowed, 'self.zip') }), { code: 'ZIP_SLIP' });
  await directoryLink(outside, path.join(allowed, 'escape'));
  await assert.rejects(service.createZip({ provider, sourcePaths: [path.join(allowed, 'escape')], destinationPath: path.join(allowed, 'escape.zip') }), { statusCode: 403 });
  const folder = path.join(allowed, 'folder');
  await fs.promises.mkdir(folder);
  await directoryLink(folder, path.join(folder, 'loop'));
  await assert.rejects(service.createZip({ provider, sourcePaths: [folder], destinationPath: path.join(allowed, 'cycle.zip') }), { code: 'ZIP_SLIP' });
});

test('malformed ZIP and source read failures reject instead of hanging', { timeout: 5000 }, async () => {
  const { rootPath, provider, service } = await createFixture();
  const archivePath = path.join(rootPath, 'bad.zip');
  await fs.promises.writeFile(archivePath, 'not a zip');
  await assert.rejects(service.extractZip({ provider, archivePath, destinationPath: rootPath }));
  provider.createReadStream = () => new Readable({ read() { this.destroy(new Error('read failed')); } });
  await assert.rejects(service.createZip({ provider, sourcePaths: [archivePath], destinationPath: path.join(rootPath, 'out.zip') }), /read failed/);
  assert.equal(fs.existsSync(path.join(rootPath, 'out.zip')), false);
  await assert.rejects(service.extractZip({ provider, archivePath, destinationPath: rootPath }), /read failed/);
});

test('creation and extraction propagate output stream failures', { timeout: 5000 }, async () => {
  const { rootPath, provider, service } = await createFixture();
  const archivePath = path.join(rootPath, 'a.zip');
  await fs.promises.writeFile(archivePath, rawZip([['file.txt']]));
  provider.createWriteStream = () => new Writable({ write(_data, _encoding, callback) { callback(new Error('disk full')); } });
  await assert.rejects(service.createZip({ provider, sourcePaths: [archivePath], destinationPath: path.join(rootPath, 'out.zip') }), /disk full/);
  await assert.rejects(service.extractZip({ provider, archivePath, destinationPath: rootPath }), /disk full/);
});

test('truncated archives and read failures during an entry do not hang', { timeout: 5000 }, async () => {
  const { rootPath, provider, service } = await createFixture();
  const archivePath = path.join(rootPath, 'a.zip');
  const bytes = rawZip([['large.bin', Buffer.alloc(128 * 1024, 7)]]);
  await fs.promises.writeFile(archivePath, bytes.subarray(0, 100));
  await assert.rejects(service.extractZip({ provider, archivePath, destinationPath: rootPath }));
  provider.createReadStream = () => Readable.from((async function* () {
    yield bytes.subarray(0, 100);
    await new Promise(resolve => setTimeout(resolve, 20));
    throw new Error('remote disconnected');
  })());
  await assert.rejects(service.extractZip({ provider, archivePath, destinationPath: rootPath, overwrite: true }), /remote disconnected/);
});

test('cannot overwrite the input ZIP during extraction', async () => {
  const { rootPath, provider, service } = await createFixture();
  const archivePath = path.join(rootPath, 'a.zip');
  const bytes = rawZip([['a.zip', 'corrupt']]);
  await fs.promises.writeFile(archivePath, bytes);
  await assert.rejects(service.extractZip({ provider, archivePath, destinationPath: rootPath, overwrite: true }), { statusCode: 409 });
  assert.deepEqual(await fs.promises.readFile(archivePath), bytes);
});

// Exercise the real SftpProvider through a filesystem-backed SFTP protocol fake.
// Service code receives only remote paths and streams, never local paths.
test('SFTP creates and extracts nested binary ZIPs through provider streams', async () => {
  const { rootPath, service } = await createFixture();
  const local = remote => path.join(rootPath, path.posix.relative('/remote', remote));
  const attrs = stats => ({ size: stats.size, mode: stats.mode, isDirectory: () => stats.isDirectory() });
  const sftp = {
    realpath(remote, callback) {
      if (remote === '.') return callback(null, '/remote');
      fs.realpath(local(remote), (error, real) => callback(error, error ? undefined :
        path.posix.join('/remote', path.relative(rootPath, real).replace(/\\/g, '/'))));
    },
    stat(remote, callback) { fs.stat(local(remote), (error, stats) => callback(error, error ? undefined : attrs(stats))); },
    lstat(remote, callback) { fs.lstat(local(remote), (error, stats) => callback(error, error ? undefined : attrs(stats))); },
    readdir(remote, callback) {
      fs.promises.readdir(local(remote)).then(async names => Promise.all(names.map(async filename => ({
        filename, attrs: attrs(await fs.promises.stat(path.join(local(remote), filename))),
      })))).then(entries => callback(null, entries), callback);
    },
    mkdir(remote, callback) { fs.mkdir(local(remote), callback); },
    unlink(remote, callback) { fs.unlink(local(remote), callback); },
    createReadStream(remote) { return fs.createReadStream(local(remote)); },
    createWriteStream(remote) { return fs.createWriteStream(local(remote)); },
  };
  const provider = new SftpProvider({ sessionId: 'test', sshManager: { getSftp: async () => sftp } });
  const bytes = Buffer.from([0, 128, 255, 42]);
  await fs.promises.mkdir(path.join(rootPath, 'source', 'empty'), { recursive: true });
  await fs.promises.writeFile(path.join(rootPath, 'source', 'binary.bin'), bytes);
  await service.createZip({ provider, sourcePaths: ['/remote/source'], destinationPath: '/remote/a.zip' });
  await service.extractZip({ provider, archivePath: '/remote/a.zip', destinationPath: '/remote/new/nested' });
  assert.deepEqual(await fs.promises.readFile(path.join(rootPath, 'new/nested/source/binary.bin')), bytes);
  assert.deepEqual(await fs.promises.readdir(path.join(rootPath, 'new/nested/source/empty')), []);
  // Real SFTP missing-path errors are numeric, unlike fs errors in this fake.
  await assert.rejects(service.extractZip({ provider, archivePath: '/remote/a.zip', destinationPath: '/remote/new/nested' }), { statusCode: 409 });
  await service.extractZip({ provider, archivePath: '/remote/a.zip', destinationPath: '/remote/new/nested', overwrite: true });
});
