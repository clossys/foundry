// R-DS-ONLY fixture for check-rendered-provenance (live): a stand-in Studio that renders one
// hand-rolled element with no generated provenance marker on every route. The check must fail on it.
//   node serve.mjs <out dir>   writes the listening port to <out dir>/port; exits after 300s.
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const page = '<!doctype html><html><head><meta charset="utf-8"><title>fixture</title></head><body><main id="studio-main"><div class="p-4 rounded-xl" id="hand-rolled">hand-rolled view</div></main></body></html>';
const server = createServer((request, response) => {
  if (request.url === '/api/health') { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"ok":true,"studio":"ready"}'); return; }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(page);
});
server.listen(0, '127.0.0.1', () => writeFileSync(join(process.argv[2], 'port'), String(server.address().port)));
setTimeout(() => server.close(() => process.exit(0)), 300_000).unref();
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => process.exit(0));
