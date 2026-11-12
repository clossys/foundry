import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// These fixtures test gallery data, not names: a synthetic consumer's labels are its ids (the
// pinned-names contract, with no fallback, is slot-labels.test.ts). The real repository keeps its
// real Writer names.
vi.mock('../records/slot-labels.js', async original => {
  const real = await original<typeof import('../records/slot-labels.js')>();
  const synthetic = (consumer: string) => !consumer.startsWith(resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'));
  return {
    ...real,
    slotLabel: (consumer: string, agent: string, id: string) => synthetic(consumer) ? id : real.slotLabel(consumer, agent, id),
    slotLabels: (consumer: string) => synthetic(consumer) ? (_agent: string, id: string) => id : real.slotLabels(consumer),
    iaLabel: (consumer: string, agent: string, id: string) => synthetic(consumer) ? id : real.iaLabel(consumer, agent, id),
  };
});
import { recordLead, recordSpecimenInput, slotGallery } from './slot-gallery.js';
import { slotDetail } from './slot-detail.js';
import { serializeFrontmatter, slotPositions, validateCandidate, type IaDoc, type SlotDoc, type SlotAgent, type SlotKind } from '../records/slot-model/index.js';
import { sha256Hex } from '../records/hash.js';
import { slotSpecimen, specimenHref } from '../../studio/lib/slot-detail';
import { resolveCopy } from '../../studio/lib/studio-copy';
import { SpecimenContent } from '../../studio/sections/studio-specimen';

/** A server record as Studio draws it: its Writer keys resolved, through the detail page's specimen path. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const drawn = (record: any) => { const resolved = resolveCopy(record); return slotSpecimen({ name: resolved.name, description: '', state: { state: 'pinned' }, record: resolved, fallback: resolved }); };

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const consumer = join(repo, 'clossys');
const ids = (sections: readonly { cards: readonly { id?: string; slot?: string }[] }[]) => sections.flatMap(section => section.cards.map(card => card.id ?? card.slot));
/** The record specimen the detail route renders inline for a slot's candidate (only an intact pin carries one). */
const detailRecord = (repo: string, agent: SlotAgent, id: string, candidate?: string) => {
  const detail = slotDetail(repo, agent, id);
  return detail?.candidates.find(row => row.name === (candidate ?? detail.pin?.candidate))?.record;
};
const expected = (root: string, agent: string) => (JSON.parse(readFileSync(join(root, 'agents', agent, 'ia.json'), 'utf8')) as IaDoc).nodes.flatMap(node => node.children.flatMap(child => child.slots));

function writerRecordFixture(body: string, locales: readonly string[] = ['en']) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'writer-native-specimen-')));
  const root = join(repo, 'clossys');
  const id = 'strings.label', candidate = 'record-v1.md';
  const ia: IaDoc = { schema: 'clossys.ia/1', source: 'synthetic-test-only#native-writer-projection', extensions: [],
    nodes: [{ id: 'strings.copy', label: 'Copy', children: [{ id: 'copy', label: 'Labels', slots: [id] }] }] };
  const dir = join(root, 'agents/writer', id);
  mkdirSync(join(dir, 'candidates'), { recursive: true });
  writeFileSync(join(root, 'agents/writer/ia.json'), JSON.stringify(ia));
  writeFileSync(join(dir, 'slot.json'), JSON.stringify({ schema: 'clossys.slot/1', id, agent: 'writer',
    ia: slotPositions('writer', ia).get(id)!, kind: 'strings', contract: {}, inputs: [], uses: [],
  } satisfies SlotDoc));
  const source = serializeFrontmatter({ slot: id, locales, source: { kind: 'original', ref: [] } }, body);
  writeFileSync(join(dir, 'candidates', candidate), source);
  writeFileSync(join(dir, 'pin.json'), JSON.stringify({ candidate, sha256: sha256Hex(source), decidedBy: 'owner:synthetic-test-only:writer-native', basis: 'bulk', at: '2026-01-01T00:00:00Z' }));
  return { repo, root, id, candidate, dir, source };
}

describe('IA-first gallery data', () => {
  it.each([
    ['director', 'brief'], ['writer', 'strings'], ['designer', 'element'], ['publisher', 'page'], ['publisher', 'publication'],
  ] as const)('keeps invalid %s %s rows unresolved through native galleries and client adapters', async (agent: SlotAgent, kind: SlotKind) => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'gallery-native-validation-')));
    const root = join(repo, 'clossys');
    try {
      const wanted = ['example.bad', 'example.healthy'];
      const ia: IaDoc = { schema: 'clossys.ia/1', source: 'synthetic-test-only#gallery-native-validation', extensions: [],
        nodes: [{ id: 'one', label: 'One', children: [{ id: 'two', label: 'Two', slots: wanted }] }] };
      mkdirSync(join(root, 'agents', agent), { recursive: true });
      writeFileSync(join(root, 'agents', agent, 'ia.json'), JSON.stringify(ia));
      const source = { kind: 'original', ref: [] };
      const candidate = kind === 'brief' || kind === 'strings' ? 'record-v1.md' : 'record-v1.json';
      const content = (id: string, provenance: unknown = source, malformed = false) => {
        if (kind === 'brief' || kind === 'strings') return serializeFrontmatter({ slot: id, ...(provenance === undefined ? {} : { source: provenance }),
          ...(kind === 'brief' ? { feeds: [], functions: [] } : { locales: ['en'] }) },
        malformed ? 'Invalid body' : kind === 'brief' ? '## Direction\nDemand\n## Because\nEvidence\n## Watch\nSignals'
          : '## en\n### greeting\n<!-- {"id":"greeting","bindings":[]} -->\nExact text');
        const meta = provenance === undefined ? {} : { source: provenance };
        return JSON.stringify(kind === 'element' ? { name: 'record', type: malformed ? 'invalid' : 'registry:component', files: [{ path: 'index.tsx', type: 'registry:component', content: 'export default function Record() { return null; }' }], meta }
          : kind === 'page' ? { schema: malformed ? 'invalid' : 'clossys.page/1', title: 'Example', path: '/', frame: null, sections: [], copy: {}, meta }
            : { schema: malformed ? 'invalid' : 'clossys.publication/1', format: 'website', entryOrder: [], meta });
      };
      const dirs = wanted.map(id => join(root, 'agents', agent, id));
      const docs = wanted.map(id => ({ schema: 'clossys.slot/1', id, agent, ia: slotPositions(agent, ia).get(id)!, kind, contract: {}, inputs: [], uses: [] } satisfies SlotDoc));
      const pin = (bytes: string) => ({ candidate, sha256: sha256Hex(bytes), decidedBy: 'owner:synthetic-test-only:gallery-validation', basis: 'bulk', at: '2026-01-01T00:00:00Z' });
      const reset = () => wanted.forEach((id, i) => {
        const bytes = content(id);
        expect(validateCandidate(kind, id, candidate, bytes)).toEqual([]);
        mkdirSync(join(dirs[i]!, 'candidates'), { recursive: true });
        writeFileSync(join(dirs[i]!, 'slot.json'), JSON.stringify(docs[i]));
        writeFileSync(join(dirs[i]!, 'candidates', candidate), bytes);
        writeFileSync(join(dirs[i]!, 'candidates', candidate.replace('-v1.', '-v2.')), bytes);
        writeFileSync(join(dirs[i]!, 'pin.json'), JSON.stringify(pin(bytes)));
      });
      const bad = dirs[0]!, id = wanted[0]!;
      const replaceCandidate = (bytes: string) => {
        writeFileSync(join(bad, 'candidates', candidate), bytes);
        writeFileSync(join(bad, 'pin.json'), JSON.stringify(pin(bytes)));
      };
      const mutations = [
        () => writeFileSync(join(bad, 'pin.json'), '{}'),
        () => writeFileSync(join(bad, 'pin.json'), '{broken'),
        () => writeFileSync(join(bad, 'pin.json'), JSON.stringify({ ...pin(content(id)), sha256: '0'.repeat(64) })),
        () => writeFileSync(join(bad, 'pin.json'), JSON.stringify({ ...pin(content(id)), candidate: 'absent-v1.md' })),
        ...[{ schema: 'invalid' }, { id: 'foreign.slot' }, { agent: agent === 'writer' ? 'director' : 'writer' }, { kind: 'invalid' },
          ...[{ l0: 'foreign' }, { l1: 'foreign' }, { l2: 'foreign' }, { order: docs[0]!.ia.order + 1 }].map(position => ({ ia: { ...docs[0]!.ia, ...position } }))
        ].map(fields => () => writeFileSync(join(bad, 'slot.json'), JSON.stringify({ ...docs[0], ...fields }))),
        () => replaceCandidate(content(id, source, true)),
        () => replaceCandidate(content(id, { kind: 'derived', ref: [] })),
        () => replaceCandidate(kind === 'brief' || kind === 'strings' ? serializeFrontmatter({ slot: id, ...(kind === 'brief' ? { feeds: [], functions: [] } : { locales: ['en'] }) },
          kind === 'brief' ? '## Direction\nDemand\n## Because\nEvidence\n## Watch\nSignals' : '## en\n### greeting\n<!-- {"id":"greeting","bindings":[]} -->\nText')
          : JSON.stringify({ ...JSON.parse(content(id)), meta: {} })),
        () => replaceCandidate(kind === 'brief' || kind === 'strings' ? content(id).replace('source:', 'lineage:')
          : JSON.stringify({ ...JSON.parse(content(id)), meta: { source, lineage: {} } })),
        ...(kind === 'element' ? [
          () => replaceCandidate(JSON.stringify({ ...JSON.parse(content(id)), name: 'foreign' })),
          ...[{ id: 'foreign' }, { slot: 'foreign.slot' }].map(element => () => replaceCandidate(JSON.stringify({ ...JSON.parse(content(id)), meta: { source, element } }))),
        ] : []),
      ];
      reset();
      expect(slotGallery(root, agent).sections.flatMap(section => section.cards).map(card => card.status)).toEqual(['active', 'active']);
      for (const mutate of mutations) {
        reset(); mutate();
        const gallery = slotGallery(root, agent), cards = gallery.sections.flatMap(section => section.cards);
        expect(gallery.count).toBe(2); expect(ids(gallery.sections)).toEqual(wanted);
        expect(cards[0]).toMatchObject({ status: 'failing', records: 0 });
        for (const field of ['element', 'specimen', 'emptyState'] as const) expect(cards[0]![field]).toBeUndefined();
        expect(cards[1]).toMatchObject({ status: 'active', records: 1 });
      }
    } finally { rmSync(repo, { recursive: true, force: true }); }
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
        { key: '0', label: 'en/empty.context', text: '' },
        { key: '1', label: `en/${context}`, text: '\n  first  \n## literal locale\n### literal context\n<!-- literal comment -->\n\\one slash\n```json\n{"literal":true}\n```\n' },
        { key: '2', label: 'en/payload.context', text: JSON.stringify({ id: 'payload', metadataOnly: true, context: 'payload.context', parts: payload.parts, state: false }) },
        { key: '3', label: 'ar/arabic.context', text: 'لغة' },
      ]);
      expect(JSON.parse(input.rows[2]!.text)).not.toHaveProperty('text');
      expect(detailRecord(f.repo, 'writer', f.id)).toEqual(input);
      expect(readFileSync(join(f.dir, 'candidates', f.candidate), 'utf8')).toBe(f.source);
    } finally { rmSync(f.repo, { recursive: true, force: true }); }
  });

  it('gives the detail no record specimen for Writer records with invalid native source or slot identity', () => {
    const body = '## en\r\n### greeting\r\n<!-- {"id":"greeting","bindings":[]} -->\r\nExact text\r\n';
    const f = writerRecordFixture(body);
    try {
      const docPath = join(f.dir, 'slot.json'), doc = readFileSync(docPath, 'utf8');
      const record = () => detailRecord(f.repo, 'writer', f.id, f.candidate);
      expect(record()?.rows[0]?.text).toBe('Exact text');
      const fields = { slot: f.id, locales: ['en'], source: { kind: 'original', ref: [] } };
      for (const mutate of [
        () => writeFileSync(join(f.dir, 'candidates', f.candidate), serializeFrontmatter({ ...fields, source: { kind: 'derived', ref: [] } }, body)),
        () => writeFileSync(join(f.dir, 'candidates', f.candidate), serializeFrontmatter({ ...fields, slot: 'foreign.slot' }, body)),
        () => writeFileSync(docPath, doc.replace(f.id, 'foreign.slot')),
        () => writeFileSync(join(f.dir, 'pin.json'), '{}'),
      ]) {
        writeFileSync(docPath, doc);
        writeFileSync(join(f.dir, 'candidates', f.candidate), f.source);
        mutate();
        expect(record()).toBeUndefined();
      }
    } finally { rmSync(f.repo, { recursive: true, force: true }); }
  });

  it.each([
    ['invalid metadata', '## en\n### first\n<!-- {"id":42,"bindings":[]} -->\ntext\n'],
    ['duplicate id', '## en\n### first\n<!-- {"id":"same","bindings":[]} -->\nfirst\n\n### second\n<!-- {"id":"same","bindings":[]} -->\nsecond\n'],
  ])('refuses native Writer %s without partial projection', (_problem, body) => {
    const f = writerRecordFixture(body);
    try {
      let projected: ReturnType<typeof recordSpecimenInput>;
      if (_problem === 'invalid metadata') expect(recordSpecimenInput(f.root, 'writer', f.id, f.candidate)).toBeUndefined();
      else expect(() => { projected = recordSpecimenInput(f.root, 'writer', f.id, f.candidate); }).toThrow(/Writer slot body/);
      expect(slotGallery(f.root, 'writer').sections.flatMap(section => section.cards)[0]).toMatchObject({ status: 'failing', records: 0 });
      expect(projected).toBeUndefined();
    } finally { rmSync(f.repo, { recursive: true, force: true }); }
  });

  it.each(['{ malformed JSON', 'null'])('keeps every Designer row when the pinned candidate is %s', bytes => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'gallery-designer-')));
    try {
      const wanted = ['components.empty', 'components.bad', 'components.healthy', 'components.absent'];
      const ia: IaDoc = { schema: 'clossys.ia/1', source: 'synthetic-test-only#gallery-malformed', extensions: [], nodes: [{ id: 'components', label: 'Components', children: [{ id: 'controls', label: 'Controls', slots: wanted }] }] };
      mkdirSync(join(root, 'agents/designer'), { recursive: true });
      writeFileSync(join(root, 'agents/designer/ia.json'), JSON.stringify(ia));
      for (const id of wanted.slice(0, -1)) {
        const dir = join(root, 'agents/designer', id);
        mkdirSync(join(dir, 'candidates'), { recursive: true });
        writeFileSync(join(dir, 'slot.json'), JSON.stringify({
          schema: 'clossys.slot/1', id, agent: 'designer', ia: slotPositions('designer', ia).get(id)!,
          kind: 'element', contract: {}, inputs: [], uses: [],
        } satisfies SlotDoc));
        if (id === 'components.empty') continue;
        const content = id === 'components.bad' ? bytes : JSON.stringify({ name: 'element', type: 'registry:component', files: [{ path: 'index.tsx', type: 'registry:component', content: 'export default function Healthy() { return null; }' }], meta: { source: { kind: 'original', ref: [] } } });
        writeFileSync(join(dir, 'candidates/element-v1.json'), content);
        writeFileSync(join(dir, 'pin.json'), JSON.stringify({ candidate: 'element-v1.json', sha256: sha256Hex(content), decidedBy: 'owner:synthetic-test-only:gallery-malformed', basis: 'bulk', at: '2026-01-01T00:00:00Z' }));
        if (id === 'components.bad') writeFileSync(join(dir, 'candidates/element-v2.json'), JSON.stringify({ name: 'newer' }));
      }
      const gallery = slotGallery(root, 'designer');
      expect(gallery.count).toBe(wanted.length);
      expect(ids(gallery.sections)).toEqual(wanted);
      const cards = gallery.sections.flatMap(section => section.cards);
      expect(cards[0]).toMatchObject({ id: wanted[0], status: 'missing', emptyState: 'no-candidate', records: 0 });
      expect(cards[1]).toMatchObject({ id: wanted[1], status: 'failing', candidate: 'element-v1.json', version: 1, records: 0 });
      expect(cards[1]!.element).toBeUndefined();
      expect(cards[1]!.specimen).toBeUndefined();
      expect(cards[2]).toMatchObject({ id: wanted[2], status: 'active', element: 'element', specimen: 'components.healthy/element', records: 1 });
      expect(cards[3]).toMatchObject({ id: wanted[3], status: 'failing', records: 0 });
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
        const dir = join(root, 'agents/designer', id);
        mkdirSync(join(dir, 'candidates'), { recursive: true });
        writeFileSync(join(dir, 'slot.json'), JSON.stringify({ schema: 'clossys.slot/1', id, agent: 'designer', ia: slotPositions('designer', ia).get(id)!, kind: 'element', contract: {}, inputs: [], uses: [] } satisfies SlotDoc));
      }
      const dir = join(root, 'agents/designer/components.example');
      const content = JSON.stringify({ name: 'example', type: 'registry:component', files: [{ path: 'index.tsx', type: 'registry:component', content: 'export default function Example() { return null; }' }], meta: { source: { kind: 'original', ref: [] } } });
      writeFileSync(join(dir, 'candidates/example-v1.json'), content);
      writeFileSync(join(dir, 'candidates/example-v2.json'), content.replace('return null;', 'return <div />;'));
      const pin = { candidate: 'example-v1.json', sha256: sha256Hex(content), decidedBy: 'owner:synthetic-test-only:designer-pin', basis: 'bulk', at: '2026-01-01T00:00:00Z' };
      const assertNoPreview = (noPin: boolean) => {
        const cards = slotGallery(root, 'designer').sections.flatMap(section => section.cards);
        expect(cards.map(card => card.id)).toEqual(wanted);
        expect(cards[0]).toMatchObject({ emptyState: 'no-candidate', records: 0 });
        if (noPin) expect(cards[1]).toMatchObject({ emptyState: 'no-pin', status: 'draft', records: 1 });
        expect(cards[1]!.element).toBeUndefined();
        expect(cards[1]!.specimen).toBeUndefined();
        if (noPin) expect(cards[1]!.options).toBe(2);
      };
      assertNoPreview(true);
      writeFileSync(join(dir, 'pin.json'), JSON.stringify(pin));
      const pinned = slotGallery(root, 'designer').sections.flatMap(section => section.cards)[1]!;
      expect(pinned).toMatchObject({ candidate: 'example-v1.json', version: 1, status: 'active', element: 'example', specimen: 'components.example/example' });
      expect(specimenHref(pinned, 'light', 1280)).toBe('/__specimen?element=components.example%2Fexample&theme=light&width=1280&v=1');
      unlinkSync(join(dir, 'pin.json'));
      assertNoPreview(true);
      for (const invalid of [{}, { ...pin, sha256: '0'.repeat(64) }, { ...pin, candidate: 'absent-v1.json' }]) {
        writeFileSync(join(dir, 'pin.json'), JSON.stringify(invalid));
        assertNoPreview(false);
        expect(slotGallery(root, 'designer').sections.flatMap(section => section.cards)[1]).toMatchObject({ status: 'failing', records: 0 });
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('projects all source IA entries, in exact order, through the slot gallery', async () => {
    let total = 0;
    for (const agent of ['director', 'designer', 'writer', 'publisher'] as const) {
      const wanted = expected(consumer, agent);
      const gallery = slotGallery(consumer, agent);
      expect(ids(gallery.sections)).toEqual(wanted);
      expect(gallery.count).toBe(wanted.length);
      total += gallery.count;
    }
    expect(total).toBe(['director', 'designer', 'writer', 'publisher'].reduce((sum, agent) => sum + expected(consumer, agent).length, 0));
  });

  it('keeps Writer slots in IA order but gives the detail a record specimen only for the intact pin', () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'gallery-slots-')));
    const root = join(repo, 'clossys');
    try {
      const dir = join(root, 'agents/writer/strings.label');
      mkdirSync(dir, { recursive: true });
      const ia: IaDoc = { schema: 'clossys.ia/1', source: 'synthetic-test-only#gallery-pin', extensions: [], nodes: [{ id: 'strings.copy', label: 'Copy', children: [{ id: 'copy', label: 'Labels', slots: ['strings.label'] }] }] };
      writeFileSync(join(root, 'agents/writer/ia.json'), JSON.stringify(ia));
      writeFileSync(join(dir, 'slot.json'), JSON.stringify({
        schema: 'clossys.slot/1', id: 'strings.label', agent: 'writer',
        ia: slotPositions('writer', ia).get('strings.label')!, kind: 'strings', contract: {}, inputs: [], uses: [],
      } satisfies SlotDoc));
      const cards = () => slotGallery(root, 'writer').sections.flatMap(section => section.cards);
      const noFrame = () => {
        expect(cards().map(card => card.id)).toEqual(expected(root, 'writer'));
        expect(detailRecord(repo, 'writer', 'strings.label')).toBeUndefined();
      };
      expect(cards()).toMatchObject([{ id: 'strings.label', emptyState: 'no-candidate', records: 0 }]);
      noFrame();
      mkdirSync(join(dir, 'candidates'));
      const content = serializeFrontmatter({ slot: 'strings.label', locales: ['en'], source: { kind: 'original', ref: [] } }, '## en\n### greeting\n<!-- {"id":"greeting","bindings":[]} -->\nHello <script> & welcome\n');
      writeFileSync(join(dir, 'candidates/label-v1.md'), content);
      expect(cards()).toMatchObject([{ emptyState: 'no-pin', candidate: 'label-v1.md', version: 1, records: 1 }]);
      expect(recordSpecimenInput(root, 'writer', 'strings.label')?.rows).toEqual([{ key: '0', label: 'en/greeting', text: 'Hello <script> & welcome' }]);
      writeFileSync(join(dir, 'candidates/label-v2.md'), content.replace('Hello <script> & welcome', 'Newer draft'));
      expect(cards()[0]).toMatchObject({ version: 2, candidate: 'label-v2.md', emptyState: 'no-pin' });
      noFrame();
      expect(cards()[0]!.options).toBe(2);
      const pin = { candidate: 'label-v1.md', sha256: sha256Hex(content), decidedBy: 'owner:synthetic-test-only:gallery-pin', basis: 'bulk', at: '2026-01-01T00:00:00Z' };
      writeFileSync(join(dir, 'pin.json'), JSON.stringify(pin));
      expect(cards()[0]).toMatchObject({ status: 'active', candidate: 'label-v1.md', version: 1 });
      expect(recordSpecimenInput(root, 'writer', 'strings.label')?.rows[0]?.text).toBe('Hello <script> & welcome');
      expect(cards()[0]!.emptyState).toBeUndefined();
      // The card carries the pinned record's lead text; the detail renders the record inline, no frame.
      expect(cards()[0]!.excerpt).toEqual(['Hello <script> & welcome']);
      const specimen = detailRecord(repo, 'writer', 'strings.label')!;
      expect(specimen).toEqual(recordSpecimenInput(root, 'writer', 'strings.label', 'label-v1.md'));
      const html = renderToStaticMarkup(createElement(SpecimenContent, { specimen: drawn(specimen) }));
      expect(html).toContain('Hello &lt;script&gt; &amp; welcome');
      expect(html).not.toContain('<iframe');
      for (const invalid of [{}, { ...pin, candidate: 'absent-v1.md' }]) {
        writeFileSync(join(dir, 'pin.json'), JSON.stringify(invalid));
        noFrame();
      }
      // A present malformed pin never grants an explicit draft fallback.
      writeFileSync(join(dir, 'pin.json'), '{}');
      expect(recordSpecimenInput(root, 'writer', 'strings.label', 'label-v2.md')).toBeUndefined();
      unlinkSync(join(dir, 'pin.json'));
      expect(recordSpecimenInput(root, 'writer', 'strings.label', 'label-v2.md')?.rows[0]?.text).toBe('Newer draft');
      writeFileSync(join(dir, 'pin.json'), JSON.stringify(pin));
      writeFileSync(join(dir, 'candidates/label-v1.md'), `${content}changed`);
      expect(cards()[0]).toMatchObject({ status: 'failing', records: 0 });
      noFrame();
      expect(() => recordSpecimenInput(root, 'writer', 'strings.label')).toThrow('hash mismatch');
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });

  it('gives the detail the valid pinned Director brief as the pin and every other valid candidate as a preview, rejecting foreign slots and invalid native records', () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'director-specimen-pin-')));
    const root = join(repo, 'clossys');
    try {
      const id = 'context.market.size', name = 'record-v1.md';
      const dir = join(root, `agents/director/${id}`);
      mkdirSync(join(dir, 'candidates'), { recursive: true });
      const ia: IaDoc = { schema: 'clossys.ia/1', source: 'synthetic-test-only#director-pin', extensions: [], nodes: [{ id: 'one', label: 'One', children: [{ id: 'two', label: 'Two', slots: [id] }] }] };
      writeFileSync(join(root, 'agents/director/ia.json'), JSON.stringify(ia));
      const doc: SlotDoc = { schema: 'clossys.slot/1', id, agent: 'director', ia: slotPositions('director', ia).get(id)!, kind: 'brief', contract: {}, inputs: [], uses: [] };
      writeFileSync(join(dir, 'slot.json'), JSON.stringify(doc));
      const fields = { slot: id, source: { kind: 'original', ref: [] }, feeds: [], functions: [] };
      const body = '## Direction\nPinned demand\n## Because\nEvidence\n## Watch\nSignals';
      const content = serializeFrontmatter(fields, body);
      const pin = { candidate: name, sha256: sha256Hex(content), decidedBy: 'owner:synthetic-test-only:director-pin', basis: 'bulk', at: '2026-01-01T00:00:00Z' };
      writeFileSync(join(dir, 'candidates', name), content);
      writeFileSync(join(dir, 'candidates/record-v2.md'), serializeFrontmatter(fields, body.replace('Pinned demand', 'Newer draft')));
      const served = (slot = id, candidate?: string) => detailRecord(repo, 'director', slot, candidate);
      expect(served()).toBeUndefined();
      const card = () => slotGallery(root, 'director').sections.flatMap(section => section.cards)[0]!;
      expect(card()).toMatchObject({ emptyState: 'no-pin', records: 1 });
      writeFileSync(join(dir, 'pin.json'), JSON.stringify(pin));
      expect(served()).toEqual(recordSpecimenInput(root, 'director', id));
      expect(JSON.stringify(served())).toContain('Pinned demand');
      expect(JSON.stringify(served())).not.toContain('Newer draft');
      expect(card()).toMatchObject({ status: 'active', candidate: 'record-v1.md' });
      // A recorded draft renders its own bytes as a preview; it never becomes the card or the pin.
      expect(JSON.stringify(served(id, 'record-v2.md'))).toContain('Newer draft');
      expect(slotDetail(repo, 'director', id)!.candidates.map(row => [row.name, row.pinned, row.preview])).toEqual([['record-v1.md', true, false], ['record-v2.md', false, true]]);
      expect(card()).toMatchObject({ status: 'active', candidate: 'record-v1.md' });
      for (const [slot, candidate] of [[id, 'absent-v1.md'], ['foreign.slot', undefined]] as const) expect(served(slot, candidate)).toBeUndefined();
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
        expect(served()).toBeUndefined();
      }
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });

  it('binds Director and Writer fixtures to the existing shared record specimen renderer', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'record-specimens-')));
    try {
      for (const [agent, id, body] of [
        ['director', 'context.market.size', '## Direction\nMeasure demand\n## Because\nEvidence\n## Watch\nSignals'],
        ['writer', 'strings.label', '## en\n### greeting\n<!-- {"id":"greeting","bindings":[]} -->\nHello <script>'],
      ] as const) {
        const dir = join(root, `agents/${agent}/${id}`);
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
        if (agent === 'director') writeFileSync(join(dir, 'pin.json'), JSON.stringify({ candidate: 'record-v1.md', sha256: sha256Hex(content), decidedBy: 'owner:synthetic-test-only:specimen', basis: 'bulk', at: '2026-01-01T00:00:00Z' }));
        const input = recordSpecimenInput(root, agent, id)!;
        const html = renderToStaticMarkup(createElement(SpecimenContent, { specimen: drawn(input) }));
        expect(html).toContain('<table');
        expect(html).toContain(agent === 'director' ? 'Measure demand' : 'Hello &lt;script&gt;');
        expect(recordSpecimenInput(root, agent, id, 'absent-v1.md')).toBeUndefined();
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('record card lead text', () => {
  it('reads the first rows as plain card text: markers and emphasis stripped, JSON rows as their value, long rows cut', () => {
    const rows = (...texts: string[]) => ({ rows: texts.map((text, index) => ({ key: String(index), label: String(index), text })) });
    expect(recordLead(rows('- **Unit:** teams that ship', '{"id":"x","kind":"voice-rule","value":"neutral: plain words"}', 'third row'))).toEqual(['Unit: teams that ship', 'neutral: plain words']);
    expect(recordLead(rows('{not json', 'x'.repeat(300)))).toEqual(['{not json', `${'x'.repeat(219)}…`]);
    expect(recordLead(undefined)).toEqual([]);
    expect(recordLead(rows(`${'word '.repeat(43)}(context.competition.alternative@5)`))).toEqual([`${'word '.repeat(43).trimEnd()}…`]);
    // A claim, term or pattern record reads as its words, never as its JSON (the cited strategy stays in the record).
    expect(recordLead(rows('{"id":"c","kind":"claim","strategy":"director:context.competition.alternative@1","phrasings":["Unlike an unguided run, each slot keeps its lineage."]}',
      '{"id":"t","kind":"term","term":"Studio","forms":[]}'))).toEqual(['Unlike an unguided run, each slot keeps its lineage.', 'Studio']);
    expect(recordLead(rows('{"id":"p","kind":"pattern-rule","pattern":"click here","severity":"error"}', '{"id":"n","frame":"f","regions":[]}')))
      .toEqual(['click here', '{"id":"n","frame":"f","regions":[]}']);
  });
});
