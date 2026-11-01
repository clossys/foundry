import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
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
  it.each(['{ malformed JSON', 'null'])('keeps every Designer row when the pinned candidate is %s', bytes => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'gallery-designer-')));
    try {
      const wanted = ['components.empty', 'components.bad', 'components.healthy', 'components.absent'];
      const ia: IaDoc = { schema: 'clossys.ia/1', source: 'synthetic-test-only#gallery-malformed', extensions: [], nodes: [{ id: 'components', label: 'Components', children: [{ id: 'controls', label: 'Controls', slots: wanted }] }] };
      mkdirSync(join(root, 'agents/designer'), { recursive: true });
      writeFileSync(join(root, 'agents/designer/ia.json'), JSON.stringify(ia));
      for (const id of wanted.slice(0, -1)) {
        const dir = join(root, 'agents/designer/components/controls', id);
        mkdirSync(join(dir, 'candidates'), { recursive: true });
        writeFileSync(join(dir, 'slot.json'), JSON.stringify({
          schema: 'clossys.slot/1', id, agent: 'designer', ia: slotPositions('designer', ia).get(id)!,
          kind: 'element', contract: {}, inputs: [], uses: [],
        } satisfies SlotDoc));
        if (id === 'components.empty') continue;
        const content = id === 'components.bad' ? bytes : JSON.stringify({ name: 'healthy' });
        writeFileSync(join(dir, 'candidates/element-v1.json'), content);
        writeFileSync(join(dir, 'pin.json'), JSON.stringify({ candidate: 'element-v1.json', sha256: sha256Hex(content), pinnedBy: 'owner:synthetic-test-only:gallery-malformed', at: '2026-01-01T00:00:00Z' }));
        if (id === 'components.bad') writeFileSync(join(dir, 'candidates/element-v2.json'), JSON.stringify({ name: 'newer' }));
      }
      const gallery = slotGallery(root, 'designer');
      expect(gallery.count).toBe(wanted.length);
      expect(ids(gallery.sections)).toEqual(wanted);
      const cards = gallery.sections.flatMap(section => section.cards);
      expect(cards[0]).toMatchObject({ id: wanted[0], status: 'missing', emptyState: 'No candidate', records: 0 });
      expect(cards[1]).toMatchObject({ id: wanted[1], status: 'failing', candidate: 'element-v1.json', version: 1, records: 0 });
      expect(cards[1]!.element).toBeUndefined();
      expect(cards[1]!.specimen).toBeUndefined();
      expect(cards[1]!.specimenUrl).toBeUndefined();
      expect(cards[2]).toMatchObject({ id: wanted[2], status: 'active', element: 'healthy', specimen: 'components.healthy/healthy', records: 1 });
      expect(cards[3]).toMatchObject({ id: wanted[3], status: 'failing', emptyState: 'No candidate', records: 0 });
      const designer = designerGallery(root);
      expect(designer.count).toBe(wanted.length);
      expect(ids(designer.sections)).toEqual(wanted);
      expect(designer.sections.flatMap(section => section.cards)[1]).toMatchObject({ status: 'failing', pinned: false, options: [], candidate: 'element-v1.json', version: 1 });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('keeps unpinned Designer slots visible without a specimen and previews only the intact native pin', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'gallery-designer-pin-')));
    try {
      const wanted = ['components.empty', 'components.example'];
      const ia: IaDoc = { schema: 'clossys.ia/1', source: 'synthetic-test-only#designer-pin', extensions: [], nodes: [{ id: 'components', label: 'Components', children: [{ id: 'controls', label: 'Controls', slots: wanted }] }] };
      mkdirSync(join(root, 'agents/designer'), { recursive: true });
      writeFileSync(join(root, 'agents/designer/ia.json'), JSON.stringify(ia));
      for (const id of wanted) {
        const dir = join(root, 'agents/designer/components/controls', id);
        mkdirSync(join(dir, 'candidates'), { recursive: true });
        writeFileSync(join(dir, 'slot.json'), JSON.stringify({ schema: 'clossys.slot/1', id, agent: 'designer', ia: slotPositions('designer', ia).get(id)!, kind: 'element', contract: {}, inputs: [], uses: [] } satisfies SlotDoc));
      }
      const dir = join(root, 'agents/designer/components/controls/components.example');
      const content = JSON.stringify({ name: 'example', type: 'registry:component', files: [{ path: 'index.tsx', type: 'registry:component', content: 'export default function Example() { return null; }' }], meta: { source: { kind: 'original', ref: [] } } });
      writeFileSync(join(dir, 'candidates/example-v1.json'), content);
      writeFileSync(join(dir, 'candidates/example-v2.json'), content.replace('"example"', '"newer"'));
      const pin = { candidate: 'example-v1.json', sha256: sha256Hex(content), pinnedBy: 'owner:synthetic-test-only:designer-pin', at: '2026-01-01T00:00:00Z' };
      const layers = () => designerGalleryLayers({ state: 'ready', ...designerGallery(root) }, 'light', noRoutes);
      const assertNoPreview = (noPin: boolean) => {
        const cards = slotGallery(root, 'designer').sections.flatMap(section => section.cards);
        expect(cards.map(card => card.id)).toEqual(wanted);
        expect(cards[0]).toMatchObject({ emptyState: 'No candidate', records: 0 });
        if (noPin) expect(cards[1]).toMatchObject({ emptyState: 'No pin', status: 'draft', records: 1 });
        expect(cards[1]!.element).toBeUndefined();
        expect(cards[1]!.specimen).toBeUndefined();
        expect(cards[1]!.specimenUrl).toBeUndefined();
        const projected = layers().flatMap(layer => layer.groups.flatMap(group => group.cards));
        expect(projected.map(card => card.key)).toEqual(wanted);
        expect(projected[1]!.specimen).toBeUndefined();
        if (noPin) expect(projected[1]!.statusLabel).toBe('No pin');
      };
      assertNoPreview(true);
      writeFileSync(join(dir, 'pin.json'), JSON.stringify(pin));
      const pinned = slotGallery(root, 'designer').sections.flatMap(section => section.cards)[1]!;
      expect(pinned).toMatchObject({ candidate: 'example-v1.json', version: 1, status: 'active', element: 'example', specimen: 'components.example/example' });
      const specimen = layers().flatMap(layer => layer.groups.flatMap(group => group.cards))[1]!.specimen!;
      expect(specimen).toMatchObject({ kind: 'viewports', specimens: [{ light: '/__specimen?element=components.example%2Fexample&theme=light&width=1280&v=1' }] });
      expect(renderToStaticMarkup(createElement(SpecimenContent, { specimen }))).toContain('components.example%2Fexample');
      unlinkSync(join(dir, 'pin.json'));
      assertNoPreview(true);
      for (const invalid of [{}, { ...pin, sha256: '0'.repeat(64) }, { ...pin, candidate: 'absent-v1.json' }]) {
        writeFileSync(join(dir, 'pin.json'), JSON.stringify(invalid));
        assertNoPreview(!('candidate' in invalid));
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

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

  it('keeps Writer slots in IA order but advertises a record iframe only for the intact pin', () => {
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
      const projected = () => agentGalleryLayers({ state: 'ready', agent: 'writer', ...slotGallery(root, 'writer') }, noRoutes).flatMap(layer => layer.groups.flatMap(group => group.cards));
      const noFrame = () => {
        expect(cards().map(card => card.id)).toEqual(expected(root, 'writer'));
        expect(projected().map(card => card.key)).toEqual(expected(root, 'writer'));
        expect(cards()[0]!.specimenUrl).toBeUndefined();
        expect(projected()[0]!.specimen).toBeUndefined();
      };
      expect(cards()).toMatchObject([{ id: 'strings.label', emptyState: 'No candidate', records: 0 }]);
      noFrame();
      mkdirSync(join(dir, 'candidates'));
      const content = serializeFrontmatter({ slot: 'strings.label', locales: ['en'], source: { kind: 'original', ref: [] } }, '## en\n### greeting\n<!-- {"id":"greeting","bindings":[]} -->\nHello <script> & welcome\n');
      writeFileSync(join(dir, 'candidates/label-v1.md'), content);
      expect(cards()).toMatchObject([{ emptyState: 'No pin', candidate: 'label-v1.md', version: 1, records: 1 }]);
      expect(recordSpecimenInput(root, 'writer', 'strings.label')?.rows).toEqual([{ key: '0', label: 'en: greeting', text: 'Hello <script> & welcome' }]);
      writeFileSync(join(dir, 'candidates/label-v2.md'), content.replace('Hello <script> & welcome', 'Newer draft'));
      expect(cards()[0]).toMatchObject({ version: 2, candidate: 'label-v2.md', emptyState: 'No pin' });
      noFrame();
      expect(projected()[0]!.statusLabel).toBe('No pin');
      const pin = { candidate: 'label-v1.md', sha256: sha256Hex(content), pinnedBy: 'owner:synthetic-test-only:gallery-pin', at: '2026-01-01T00:00:00Z' };
      writeFileSync(join(dir, 'pin.json'), JSON.stringify(pin));
      expect(cards()[0]).toMatchObject({ status: 'active', candidate: 'label-v1.md', version: 1 });
      expect(recordSpecimenInput(root, 'writer', 'strings.label')?.rows[0]?.text).toBe('Hello <script> & welcome');
      expect(cards()[0]!.emptyState).toBeUndefined();
      expect(cards()[0]!.specimenUrl).toBe('/__specimen?agent=writer&slot=strings.label&candidate=label-v1.md');
      const specimen = projected()[0]!.specimen!;
      expect(specimen).toMatchObject({ kind: 'viewports', specimens: [{ light: cards()[0]!.specimenUrl }] });
      expect(renderToStaticMarkup(createElement(SpecimenContent, { specimen }))).toContain('candidate=label-v1.md');
      for (const invalid of [{}, { ...pin, candidate: 'absent-v1.md' }]) {
        writeFileSync(join(dir, 'pin.json'), JSON.stringify(invalid));
        noFrame();
      }
      // Explicit unpinned record rendering remains available to its existing consumers.
      writeFileSync(join(dir, 'pin.json'), '{}');
      expect(recordSpecimenInput(root, 'writer', 'strings.label', 'label-v2.md')?.rows[0]?.text).toBe('Newer draft');
      writeFileSync(join(dir, 'pin.json'), JSON.stringify(pin));
      writeFileSync(join(dir, 'candidates/label-v1.md'), `${content}changed`);
      expect(cards()[0]).toMatchObject({ status: 'failing', records: 0 });
      noFrame();
      expect(() => recordSpecimenInput(root, 'writer', 'strings.label')).toThrow('hash mismatch');
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
        writeFileSync(join(dir, 'candidates/record-v1.md'), serializeFrontmatter(fields, body));
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
