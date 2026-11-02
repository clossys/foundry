import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { agentGallery } from './agent-library.js';
import { designerGallery } from './designer-library.js';
import { recordSpecimens } from './record-specimens.js';
import { recordSpecimenInput, slotGallery } from './slot-gallery.js';
import { serializeFrontmatter, slotPositions, validateCandidate, type IaDoc, type SlotDoc, type SlotKind } from '../records/slot-model/index.js';
import * as slotReader from '../records/slots.js';
import { sha256Hex } from '../records/hash.js';
import { agentGalleryLayers } from '../../studio/lib/agent-library';
import { designerGalleryLayers } from '../../studio/lib/designer-library';
import { SpecimenContent } from '../../studio/sections/studio-specimen';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const consumer = join(repo, 'clossys');
const noRoutes = { gallery: () => undefined, leaf: () => undefined };
const ids = (sections: readonly { cards: readonly { id?: string; slot?: string }[] }[]) => sections.flatMap(section => section.cards.map(card => card.id ?? card.slot));
const expected = (root: string, agent: string) => (JSON.parse(readFileSync(join(root, 'agents', agent, 'ia.json'), 'utf8')) as IaDoc).nodes.flatMap(node => node.children.flatMap(child => child.slots));

function writerRecordFixture(body: string, locales: readonly string[] = ['en']) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'writer-native-specimen-')));
  const id = 'strings.label', candidate = 'record-v1.md';
  const ia: IaDoc = { schema: 'clossys.ia/1', source: 'synthetic-test-only#native-writer-projection', extensions: [],
    nodes: [{ id: 'strings.copy', label: 'Copy', children: [{ id: 'copy', label: 'Labels', slots: [id] }] }] };
  const dir = join(root, 'agents/writer/strings.copy/copy', id);
  mkdirSync(join(dir, 'candidates'), { recursive: true });
  writeFileSync(join(root, 'agents/writer/ia.json'), JSON.stringify(ia));
  writeFileSync(join(dir, 'slot.json'), JSON.stringify({ schema: 'clossys.slot/1', id, agent: 'writer',
    ia: slotPositions('writer', ia).get(id)!, kind: 'strings', contract: {}, inputs: [], uses: [],
  } satisfies SlotDoc));
  const source = serializeFrontmatter({ slot: id, locales, source: { kind: 'original', ref: [] } }, body);
  writeFileSync(join(dir, 'candidates', candidate), source);
  return { root, id, candidate, dir, source };
}

describe('IA-first gallery data', () => {

  it.each(['director', 'designer', 'writer', 'publisher'] as const)('keeps every %s IA card while rejecting invalid native records and slot metadata', async agent => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'gallery-native-validation-')));
    const consumer = join(root, 'clossys');
    try {
      const wanted = ['records.healthy', 'records.bad-candidate', 'records.foreign-id', 'records.foreign-agent', 'records.position-l0', 'records.position-l1', 'records.position-l2', 'records.position-order', 'records.bad-doc', 'records.absent', 'records.empty'];
      const ia: IaDoc = { schema: 'clossys.ia/1', source: 'synthetic-test-only#F3-gallery-validation', extensions: [],
        nodes: [{ id: 'one', label: 'One', children: [{ id: 'two', label: 'Two', slots: wanted }] }] };
      mkdirSync(join(consumer, 'agents', agent), { recursive: true });
      writeFileSync(join(consumer, 'agents', agent, 'ia.json'), JSON.stringify(ia));
      const kind: SlotKind = agent === 'director' ? 'brief' : agent === 'writer' ? 'strings' : agent === 'designer' ? 'element' : 'page';
      const candidate = kind === 'brief' || kind === 'strings' ? 'record-v1.md' : 'record-v1.json';
      for (const id of wanted) {
        if (id === 'records.absent') continue;
        const dir = join(consumer, 'agents', agent, 'one/two', id);
        mkdirSync(join(dir, 'candidates'), { recursive: true });
        const position = slotPositions(agent, ia).get(id)!;
        const doc: SlotDoc = { schema: 'clossys.slot/1', id, agent, ia: position, kind, contract: {}, inputs: [], uses: [] };
        writeFileSync(join(dir, 'slot.json'), JSON.stringify({ ...doc,
          ...(id === 'records.foreign-id' ? { id: 'foreign.slot' } : {}),
          ...(id === 'records.foreign-agent' ? { agent: agent === 'writer' ? 'director' : 'writer' } : {}),
          ...(id.startsWith('records.position-') ? { ia: { ...position, [id.slice('records.position-'.length)]: id.endsWith('-order') ? position.order + 1 : 'foreign' } } : {}),
          ...(id === 'records.bad-doc' ? { schema: 'invalid' } : {}),
        }));
        if (id === 'records.empty') continue;
        const source = { kind: 'original', ref: [] };
        const valid = kind === 'brief' ? serializeFrontmatter({ slot: id, source, feeds: [], functions: [] }, '## Direction\nDemand\n## Because\nEvidence\n## Watch\nSignals')
          : kind === 'strings' ? serializeFrontmatter({ slot: id, source, locales: ['en'] }, '## en\n### greeting\n<!-- {"id":"greeting","bindings":[]} -->\nHello\n')
          : JSON.stringify(kind === 'element' ? { name: 'record', type: 'registry:component', files: [{ path: 'index.tsx', type: 'registry:component', content: 'export default function Example() { return null; }' }], meta: { source } }
            : { schema: 'clossys.page/1', title: 'Example', path: '/', frame: null, sections: [], copy: {}, meta: { source } });
        expect(validateCandidate(kind, id, candidate, valid)).toEqual([]);
        const bytes = id === 'records.bad-candidate' ? 'not a native candidate' : valid;
        writeFileSync(join(dir, 'candidates', candidate), bytes);
        writeFileSync(join(dir, 'pin.json'), JSON.stringify({ candidate, sha256: sha256Hex(bytes), pinnedBy: 'owner:synthetic-test-only:F3-gallery-validation', at: '2026-01-01T00:00:00Z' }));
      }
      const gallery = slotGallery(consumer, agent);
      expect(ids(gallery.sections)).toEqual(wanted);
      expect(gallery.count).toBe(wanted.length);
      const cards = gallery.sections.flatMap(section => section.cards);
      expect(cards[0]).toMatchObject({ status: 'active', records: 1, candidate, version: 1 });
      for (const card of cards.slice(1, -1)) {
        expect(card).toMatchObject({ status: 'failing', records: 0 });
        expect(card.specimen).toBeUndefined();
        expect(card.specimenUrl).toBeUndefined();
      }
      expect(cards.at(-1)).toMatchObject({ status: 'missing', records: 0, emptyState: 'No candidate' });
      const projected = agent === 'designer' ? designerGallery(consumer) : await agentGallery(root, agent);
      expect(ids(projected!.sections)).toEqual(wanted);
      const layers = agent === 'designer' ? designerGalleryLayers({ state: 'ready', ...projected! } as never, 'light', noRoutes)
        : agentGalleryLayers({ state: 'ready', ...projected! } as never, noRoutes);
      expect(layers.flatMap(layer => layer.groups.flatMap(group => group.cards.map(card => card.key)))).toEqual(wanted);
      for (const method of ['readSlot', 'readCandidate'] as const) for (const code of ['EACCES', 'EPERM']) {
        const error = Object.assign(new Error('Candidate cannot be read'), { code });
        const read = vi.spyOn(slotReader, method).mockImplementationOnce(() => { throw error; });
        try { expect(() => slotGallery(consumer, agent)).toThrow(error); } finally { read.mockRestore(); }
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('preserves native Writer empty text, escaped structural lines, locale order and full textless payloads', async () => {
    const context = '  exact.context  ';
    const payload = { id: 'payload', context: 'payload.context', parts: { heading: 'Native payload' }, state: false };
    const body = [
      '## en', '### empty.context', '<!-- {"id":"shared","bindings":[]} -->', '',
      `### ${context}`, '<!-- {"id":"literal","bindings":[]} -->', '', '  first  ',
      '\\## literal locale', '\\### literal context', '\\<!-- literal comment -->', '\\\\one slash',
      '\\```json', '{"literal":true}', '```', '', '',
      '### payload.context', '<!-- {"id":"payload","bindings":[],"metadataOnly":true} -->',
      '```json', JSON.stringify(payload), '```', '',
      '## ar', '### arabic.context', '<!-- {"id":"shared","bindings":[]} -->', 'لغة', '',
    ].join('\n').replaceAll('\n', '\r\n');
    const f = writerRecordFixture(body, ['en', 'ar']);
    try {
      const input = recordSpecimenInput(f.root, 'writer', f.id, f.candidate)!;
      expect(input.rows).toEqual([
        { key: '0', label: 'en: empty.context', text: '' },
        { key: '1', label: `en: ${context}`, text: '\n  first  \n## literal locale\n### literal context\n<!-- literal comment -->\n\\one slash\n```json\n{"literal":true}\n```\n' },
        { key: '2', label: 'en: payload.context', text: JSON.stringify({ id: 'payload', metadataOnly: true, context: 'payload.context', parts: payload.parts, state: false }) },
        { key: '3', label: 'ar: arabic.context', text: 'لغة' },
      ]);
      expect(JSON.parse(input.rows[2]!.text)).not.toHaveProperty('text');
      const render = (value: NonNullable<ReturnType<typeof recordSpecimenInput>>) => renderToStaticMarkup(createElement(SpecimenContent, { specimen: value }));
      const mount = recordSpecimens({ consumer: f.root, render });
      let code = 0, html = '';
      const response = { writeHead(status: number) { code = status; }, end(value?: string) { html = value ?? ''; } } as ServerResponse;
      expect(await mount.handle({ method: 'GET', url: `/__specimen?agent=writer&slot=${f.id}&candidate=${f.candidate}` } as IncomingMessage, response, '/__specimen')).toBe(true);
      expect(code).toBe(200);
      expect(html).toBe(render(input));
      expect(readFileSync(join(f.dir, 'candidates', f.candidate), 'utf8')).toBe(f.source);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it.each([
    ['invalid metadata', '## en\n### first\n<!-- {"id":42,"bindings":[]} -->\ntext\n'],
    ['duplicate id', '## en\n### first\n<!-- {"id":"same","bindings":[]} -->\nfirst\n\n### second\n<!-- {"id":"same","bindings":[]} -->\nsecond\n'],
  ])('refuses native Writer %s without partial projection', (_problem, body) => {
    const f = writerRecordFixture(body);
    try {
      let projected: ReturnType<typeof recordSpecimenInput>;
      expect(() => { projected = recordSpecimenInput(f.root, 'writer', f.id, f.candidate); }).toThrow(/Writer slot body/);
      expect(projected).toBeUndefined();
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

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
        const content = id === 'components.bad' ? bytes : JSON.stringify({ name: 'element', type: 'registry:component', files: [{ path: 'index.tsx', type: 'registry:component', content: 'export default function Example() { return null; }' }], meta: { source: { kind: 'original', ref: [] } } });
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
      expect(cards[2]).toMatchObject({ id: wanted[2], status: 'active', element: 'element', specimen: 'components.healthy/element', records: 1 });
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
      writeFileSync(join(dir, 'candidates/example-v2.json'), content.replace('return null', 'return <div />'));
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
