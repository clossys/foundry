import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { serializeFrontmatter, slotPositions, type IaDoc, type SlotDoc } from '../records/slot-model/index.js';
import { startProducerServer, type ProducerServer } from './index.js';
import { specimenFramePage, SPECIMEN_FRAME_CSP } from './specimen-frame.js';
import { RECORD_SPECIMEN_THEME_HEADER, RECORD_SPECIMEN_WIDTH_HEADER } from './record-specimens.js';

let root: string | undefined;
let server: ProducerServer | undefined;
afterEach(async () => { await server?.close(); if (root) await rm(root, { recursive: true, force: true }); });

it('dispatches record specimens through the running Producer host and exposes only native read-only inputs', async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'producer-record-mount-')));
  for (const [agent, id, body] of [
    ['director', 'context.market.size', '## Direction\nMeasure demand\n## Because\nEvidence\n## Watch\nSignals'],
    ['writer', 'strings.label', '## en\n### greeting\n<!-- {"id":"greeting","bindings":[]} -->\nHello <script>'],
  ] as const) {
    const dir = join(root, 'clossys', 'agents', agent, id);
    await mkdir(join(dir, 'candidates'), { recursive: true });
    const ia: IaDoc = { schema: 'clossys.ia/1', source: 'synthetic-test-only#record-mount', extensions: [], nodes: [{ id: 'one', label: 'One', children: [{ id: 'two', label: 'Two', slots: [id] }] }] };
    await writeFile(join(root, 'clossys', 'agents', agent, 'ia.json'), JSON.stringify(ia));
    await writeFile(join(dir, 'slot.json'), JSON.stringify({ schema: 'clossys.slot/1', id, agent, ia: slotPositions(agent, ia).get(id)!, kind: agent === 'director' ? 'brief' : 'strings', contract: {}, inputs: [], uses: [] } satisfies SlotDoc));
    const bytes = serializeFrontmatter({ slot: id, source: { kind: 'original', ref: [] }, ...(agent === 'director' ? { feeds: [], functions: [] } : { locales: ['en'] }) }, body);
    await writeFile(join(dir, 'candidates/record-v1.md'), bytes);
    if (agent === 'director') await writeFile(join(dir, 'pin.json'), JSON.stringify({
      candidate: 'record-v1.md', sha256: createHash('sha256').update(bytes).digest('hex'),
      pinnedBy: 'owner:synthetic-test-only:director-record-mount', at: '2026-01-01T00:00:00Z',
    }));
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
      expect(document.headers.get('content-security-policy')).toBe(SPECIMEN_FRAME_CSP);
      const inner = `/__specimen?${new URLSearchParams({ agent: agent!, slot: id!, candidate: 'record-v1.md', width: String(width), theme, view: 'record' })}`;
      const html = await document.text();
      expect(html).toBe(specimenFramePage({ src: inner, width, title: 'Record specimen' }));
      expect(html).toContain('clossys:specimen-size');
      const content = await fetch(`${server.url}${inner}`, { headers: { [RECORD_SPECIMEN_THEME_HEADER]: 'forged', [RECORD_SPECIMEN_WIDTH_HEADER]: '999' } });
      expect(content.status).toBe(200);
      expect(await content.json()).toMatchObject({ studio: true, path: inner, headers: { [RECORD_SPECIMEN_THEME_HEADER]: theme, [RECORD_SPECIMEN_WIDTH_HEADER]: String(width) } });
    }
    const head = await fetch(`${server.url}/__specimen?agent=${agent}&slot=${id}`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-security-policy')).toBe(SPECIMEN_FRAME_CSP);
    expect(await head.text()).toBe('');
    const canonical = await fetch(`${server.url}/__specimen?agent=${agent}&slot=${id}&src=https://example.test&width=999&theme=invalid`);
    const canonicalHtml = await canonical.text();
    expect(canonicalHtml).toContain('data-width="1280"');
    expect(canonicalHtml).toContain('theme=light');
    expect(canonicalHtml).not.toContain('example.test');
    expect((await fetch(`${server.url}/__specimen?agent=${agent}&slot=${id}&view=record`, { method: 'HEAD' })).status).toBe(200);
    expect((await fetch(`${server.url}/__specimen?agent=${agent}&slot=${id}&view=record`, { method: 'OPTIONS' })).status).toBe(405);
    expect((await fetch(`${server.url}/__specimen?agent=${agent}&slot=${id}`, { method: 'OPTIONS' })).status).toBe(405);
    expect((await fetch(`${server.url}${api}`, { method: 'OPTIONS' })).status).toBe(405);
    expect((await fetch(`${server.url}${api}`, { headers: { Origin: 'https://example.test' } })).status).toBe(403);
  }
  const ordinary = await fetch(`${server.url}/studio`, { headers: { [RECORD_SPECIMEN_THEME_HEADER]: 'dark', [RECORD_SPECIMEN_WIDTH_HEADER]: '375' } });
  const forwarded = await ordinary.json() as { headers: Record<string, string> };
  expect(forwarded.headers[RECORD_SPECIMEN_THEME_HEADER]).toBeUndefined();
  expect(forwarded.headers[RECORD_SPECIMEN_WIDTH_HEADER]).toBeUndefined();
  for (const view of ['', '&view=record']) {
    const path = `/__specimen?agent=director&slot=context.market.size${view}`;
    expect((await fetch(`${server.url}${path}`, { headers: { Origin: 'https://example.test' } })).status).toBe(403);
    const invalidHost = await new Promise<number>((resolve, reject) => {
      const req = request(`${server!.url}${path}`, { headers: { Host: 'example.test' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode!)); });
      req.on('error', reject); req.end();
    });
    expect(invalidHost).toBe(403);
  }
}, 20_000);
