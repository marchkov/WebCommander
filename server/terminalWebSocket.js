const http = require('http');
const { WebSocketServer } = require('ws');

function attachTerminalWebSocket({ server, sessionMiddleware, terminalService,
  authEnabled = true, heartbeatMs = 30000 }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  let closed = false;
  const pending = new Set();
  const onUpgrade = (request, socket, head) => {
    // Handshake errors must not become uncaught socket errors.
    const onError = () => socket.destroy();
    socket.on('error', onError);
    const reject = (status, reason) => {
      socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    try {
      if (new URL(request.url, 'http://localhost').pathname !== '/api/terminal') {
        reject(404, 'Not Found');
        return;
      }
      // Cookie authentication alone would allow cross-site WebSocket hijacking.
      // Browsers supply Origin; non-browser clients can authenticate with cookies.
      if (request.headers.origin) {
        const origin = new URL(request.headers.origin);
        if (!['http:', 'https:'].includes(origin.protocol) || origin.host.toLowerCase() !== request.headers.host?.toLowerCase()) {
          reject(403, 'Forbidden');
          return;
        }
      }
    } catch {
      reject(400, 'Bad Request');
      return;
    }
    pending.add(socket);
    const timeout = setTimeout(() => socket.destroy(), 10000);
    timeout.unref();
    socket.once('close', () => { clearTimeout(timeout); pending.delete(socket); });
    const response = new http.ServerResponse(request);
    try {
      sessionMiddleware(request, response, error => {
        clearTimeout(timeout);
        pending.delete(socket);
        if (socket.destroyed || closed) return socket.destroy();
        if (error) return reject(500, 'Internal Server Error');
        if (authEnabled && !request.session?.authenticated) return reject(401, 'Unauthorized');
        try {
          wss.handleUpgrade(request, socket, head, ws => {
            socket.removeListener('error', onError);
            wss.emit('connection', ws, request);
          });
        } catch { socket.destroy(); }
      });
    } catch { reject(500, 'Internal Server Error'); }
  };

  wss.on('connection', (socket, request) => {
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('error', () => {}); // TerminalService handles teardown.
    terminalService.attach(socket, request);
  });
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) socket.terminate();
      else {
        socket.isAlive = false;
        socket.ping();
      }
    }
  }, heartbeatMs);
  heartbeat.unref();
  server.on('upgrade', onUpgrade);
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    server.removeListener('upgrade', onUpgrade);
    for (const socket of pending) socket.destroy();
    pending.clear();
    terminalService.close();
    for (const socket of wss.clients) socket.terminate();
    wss.close();
  };
  server.once('close', close);
  return { close, wss };
}

module.exports = attachTerminalWebSocket;
