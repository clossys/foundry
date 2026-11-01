import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { agentGallery } from './agent-library.js';
import { designerGallery } from './designer-library.js';
import { recordSpecimens } from './record-specimens.js';
import { recordSpecimenInput, slotGallery } from './slot-gallery.js';
import { serializeFrontmatter, slotPositions, type IaDoc, type SlotDoc } from '../records/slot-model/index.js';
import { sha256Hex } from '../records/hash.js';
import { agentGalleryLayers } from '../../studio/lib/agent-library';
import { designerGalleryLayers } from '../../studio/lib/designer-library';
import { SpecimenContent } from '../../studio/sections/studio-specimen';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const consumer = join(repo, 'clossys');
const noRoutes = { gallery: () => undefined, leaf: () => undefined };
const ids = (sections: readonly { cards: readonly { id?: string; slot?: string }[] }[]) => sections.flatMap(section => section.cards.map(card => card.id ?? card.slot));
const expected = (root: string, agent: string) => (JSON.parse(readFileSync(join(root, 'agents', agent, 'ia.json'), 'utf8')) as IaDoc).nodes.flatMap(node => node.children.flatMap(child => child.slots));

describe('IA-first gallery data', () => {
  it('projects all source IA entries, in exact order, through the real server and client adapters', async () => {
    let total = 0;
    for (const agent of ['director', 'designer', 'writer', 'publisher'] as const) {
      const wanted = expected(consumer, agent);
      const gallery = agent === 'designer' ? designerGallery(consumer) : await agentGallery(repo, agent);
      expect(gallery).toBeDefined();
      expect(ids(gallery!.sections)).toEqual(wanted);
      expect(gallery!.count).toBe(wanted.length);
      const layers = agent === 'designer'
        ? designerGalleryLayers({ state: 'ready', ...gallery! } as never, 'light', noRoutes)
        : agentGalleryLayers({ state: 'ready', ...gallery! } as never, noRoutes);
      expect(layers.flatMap(layer => layer.groups.flatMap(group => group.cards.map(card => card.key)))).toEqual(wanted);
      total += gallery!.count;
    }
    expect(total).toBe(['director', 'designer', 'writer', 'publisher'].reduce((sum, agent) => sum + expected(consumer, agent).length, 0));
  });

  it('keeps absent candidates and unpinned candidates distinct, without a mapped detail route', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'gallery-slots-')));
    try {
      const dir = join(root, 'agents/writer/strings.copy/copy/strings.label');
      mkdirSync(dir, { recursive: true });
      const ia: IaDoc = { schema: 'clossys.ia/1', source: 'synthetic-test-only#gallery-pin', extensions: [], nodes: [{ id: 'strings.copy', label: 'Copy', children: [{ id: 'copy', label: 'Labels', slots: ['strings.label'] }] }] };
      writeFileSync(join(root, 'agents/writer/ia.json'), JSON.stringify(ia));
      writeFileSync(join(dir, 'slot.json'), JSON.stringify({
        schema: 'clossys.slot/1', id: 'strings.label', agent: 'writer',
        ia: slotPositions('writer', ia).get('strings.label')!, kind: 'strings', contract: {}, inputs: [], uses: [],
      } satisfies SlotDoc));
      const cards = () => slotGallery(root, 'writer').sections.flatMap(section => section.cards);
      expect(cards()).toMatchObject([{ id: 'strings.label', emptyState: 'No candidate', records: 0 }]);
      mkdirSync(join(dir, 'candidates'));
      const content = serializeFrontmatter({ slot: 'strings.label', locales: ['en'], source: { kind: 'original', ref: [] } }, '## en\n### greeting\n<!-- {"id":"greeting","bindings":[]} -->\nHello <script> & welcome\n');
      writeFileSync(join(dir, 'candidates/label-v1.md'), content);
      expect(cards()).toMatchObject([{ emptyState: 'No pin', candidate: 'label-v1.md', version: 1, records: 1 }]);
      expect(recordSpecimenInput(root, 'writer', 'strings.label')?.rows).toEqual([{ key: '0', label: 'en: greeting', text: 'Hello <script> & welcome' }]);
      writeFileSync(join(dir, 'candidates/label-v2.md'), content.replace('Hello <script> & welcome', 'Newer draft'));
      expect(cards()[0]).toMatchObject({ version: 2, candidate: 'label-v2.md', emptyState: 'No pin' });
      writeFileSync(join(dir, 'pin.json'), JSON.stringify({ candidate: 'label-v1.md', sha256: sha256Hex(content), pinnedBy: 'owner:synthetic-test-only:gallery-pin', at: '2026-01-01T00:00:00Z' }));
      expect(cards()[0]).toMatchObject({ status: 'active', candidate: 'label-v1.md', version: 1 });
      expect(recordSpecimenInput(root, 'writer', 'strings.label')?.rows[0]?.text).toBe('Hello <script> & welcome');
      expect(cards()[0]!.emptyState).toBeUndefined();
      writeFileSync(join(dir, 'candidates/label-v1.md'), `${content}changed`);
      expect(cards()[0]).toMatchObject({ status: 'failing', records: 0 });
      expect(() => recordSpecimenInput(root, 'writer', 'strings.label')).toThrow('hash mismatch');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('serves only the valid pinned Director brief, rejecting drafts, foreign slots and invalid native records', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'director-specimen-pin-')));
    try {
      const id = 'context.market.size', name = 'record-v1.md';
      const dir = join(root, `agents/director/one/two/${id}`);
      mkdirSync(join(dir, 'candidates'), { recursive: true });
      const ia: IaDoc = { schema: 'clossys.ia/1', source: 'synthetic-test-only#director-pin', extensions: [], nodes: [{ id: 'one', label: 'One', children: [{ id: 'two', label: 'Two', slots: [id] }] }] };
      writeFileSync(join(root, 'agents/director/ia.json'), JSON.stringify(ia));
      const doc: SlotDoc = { schema: 'clossys.slot/1', id, agent: 'director', ia: slotPositions('director', ia).get(id)!, kind: 'brief', contract: {}, inputs: [], uses: [] };
      writeFileSync(join(dir, 'slot.json'), JSON.stringify(doc));
      const fields = { slot: id, source: { kind: 'original', ref: [] }, feeds: [], functions: [] };
      const body = '## Direction\nPinned demand\n## Because\nEvidence\n## Watch\nSignals';
      const content = serializeFrontmatter(fields, body);
      const pin = { candidate: name, sha256: sha256Hex(content), pinnedBy: 'owner:synthetic-test-only:director-pin', at: '2026-01-01T00:00:00Z' };
      writeFileSync(join(dir, 'candidates', name), content);
      writeFileSync(join(dir, 'candidates/record-v2.md'), serializeFrontmatter(fields, body.replace('Pinned demand', 'Newer draft')));
      const render = (input: NonNullable<ReturnType<typeof recordSpecimenInput>>) => renderToStaticMarkup(createElement(SpecimenContent, { specimen: input }));
      const mount = recordSpecimens({ consumer: root, render });
      const request = async (query = `slot=${id}`) => {
        let code = 0, html = '';
        const response = { writeHead(status: number) { code = status; }, end(value?: string) { html = value ?? ''; } } as ServerResponse;
        expect(await mount.handle({ method: 'GET', url: `/__specimen?agent=director&${query}` } as IncomingMessage, response, '/__specimen')).toBe(true);
        return { code, html };
      };
      expect((await request()).code).toBe(404);
      const card = () => slotGallery(root, 'director').sections.flatMap(section => section.cards)[0]!;
      expect(card()).toMatchObject({ emptyState: 'No pin', records: 1 });
      expect(card().specimenUrl).toBeUndefined();
      writeFileSync(join(dir, 'pin.json'), JSON.stringify(pin));
      expect(await request()).toEqual({ code: 200, html: render(recordSpecimenInput(root, 'director', id)!) });
      expect((await request()).html).toContain('Pinned demand');
      expect((await request()).html).not.toContain('Newer draft');
      expect(card().specimenUrl).toContain('candidate=record-v1.md');
      for (const query of [`slot=${id}&candidate=record-v2.md`, `slot=${id}&candidate=absent-v1.md`, 'slot=foreign.slot']) expect((await request(query)).code).toBe(404);
      for (const change of [
        () => writeFileSync(join(dir, 'pin.json'), JSON.stringify({ ...pin, candidate: 'absent-v1.md' })),
        () => writeFileSync(join(dir, 'pin.json'), JSON.stringify({ ...pin, sha256: '0'.repeat(64) })),
        () => writeFileSync(join(dir, 'pin.json'), '{}'),
        () => writeFileSync(join(dir, 'slot.json'), JSON.stringify({ ...doc, id: 'foreign.slot' })),
        () => writeFileSync(join(dir, 'slot.json'), JSON.stringify({ ...doc, ia: { ...doc.ia, order: doc.ia.order + 1 } })),
        ...[serializeFrontmatter({ ...fields, slot: 'foreign.slot' }, body), serializeFrontmatter(fields, '## Direction\nInvalid brief')].map(bytes => () => {
          writeFileSync(join(dir, 'candidates', name), bytes);
          writeFileSync(join(dir, 'pin.json'), JSON.stringify({ ...pin, sha256: sha256Hex(bytes) }));
        }),
      ]) {
        writeFileSync(join(dir, 'slot.json'), JSON.stringify(doc));
        writeFileSync(join(dir, 'candidates', name), content);
        writeFileSync(join(dir, 'pin.json'), JSON.stringify(pin));
        change();
        expect((await request()).code).toBe(404);
        expect(card().specimenUrl).toBeUndefined();
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('binds Director and Writer fixtures to the existing shared record specimen renderer', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'record-specimens-')));
    try {
      for (const [agent, id, body] of [
        ['director', 'context.market.size', '## Direction\nMeasure demand\n## Because\nEvidence\n## Watch\nSignals'],
        ['writer', 'strings.label', '## en\n### greeting\n<!-- {"id":"greeting","bindings":[]} -->\nHello <script>'],
      ] as const) {
        const dir = join(root, `agents/${agent}/one/two/${id}`);
        mkdirSync(join(dir, 'candidates'), { recursive: true });
        const ia: IaDoc = { schema: 'clossys.ia/1', source: `synthetic-test-only#${agent}-specimen`, extensions: [], nodes: [{ id: 'one', label: 'One', children: [{ id: 'two', label: 'Two', slots: [id] }] }] };
        writeFileSync(join(root, `agents/${agent}/ia.json`), JSON.stringify(ia));
        writeFileSync(join(dir, 'slot.json'), JSON.stringify({
          schema: 'clossys.slot/1', id, agent, ia: slotPositions(agent, ia).get(id)!,
          kind: agent === 'director' ? 'brief' : 'strings', contract: {}, inputs: [], uses: [],
        } satisfies SlotDoc));
        const fields = { slot: id, source: { kind: 'original', ref: [] },
          ...(agent === 'director' ? { feeds: [], functions: [] } : { locales: ['en'] }) };
        const content = serializeFrontmatter(fields, body);
        writeFileSync(join(dir, 'candidates/record-v1.md'), content);
        if (agent === 'director') writeFileSync(join(dir, 'pin.json'), JSON.stringify({ candidate: 'record-v1.md', sha256: sha256Hex(content), pinnedBy: 'owner:synthetic-test-only:specimen', at: '2026-01-01T00:00:00Z' }));
        const input = recordSpecimenInput(root, agent, id)!;
        const html = renderToStaticMarkup(createElement(SpecimenContent, { specimen: input }));
        expect(html).toContain('<table');
        expect(html).toContain(agent === 'director' ? 'Measure demand' : 'Hello &lt;script&gt;');
        const mount = recordSpecimens({ consumer: root, render: value => renderToStaticMarkup(createElement(SpecimenContent, { specimen: value })) });
        let code = 0; let output = '';
        const response = { writeHead(status: number) { code = status; }, end(value?: string) { output = value ?? ''; } } as ServerResponse;
        expect(await mount.handle({ method: 'GET', url: `/__specimen?agent=${agent}&slot=${id}` } as IncomingMessage, response, '/__specimen')).toBe(true);
        expect(code).toBe(200); expect(output).toBe(html);
        expect(await mount.handle({ method: 'GET', url: '/__specimen?element=sample' } as IncomingMessage, response, '/__specimen')).toBe(false);
        expect(await mount.handle({ method: 'GET', url: `/__specimen?agent=${agent}&slot=${id}&candidate=absent-v1.md` } as IncomingMessage, response, '/__specimen')).toBe(true);
        expect(code).toBe(404);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
