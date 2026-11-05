'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const { createServer } = require('node:http');
const { connect } = require('node:net');
const { test } = require('node:test');
// Node 24 imports the actual transport source; this suite does not build or start Producer.
const transport = import('../../src/server/studio-upgrade.ts');

const token = 'test-only-run-token';
const requestId = '11111111-1111-4111-8111-111111111111';
const endpoint = `/_next/hmr?id=${requestId}`;
const key = Buffer.alloc(16, 1).toString('base64');
const wait = (target, event) => once(target, event, { signal: AbortSignal.timeout(3000) });
async function listen(server) {
  server.listen(0, '127.0.0.1'); await wait(server, 'listening');
  return server.address().port;
}
async function fixture(hold = false) {
  const sockets = new Set();
  const received = [];
  const child = createServer();
  child.on('upgrade', (request, socket) => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    received.push({ path: request.url, headers: request.headers });
    if (hold) return;
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    // A real HTTP Upgrade peer: the first binary frame can arrive with the handshake head.
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.write(Buffer.from([0x82, 3, 0, 1, 2]));
    let buffered = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 6) {
        const length = buffered[1] & 127;
        assert.ok(length < 126, 'bounded fixture frames');
        if (buffered.length < length + 6) return;
        const opcode = buffered[0] & 15;
        const mask = buffered.subarray(2, 6);
        const payload = Buffer.from(buffered.subarray(6, 6 + length));
        for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4];
        buffered = buffered.subarray(6 + length);
        socket.write(Buffer.concat([Buffer.from([0x80 | opcode, length]), payload]));
        if (opcode === 8) socket.end();
      }
    });
  });
  const childPort = await listen(child);
  const proxy = createServer((_, response) => response.end('ordinary HTTP'));
  let port = 0;
  const { attachStudioUpgrade } = await transport;
  const closeUpgrades = attachStudioUpgrade(proxy, { publicPort: () => port, childPort: () => childPort, token });
  port = await listen(proxy);
  return { port, received, sockets, child, closeUpgrades, async close() {
    closeUpgrades();
    for (const socket of sockets) socket.destroy();
    await Promise.all([new Promise(resolve => proxy.close(() => resolve())), new Promise(resolve => child.close(() => resolve()))]);
  } };
}
async function handshake(port, changes = {}) {
  const socket = connect(port, '127.0.0.1');
  await wait(socket, 'connect');
  const data = wait(socket, 'data');
  socket.write(`${changes.method ?? 'GET'} ${changes.path ?? endpoint} HTTP/1.1\r\n${(changes.headers ?? [
    `Host: 127.0.0.1:${port}`, `Origin: http://127.0.0.1:${port}`, 'Connection: Upgrade', 'Upgrade: websocket',
    'Sec-WebSocket-Version: 13', `Sec-WebSocket-Key: ${key}`,
  ]).join('\r\n')}\r\n\r\n`);
  const [chunk] = await data;
  socket.destroy();
  return String(chunk).split('\r\n')[0];
}

test('native HMR upgrade transports binary and bidirectional frames, then closes both peers', async () => {
  const live = await fixture();
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${live.port}${endpoint}`, { headers: { Origin: `http://127.0.0.1:${live.port}` } });
    ws.binaryType = 'arraybuffer';
    const first = wait(ws, 'message');
    await wait(ws, 'open');
    const [debug] = await first;
    assert.deepEqual(Buffer.from(debug.data), Buffer.from([0, 1, 2]));
    const echo = wait(ws, 'message'); ws.send('hydration debug channel');
    assert.equal((await echo)[0].data, 'hydration debug channel');
    const binary = wait(ws, 'message'); ws.send(Buffer.from([3, 4, 5]));
    assert.deepEqual(Buffer.from((await binary)[0].data), Buffer.from([3, 4, 5]));
    const ended = wait(ws, 'close'); ws.close(); await ended;
    assert.equal(live.received[0].path, endpoint);
    // HTTP paths still use the original request listener.
    assert.equal(await (await fetch(`http://127.0.0.1:${live.port}/`)).text(), 'ordinary HTTP');
  } finally { await live.close(); }
});

test('only the local same-origin canonical Next handshake is forwarded and headers are isolated', async () => {
  const live = await fixture();
  try {
    const standard = [`Host: 127.0.0.1:${live.port}`, `Origin: http://127.0.0.1:${live.port}`, 'Connection: Upgrade', 'Upgrade: websocket',
      'Sec-WebSocket-Version: 13', `Sec-WebSocket-Key: ${key}`];
    const badHeaders = [
      ['Host: example.test', ...standard.slice(1)],
      [...standard, `Host: localhost:${live.port}`],
      [standard[0], 'Origin: http://example.test', ...standard.slice(2)],
      [...standard, `Origin: http://127.0.0.1:${live.port}`],
      standard.filter(line => !line.startsWith('Origin:')),
      standard.map(line => line === 'Upgrade: websocket' ? 'Upgrade: h2c' : line),
      standard.map(line => line === 'Connection: Upgrade' ? 'Connection: Upgrade, Origin' : line),
      standard.map(line => line === 'Connection: Upgrade' ? 'Connection: Upgrade, Sec-WebSocket-Key' : line),
      standard.map(line => line === 'Sec-WebSocket-Version: 13' ? 'Sec-WebSocket-Version: 12' : line),
      standard.map(line => line.startsWith('Sec-WebSocket-Key:') ? 'Sec-WebSocket-Key: invalid' : line),
      [...standard, `Sec-WebSocket-Key: ${key}`],
      [...standard, 'Sec-WebSocket-Protocol: arbitrary'],
    ];
    for (const headers of badHeaders) assert.match(await handshake(live.port, { headers }), /^HTTP\/1.1 (400|403)/);
    for (const path of ['/other', '/_next/hmr/extra', '/%5fnext/hmr', '/_next/../hmr', '/_next/hmr', `${endpoint}#fragment`, `${endpoint}&target=http://example.test`, `${endpoint}&id=again`, `/_next/hmr?id=${token}`,
      `/_next/hmr?id=${[...token].map(letter => '%' + letter.charCodeAt(0).toString(16)).join('')}`]) {
      assert.match(await handshake(live.port, { path }), /^HTTP\/1.1 400/);
    }
    assert.match(await handshake(live.port, { method: 'POST' }), /^HTTP\/1.1 400/);
    assert.equal(live.received.length, 0, 'rejected requests never reach the child');
    assert.match(await handshake(live.port, { headers: [...standard, 'X-Clossys-Token: header-only', 'X-Forwarded-Host: example.test',
      'Forwarded: host=example.test', 'Cookie: private=value', 'X-Clossys-Record-Theme: dark'] }), /^HTTP\/1.1 101/);
    const headers = live.received[0].headers;
    for (const name of ['x-clossys-token', 'x-forwarded-host', 'forwarded', 'cookie', 'x-clossys-record-theme']) assert.equal(headers[name], undefined);
    assert.notEqual(headers.host, `127.0.0.1:${live.port}`, 'child Host is its fixed owned port');
  } finally { await live.close(); }
});

test('shutdown closes established and pending upgrades without leaving the HTTP server waiting', async () => {
  for (const hold of [false, true]) {
    const live = await fixture(hold);
    const socket = connect(live.port, '127.0.0.1');
    try {
      await wait(socket, 'connect');
      const childSeen = wait(live.child, 'upgrade');
      socket.write(`GET ${endpoint} HTTP/1.1\r\nHost: 127.0.0.1:${live.port}\r\nOrigin: http://127.0.0.1:${live.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`);
      await childSeen;
      if (!hold) await wait(socket, 'data');
      const ended = wait(socket, 'close');
      live.closeUpgrades(); await ended;
      assert.match(await handshake(live.port), /^HTTP\/1.1 503/);
    } finally { socket.destroy(); await live.close(); }
  }
});


test('an upstream socket failure tears down the paired browser socket', async () => {
  const live = await fixture();
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${live.port}${endpoint}`, { headers: { Origin: `http://127.0.0.1:${live.port}` } });
    await wait(ws, 'open');
    const closed = wait(ws, 'close');
    for (const socket of live.sockets) socket.destroy();
    await closed;
  } finally { await live.close(); }
});
