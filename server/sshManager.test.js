const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const Module = require('module');

function fixture() {
  const clients = [];
  class Client extends EventEmitter {
    constructor() { super(); clients.push(this); }
    connect(options) { this.options = options; }
    end() { this.ended = true; }
  }
  const filename = require.resolve('./sshManager');
  const loaded = new Module(filename, module);
  loaded.require = id => id === 'ssh2' ? { Client } : require(require.resolve(id, { paths: [__dirname] }));
  loaded._compile(fs.readFileSync(filename, 'utf8'), filename);
  const manager = loaded.exports;
  const start = (id = 'one', owner = 'browser1') => manager.connect(id, {
    host: 'host', username: 'user', password: 'secret', privateKey: 'key-secret', passphrase: 'phrase-secret',
  }, owner);
  return { manager, clients, start };
}

test('live sessions expose metadata only, filter by web owner and keep keepalive enabled', async () => {
  const { manager, clients, start } = fixture();
  const first = start();
  assert.deepEqual(manager.getActiveSessions(), []);
  clients[0].emit('ready'); await first;
  const second = start('two', 'browser2'); clients[1].emit('ready'); await second;
  const sessions = manager.getActiveSessions('browser1');
  assert.equal(sessions.length, 1);
  assert.deepEqual(Object.keys(sessions[0]).sort(), ['connectedAt', 'host', 'port', 'sessionId', 'status', 'username']);
  assert.equal(sessions[0].status, 'ready');
  assert.equal(manager.getActiveSessions().length, 2);
  assert.equal(JSON.stringify(manager.getConnection('one').config).includes('secret'), false);
  assert.equal(clients[0].options.keepaliveInterval, 10000);
  assert.equal(clients[0].options.keepaliveCountMax, 3);
  assert.throws(() => manager.getConnection('one', 'browser2'), { code: 'SSH_SESSION_NOT_FOUND' });
  assert.throws(() => manager.disconnect('one', 'browser2'), { code: 'SSH_SESSION_NOT_FOUND' });
  assert.equal(clients[0].ended, undefined);
  manager.disconnect('one', 'browser1');
  assert.equal(clients[0].ended, true);
  assert.deepEqual(manager.getActiveSessions('browser1'), []);
});

test('duplicate pending and ready IDs rejected without allocating or leaking another client', async () => {
  const { manager, clients, start } = fixture();
  const pending = start();
  await assert.rejects(start(), /already exists/);
  clients[0].emit('ready'); await pending;
  await assert.rejects(start(), /already exists/);
  assert.equal(clients.length, 1);
  assert.equal(manager.getConnection('one').conn, clients[0]);
});

for (const event of ['close', 'end', 'error']) test(`${event} removes dead SSH session promptly`, async () => {
  const { manager, clients, start } = fixture();
  const pending = start(); clients[0].emit('ready'); await pending;
  clients[0].emit(event, new Error('lost'));
  assert.deepEqual(manager.getActiveSessions(), []);
  assert.throws(() => manager.getConnection('one'), { code: 'SSH_SESSION_NOT_FOUND' });
  const replacement = start(); clients[1].emit('ready'); await replacement;
  clients[0].emit('close');
  assert.equal(manager.getConnection('one').conn, clients[1]);
});

test('close before ready rejects connect and releases the ID', async () => {
  const { manager, clients, start } = fixture();
  const pending = start(); clients[0].emit('close');
  await assert.rejects(pending, /closed/);
  assert.deepEqual(manager.getActiveSessions(), []);
});

test('owner cleanup removes all owned connections, tolerates closing failures and leaves others alive', async () => {
  const { manager, clients, start } = fixture();
  for (const [id, owner] of [['one', 'browser1'], ['two', 'browser1'], ['other', 'browser2']]) {
    const pending = start(id, owner); clients.at(-1).emit('ready'); await pending;
  }
  clients[0].end = () => { clients[0].ended = true; throw new Error('Already closing'); };
  assert.doesNotThrow(() => manager.disconnectByOwner(undefined));
  assert.doesNotThrow(() => manager.disconnectByOwner('unknown'));
  assert.equal(manager.getActiveSessions().length, 3);
  manager.disconnectByOwner('browser1');
  assert.equal(clients[0].ended, true);
  assert.equal(clients[1].ended, true);
  assert.equal(clients[2].ended, undefined);
  assert.deepEqual(manager.getActiveSessions('browser1'), []);
  assert.equal(manager.getConnection('other', 'browser2').conn, clients[2]);
  assert.doesNotThrow(() => manager.disconnectByOwner('browser1'));
});

test('undefined owner cleanup does not close unowned connections', async () => {
  const { manager, clients } = fixture();
  const pending = manager.connect('unowned', { host: 'host', username: 'user', password: 'secret' });
  clients[0].emit('ready'); await pending;
  manager.disconnectByOwner(undefined);
  assert.equal(manager.getActiveSessions().length, 1);
  assert.equal(clients[0].ended, undefined);
});
