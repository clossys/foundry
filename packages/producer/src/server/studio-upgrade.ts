import { createHash } from 'node:crypto';
import { request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';

const acceptKey = (key: string) => createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
const count = (request: IncomingMessage, name: string) => request.rawHeaders.filter((_, index) => index % 2 === 0 && request.rawHeaders[index]!.toLowerCase() === name).length;

/** Next's development RSC debug stream uses this one HMR socket before hydration. */
export function attachStudioUpgrade(server: Server, options: { publicPort: () => number; childPort: () => number | undefined; token: string }): () => void {
  const active = new Set<() => void>();
  let closed = false;
  server.on('upgrade', (request, socket, head) => {
    const reject = (status: number) => socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    const host = request.headers.host;
    if (count(request, 'host') !== 1 || (host !== `127.0.0.1:${options.publicPort()}` && host !== `localhost:${options.publicPort()}`)
      || count(request, 'origin') !== 1 || request.headers.origin !== `http://${host}`) { reject(403); return; }
    const raw = request.url ?? '';
    let url: URL;
    try { url = new URL(raw, `http://${host}`); } catch { reject(400); return; }
    // The installed Next client sends /_next/hmr?id=<HTML request id>. No other WS target is exposed.
    if (url.hash || raw.split('?')[0] !== '/_next/hmr' || /[\x00-\x20\x7f\\]/.test(raw)
      || [...url.searchParams.keys()].some(key => key !== 'id') || url.searchParams.getAll('id').length !== 1 || !url.searchParams.get('id')
      || raw.includes(options.token) || [...url.searchParams].flat().join(' ').includes(options.token)) { reject(400); return; }
    const key = request.headers['sec-websocket-key'];
    const connection = request.headers.connection?.toLowerCase().split(',').map(value => value.trim()) ?? [];
    if (request.method !== 'GET' || count(request, 'upgrade') !== 1 || request.headers.upgrade?.toLowerCase() !== 'websocket'
      || count(request, 'connection') !== 1 || !connection.includes('upgrade') || connection.some(value => value !== 'upgrade' && value !== 'keep-alive')
      || count(request, 'sec-websocket-version') !== 1 || request.headers['sec-websocket-version'] !== '13'
      || count(request, 'sec-websocket-key') !== 1 || typeof key !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(key)
      || Buffer.from(key, 'base64').length !== 16 || request.headers['sec-websocket-protocol'] !== undefined) { reject(400); return; }
    const childPort = options.childPort();
    if (closed || !childPort) { reject(503); return; }
    // Build a handshake allowlist: run tokens, cookies, forwarding and connection-nominated headers never cross.
    const upstream = httpRequest({ hostname: '127.0.0.1', port: childPort, method: 'GET', path: raw,
      headers: { Host: `127.0.0.1:${childPort}`, Origin: request.headers.origin, Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' } });
    let peer: Duplex | undefined;
    const cleanup = () => { active.delete(cleanup); upstream.destroy(); socket.destroy(); peer?.destroy(); };
    active.add(cleanup);
    socket.once('close', cleanup);
    upstream.once('error', cleanup);
    upstream.setTimeout(10_000, cleanup);
    upstream.once('response', response => { response.resume(); reject(502); upstream.destroy(); });
    upstream.once('upgrade', (response, childSocket, childHead) => {
      peer = childSocket;
      childSocket.once('error', cleanup);
      childSocket.once('close', cleanup);
      if (closed || socket.destroyed || response.statusCode !== 101 || response.headers.upgrade?.toLowerCase() !== 'websocket'
        || response.headers['sec-websocket-accept'] !== acceptKey(key)) { cleanup(); return; }
      upstream.setTimeout(0);
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
      if (childHead.length) socket.write(childHead);
      if (head.length) childSocket.write(head);
      socket.pipe(childSocket); childSocket.pipe(socket);
    });
    upstream.end();
  });
  const close = () => { closed = true; for (const cleanup of active) cleanup(); };
  server.once('close', close);
  return close;
}
