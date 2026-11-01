import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { serializeFrontmatter, slotPositions, type IaDoc, type SlotDoc } from '../records/slot-model/index.js';
import { startProducerServer, type ProducerServer } from './index.js';
import { RECORD_SPECIMEN_THEME_HEADER, RECORD_SPECIMEN_WIDTH_HEADER } from './record-specimens.js';

let root: string | undefined;
let server: ProducerServer | undefined;
afterEach(async () => { await server?.close(); if (root) await rm(root, { recursive: true, force: true }); });

it('dispatches record specimens through the running Producer host and exposes only native read-only inputs', async () => {
  root = await mkdtemp(join(tmpdir(), 'producer-record-mount-'));
  for (const [agent, id, body] of [
    ['director', 'context.market.size', '## Direction\nMeasure demand\n## Because\nEvidence\n## Watch\nSignals'],
    ['writer', 'strings.label', '## en\n### greeting\n<!-- {"id":"greeting","bindings":[]} -->\nHello <script>'],
  ] as const) {
    const dir = join(root, 'clossys', 'agents', agent, 'one/two', id);
    await mkdir(join(dir, 'candidates'), { recursive: true });
    const ia: IaDoc = { schema: 'clossys.ia/1', source: 'synthetic-test-only#record-mount', extensions: [], nodes: [{ id: 'one', label: 'One', children: [{ id: 'two', label: 'Two', slots: [id] }] }] };
    await writeFile(join(root, 'clossys', 'agents', agent, 'ia.json'), JSON.stringify(ia));
    await writeFile(join(dir, 'slot.json'), JSON.stringify({ schema: 'clossys.slot/1', id, agent, ia: slotPositions(agent, ia).get(id)!, kind: agent === 'director' ? 'brief' : 'strings', contract: {}, inputs: [], uses: [] } satisfies SlotDoc));
    await writeFile(join(dir, 'candidates/record-v1.md'), serializeFrontmatter({ slot: id, source: { kind: 'original', ref: [] }, ...(agent === 'director' ? { feeds: [], functions: [] } : { locales: ['en'] }) }, body));
  }
  server = await startProducerServer({ root, port: 0, studioEntry: join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/studio-child.mjs'), handleSignals: false });
  for (const [agent, id, text] of [['director', 'context.market.size', 'Measure demand'], ['writer', 'strings.label', 'Hello <script>']]) {
    const api = `/api/slots/${agent}/${id}/specimen`;
    const response = await fetch(`${server.url}${api}?candidate=record-v1.md`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ kind: 'record', name: id, rows: expect.arrayContaining([expect.objectContaining({ text })]) });
    expect((await fetch(`${server.url}${api}?candidate=absent-v1.md`)).status).toBe(404);
    for (const width of [375, 768, 1280]) for (const theme of ['light', 'dark']) {
      const path = `/__specimen?agent=${agent}&slot=${id}&candidate=record-v1.md&width=${width}&theme=${theme}`;
      const document = await fetch(`${server.url}${path}`, { headers: { [RECORD_SPECIMEN_THEME_HEADER]: 'forged', [RECORD_SPECIMEN_WIDTH_HEADER]: '999' } });
      expect(document.status).toBe(200);
      expect(await document.json()).toMatchObject({ studio: true, path, headers: { [RECORD_SPECIMEN_THEME_HEADER]: theme, [RECORD_SPECIMEN_WIDTH_HEADER]: String(width) } });
    }
    expect((await fetch(`${server.url}/__specimen?agent=${agent}&slot=${id}`, { method: 'HEAD' })).status).toBe(200);
    expect((await fetch(`${server.url}/__specimen?agent=${agent}&slot=${id}`, { method: 'OPTIONS' })).status).toBe(405);
    expect((await fetch(`${server.url}${api}`, { method: 'OPTIONS' })).status).toBe(405);
    expect((await fetch(`${server.url}${api}`, { headers: { Origin: 'https://example.test' } })).status).toBe(403);
  }
  const ordinary = await fetch(`${server.url}/studio`, { headers: { [RECORD_SPECIMEN_THEME_HEADER]: 'dark', [RECORD_SPECIMEN_WIDTH_HEADER]: '375' } });
  const forwarded = await ordinary.json() as { headers: Record<string, string> };
  expect(forwarded.headers[RECORD_SPECIMEN_THEME_HEADER]).toBeUndefined();
  expect(forwarded.headers[RECORD_SPECIMEN_WIDTH_HEADER]).toBeUndefined();
  const invalidHost = await new Promise<number>((resolve, reject) => {
    const req = request(`${server!.url}/__specimen?agent=director&slot=context.market.size`, { headers: { Host: 'example.test' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode!)); });
    req.on('error', reject); req.end();
  });
  expect(invalidHost).toBe(403);
}, 20_000);
