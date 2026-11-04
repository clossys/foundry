import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { slotDetail } from './slot-detail.js';
import { detailStrings, loadSlotDetail, slotDetailInputs } from '../../studio/lib/slot-detail';
import { resolveCopy } from '../../studio/lib/studio-copy';
import { parsePublicationResponse } from '../../studio/lib/publisher-preview';
import { serializeFrontmatter, slotPositions, type IaDoc } from '../records/slot-model/index.js';
import { parseWriterCell, serializeWriterCell } from '../../../writer/src/cells/parse.js';

const roots: string[] = [];
const id = 'passages.example';
const links = { leaf: (agent: string, slot: string) => `/${agent}/${slot}`, label: () => undefined, back: { href: '/writer', label: 'Writer' } };
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'slot-detail-'))); roots.push(root);
  const agent = join(root, 'clossys/agents/writer');
  const dir = join(agent, id);
  mkdirSync(join(dir, 'candidates'), { recursive: true });
  const ia: IaDoc = { schema: 'clossys.ia/1', source: 'synthetic-test-only#B4-writer-detail', extensions: [], nodes: [
    { id: 'passages.test', label: 'Passages', children: [{ id: 'test-records', label: 'Test records', slots: [id] }] },
  ] };
  writeFileSync(join(agent, 'ia.json'), JSON.stringify(ia));
  writeFileSync(join(dir, 'slot.json'), JSON.stringify({ schema: 'clossys.slot/1', id, agent: 'writer', kind: 'strings',
    ia: slotPositions('writer', ia).get(id), contract: { purpose: 'Example copy' }, inputs: [], uses: [] }));
  return { root, dir };
}
function candidate(dir: string, version: number, value: string) {
  const name = `copy-v${version}.md`;
  const bytes = serializeFrontmatter({ slot: id, locales: ['en'], source: { kind: 'original', ref: [] } },
    `## en\n\n### heading\n<!-- {"id":"heading","bindings":[]} -->\n${value}\n`);
  writeFileSync(join(dir, 'candidates', name), bytes);
  return { name, bytes };
}
afterEach(() => { vi.unstubAllGlobals(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('slot details', () => {
  it('keeps an empty IA detail available with honest empty sections', () => {
    const { root } = fixture();
    const detail = slotDetail(root, 'writer', id)!;
    expect(detail.candidates).toEqual([]);
    expect(detail.pin).toBeNull();
    expect(detail.shown).toBeUndefined();
    const inputs = slotDetailInputs(detail, links, 'light');
    expect(inputs).toMatchObject({ header: { statusLabel: 'No candidate' }, specimen: { kind: 'record', status: { label: 'No pin', tone: 'destructive' } }, options: { rows: [] }, history: { rows: [] } });
    expect(inputs.checks).toMatchObject({ rows: expect.arrayContaining([expect.objectContaining({ label: 'Candidate recorded', ok: false })]) });
    expect(slotDetail(root, 'writer', 'passages.unknown')).toBeUndefined();
  });

  it('shows the pin beside every candidate and preserves real Writer text', () => {
    const { root, dir } = fixture();
    const full = 'First line.\nSecond line. ' + 'Full specimen text. '.repeat(40);
    const first = candidate(dir, 1, full);
    candidate(dir, 2, 'An unapproved alternative');
    const sha256 = createHash('sha256').update(first.bytes).digest('hex');
    // Attribution and date are synthetic test metadata, not an approval record.
    writeFileSync(join(dir, 'pin.json'), JSON.stringify({ candidate: first.name, sha256, decidedBy: 'owner:synthetic-test-only:B4-slot-detail-pin', at: '2026-01-01T00:00:00Z' }));
    const detail = slotDetail(root, 'writer', id)!;
    expect(detail.shown).toBe(first.name);
    expect(detail.checks.filter(check => JSON.stringify(check.label) !== JSON.stringify({ copy: 'studio.check-inputs-ready' }) && check.detail !== 'inputs-undeclared').every(check => check.ok)).toBe(true);
    expect(detail.history).toEqual([expect.objectContaining({ candidate: first.name, commit: 'working-tree' })]);
    const inputs = slotDetailInputs(detail, links, 'dark');
    // A pinned Writer strings record is its own specimen: the record rows, inline.
    expect(inputs.specimen).toMatchObject(resolveCopy(detail.candidates[0]!.record));
    expect(inputs.specimen).toMatchObject({ kind: 'record', title: 'Strings', rows: [expect.objectContaining({ text: expect.stringContaining(full) })] });
    expect(detail.candidates[0]!.content).toContain(full);
    expect(inputs.options).toMatchObject({ rows: [{ pinned: true, preview: { rows: [{ text: full }] } }, { pinned: false, preview: { rows: [{ text: 'An unapproved alternative' }] } }] });
    expect(inputs.references).toMatchObject({ lineage: [expect.objectContaining({ source: '{"kind":"original","ref":[]}' }), expect.anything()] });
  });

  it('missing-candidate mutation turns the real detail red without falling back to old content', () => {
    const { root, dir } = fixture();
    const first = candidate(dir, 1, 'Present');
    expect(slotDetail(root, 'writer', id)!.checks[0]!.ok).toBe(true);
    unlinkSync(join(dir, 'candidates', first.name));
    const detail = slotDetail(root, 'writer', id)!;
    expect(detail.checks[0]!.ok).toBe(false);
    expect(slotDetailInputs(detail, links, 'light').specimen).toMatchObject({ kind: 'record', status: { tone: 'destructive' } });
    expect(slotDetailInputs(detail, links, 'light').specimen).not.toHaveProperty('rows');
  });

  it('reports broken hashes and derives used-by from slot.json rather than candidate prose', () => {
    const { root, dir } = fixture(); candidate(dir, 1, 'No references in this text');
    const file = join(dir, 'slot.json');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), inputs: ['identity.missing'], uses: [id] }));
    // Keep the deliberate byte mismatch within an otherwise valid synthetic pin.
    writeFileSync(join(dir, 'pin.json'), JSON.stringify({ candidate: 'copy-v1.md', sha256: '0'.repeat(64), decidedBy: 'owner:synthetic-test-only:B4-slot-detail-pin', at: '2026-01-01T00:00:00Z' }));
    const detail = slotDetail(root, 'writer', id)!;
    expect(detail.usedBy).toEqual([{ agent: 'writer', id }]);
    expect(detail.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: { copy: 'studio.check-pin-matches' }, ok: false }),
      expect.objectContaining({ label: 'identity.missing', ok: false }),
    ]));
    expect(slotDetailInputs(detail, links, 'light')).toMatchObject({ references: { usedBy: [{ label: id, href: `/writer/${id}` }] } });
  });

  it('projects canonical input readiness independently of reference links', () => {
    const { root, dir } = fixture();
    const upstream = 'brief.example';
    const agent = join(root, 'clossys/agents/director');
    const upstreamDir = join(agent, upstream);
    mkdirSync(join(upstreamDir, 'candidates'), { recursive: true });
    const ia: IaDoc = { schema: 'clossys.ia/1', source: 'synthetic#readiness', extensions: [], nodes: [
      { id: 'examples', label: 'Examples', children: [{ id: 'group', label: 'Group', slots: [upstream] }] },
    ] };
    writeFileSync(join(agent, 'ia.json'), JSON.stringify(ia));
    const upstreamDoc = { schema: 'clossys.slot/1', id: upstream, agent: 'director', ia: slotPositions('director', ia).get(upstream), kind: 'brief', contract: {}, inputs: [], uses: [] };
    writeFileSync(join(upstreamDir, 'slot.json'), JSON.stringify(upstreamDoc));
    const bytes = serializeFrontmatter({ slot: upstream, source: { kind: 'original', ref: [] }, feeds: [], functions: [] },
      '## Direction\n- example: Direction\n\n## Because\n- example: Evidence\n\n## Watch\n- example: Constraint\n');
    const candidatePath = join(upstreamDir, 'candidates/brief-v1.md');
    const pinPath = join(upstreamDir, 'pin.json');
    const pin = { candidate: 'brief-v1.md', sha256: createHash('sha256').update(bytes).digest('hex'), decidedBy: 'owner:synthetic-test-only:readiness', at: '2026-01-01T00:00:00Z' };
    writeFileSync(candidatePath, bytes); writeFileSync(pinPath, JSON.stringify(pin));
    const docPath = join(dir, 'slot.json');
    const doc = JSON.parse(readFileSync(docPath, 'utf8'));
    writeFileSync(docPath, JSON.stringify({ ...doc, inputs: [upstream], uses: [id] }));
    const verify = (reason?: string) => {
      const detail = slotDetail(root, 'writer', id)!;
      expect(detail.inputs).toEqual([upstream]); expect(detail.uses).toEqual([id]);
      expect(detail.links).toEqual([{ agent: 'director', id: upstream }, { agent: 'writer', id }]);
      expect(detail.checks).toContainEqual({ label: upstream, ok: true, detail: { copy: 'studio.check-reference-resolves' } });
      const checks = slotDetailInputs(detail, links, 'light').checks.rows;
      expect(checks).toContainEqual(expect.objectContaining({ label: 'Inputs ready', ok: !reason }));
      if (reason) expect(checks).toContainEqual(expect.objectContaining({ label: upstream, ok: false, detail: reason }));
    };
    verify();
    unlinkSync(pinPath); verify('unpinned');
    writeFileSync(pinPath, JSON.stringify(pin)); writeFileSync(candidatePath, bytes + 'changed\n'); verify('hash-drift');
    writeFileSync(candidatePath, bytes); writeFileSync(pinPath, '{}'); verify('invalid-pin');
    writeFileSync(pinPath, JSON.stringify(pin)); unlinkSync(candidatePath); verify('missing-candidate');
    const invalid = bytes.replace('---\n', '---\nstatus: active\n');
    writeFileSync(candidatePath, invalid); writeFileSync(pinPath, JSON.stringify({ ...pin, sha256: createHash('sha256').update(invalid).digest('hex') })); verify('invalid-candidate');
    writeFileSync(candidatePath, bytes); writeFileSync(pinPath, JSON.stringify(pin));
    writeFileSync(join(upstreamDir, 'slot.json'), JSON.stringify({ ...upstreamDoc, id: 'brief.foreign' })); verify('invalid-slot');
    writeFileSync(docPath, JSON.stringify({ ...doc, inputs: ['brief.missing'], uses: [id] }));
    const missing = slotDetail(root, 'writer', id)!;
    expect(missing.checks).toContainEqual({ label: 'brief.missing', ok: false, detail: 'missing' });
    expect(missing.checks).toContainEqual({ label: 'brief.missing', ok: false, detail: { copy: 'studio.check-reference-unknown' } });
    writeFileSync(docPath, JSON.stringify(doc));
    expect(slotDetail(root, 'writer', id)!.checks).toContainEqual({ label: id, ok: false, detail: 'inputs-undeclared' });
    writeFileSync(join(upstreamDir, 'slot.json'), JSON.stringify(upstreamDoc));
    expect(slotDetail(root, 'director', upstream)!.checks).toContainEqual({ label: { copy: 'studio.check-inputs-ready' }, ok: true, detail: { copy: 'studio.check-inputs-ready' } });
  });

  it('keeps locale identities distinct and does not emit metadata as Writer copy', () => {
    expect(detailStrings('## en\n### title\n<!-- {"id":"a"} -->\nHello\n## fr\n### title\n<!-- {"id":"b"} -->\nBonjour')).toEqual([
      { key: 'en/title', text: 'Hello' }, { key: 'fr/title', text: 'Bonjour' },
    ]);
  });

  it('shows canonical Writer strings verbatim after serialization, including escaped content lines', () => {
    const original = [
      '', '# Literal heading', '## Literal locale', '### Literal key',
      '<!-- literal comment -->', '\\leading backslash', '```json', '{"literal":true}', '```',
      'A multiline string.', '', 'Last line.  ', '',
    ].join('\n');
    const source = serializeWriterCell({
      id: 'strings.example', version: 1, status: 'draft', updated: '2026-01-01', links: [], locales: ['en', 'fr'],
      records: [
        { locale: 'en', record: { id: 'synthetic-heading-en', context: 'heading', text: original }, bindings: [] },
        { locale: 'fr', record: { id: 'synthetic-heading-fr', context: 'heading', text: 'Bonjour\nEncore' }, bindings: [] },
      ],
    });
    expect(parseWriterCell(source).records.map(item => item.record.text)).toEqual([original, 'Bonjour\nEncore']);
    const body = source.slice(source.indexOf('\n---\n') + '\n---\n'.length);
    expect(detailStrings(body)).toEqual([
      { key: 'en/heading', text: original }, { key: 'fr/heading', text: 'Bonjour\nEncore' },
    ]);
    const { root, dir } = fixture();
    const bytes = serializeFrontmatter({ slot: id, locales: ['en', 'fr'], source: { kind: 'original', ref: [] } }, body);
    writeFileSync(join(dir, 'candidates/copy-v1.md'), bytes);
    writeFileSync(join(dir, 'pin.json'), JSON.stringify({ candidate: 'copy-v1.md', sha256: createHash('sha256').update(bytes).digest('hex'),
      decidedBy: 'owner:synthetic-test-only:writer-verbatim-detail', at: '2026-01-01T00:00:00Z' }));
    const detail = slotDetail(root, 'writer', id)!;
    expect(detail.candidates[0]!.issues).toEqual([]);
    const inputs = slotDetailInputs(detail, links, 'light');
    expect(inputs.specimen).toMatchObject(resolveCopy(detail.candidates[0]!.record));
    expect((inputs.specimen as { rows: { text: string }[] }).rows.map(row => row.text)).toEqual([original, 'Bonjour\nEncore']);
    expect(inputs.options).toMatchObject({ rows: [{ preview: { rows: [
      { key: 'en/heading', text: original }, { key: 'fr/heading', text: 'Bonjour\nEncore' },
    ] } }] });
  });

  it('treats a non-ready response as invalid and a 404 as an unknown slot', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ state: 'legacy' })));
    await expect(loadSlotDetail('writer', id, signal)).rejects.toThrow('Slot detail response is invalid');
    fetch.mockResolvedValueOnce(new Response('', { status: 404 }));
    expect(await loadSlotDetail('writer', id, signal)).toBeNull();
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ state: 'ready' })));
    await expect(loadSlotDetail('writer', id, signal)).rejects.toThrow('Slot detail response is invalid');
  });

  it('renders an emitted native Publisher page at all six viewport/theme variants without replacing its slot contract', () => {
    const { root } = fixture();
    const id = 'page.example', agent = join(root, 'clossys/agents/publisher');
    const dir = join(agent, id);
    mkdirSync(join(dir, 'candidates'), { recursive: true });
    const ia: IaDoc = { schema: 'clossys.ia/1', source: 'synthetic-test-only#publisher-detail', extensions: [], nodes: [{ id: 'web', label: 'Web', children: [{ id: 'pages', label: 'Pages', slots: [id] }] }] };
    writeFileSync(join(agent, 'ia.json'), JSON.stringify(ia));
    writeFileSync(join(dir, 'slot.json'), JSON.stringify({ schema: 'clossys.slot/1', id, agent: 'publisher', ia: slotPositions('publisher', ia).get(id), kind: 'page', contract: { purpose: 'Example page' }, inputs: [], uses: [] }));
    const bytes = JSON.stringify({ schema: 'clossys.page/1', title: 'Example', path: '/example', frame: null, sections: [], copy: {}, meta: { source: { kind: 'original', ref: [] } } });
    writeFileSync(join(dir, 'candidates/example-v1.json'), bytes);
    writeFileSync(join(dir, 'pin.json'), JSON.stringify({ candidate: 'example-v1.json', sha256: createHash('sha256').update(bytes).digest('hex'), decidedBy: 'owner:synthetic-test-only:publisher-detail', at: '2026-01-01T00:00:00Z' }));
    const detail = slotDetail(root, 'publisher', id)!;
    expect(detail.candidates[0]!.issues).toEqual([]);
    const publication = parsePublicationResponse({ state: 'ready', publication: 'example', publications: ['example'], manifest: { schemaVersion: 1, publication: 'example', contentMap: { entries: [] } }, pages: [{ id: 'emitted-example', cellId: id, route: '/example', previewUrl: '/preview/example/pages/emitted-example.html', frameUrl: '/preview/example/frame/emitted-example.html', emitted: true }] });
    const inputs = slotDetailInputs(detail, links, 'dark', publication);
    expect(inputs.specimen).toMatchObject({ kind: 'viewports', specimens: [375, 768, 1280].map(viewport => ({ viewport,
      light: `/preview/example/frame/emitted-example.html?theme=light&width=${viewport}`,
      dark: `/preview/example/frame/emitted-example.html?theme=dark&width=${viewport}`,
    })) });
    const withoutPublication = slotDetailInputs(detail, links, 'light');
    for (const name of ['header', 'options', 'contract', 'checks', 'history', 'references']) expect(inputs[name]).toEqual(withoutPublication[name]);
    // Without an emitted page the detail shows an explicit error, never the candidate file text.
    expect(withoutPublication.specimen).toMatchObject({ kind: 'record', status: { label: 'Missing', tone: 'destructive' } });
    expect(JSON.stringify(withoutPublication.specimen)).not.toContain(bytes);
    if (publication.state !== 'ready') throw new Error('Expected fixture publication');
    for (const page of [{ ...publication.pages[0]!, emitted: false }, { ...publication.pages[0]!, cellId: 'page.other' }, { ...publication.pages[0]!, cellId: undefined }]) {
      expect(slotDetailInputs(detail, links, 'light', { ...publication, pages: [page] }).specimen).toMatchObject({ kind: 'record', status: { tone: 'destructive' } });
    }
    // The native endpoint's explicit emitted identity takes precedence over route matching.
    expect(slotDetailInputs(detail, links, 'light', { ...publication, pages: [{ ...publication.pages[0]!, route: '/different', cellId: id }] }).specimen).toMatchObject({ kind: 'viewports', specimens: [375, 768, 1280].map(viewport => ({ viewport })) });
    unlinkSync(join(dir, 'pin.json'));
    expect(slotDetailInputs(slotDetail(root, 'publisher', id)!, links, 'light', publication)).toMatchObject({ header: { statusLabel: 'No pin' }, specimen: { kind: 'record', status: { label: 'No pin', tone: 'destructive' } } });
    unlinkSync(join(dir, 'candidates/example-v1.json'));
    expect(slotDetailInputs(slotDetail(root, 'publisher', id)!, links, 'light', publication).specimen).toMatchObject({ kind: 'record', status: { label: 'No pin', tone: 'destructive' } });
  });

  it('binds only the native Writer strings pin to the inline record specimen while preserving source and options', () => {
    const { root, dir } = fixture();
    const full = 'First line.\nSecond line.';
    const first = candidate(dir, 1, full);
    candidate(dir, 2, 'Newer draft');
    const pin = { candidate: first.name, sha256: createHash('sha256').update(first.bytes).digest('hex'), decidedBy: 'owner:synthetic-test-only:writer-viewports', at: '2026-01-01T00:00:00Z' };
    const doc = JSON.parse(readFileSync(join(dir, 'slot.json'), 'utf8'));
    const restore = () => {
      writeFileSync(join(dir, 'slot.json'), JSON.stringify(doc));
      writeFileSync(join(dir, 'candidates', first.name), first.bytes);
      writeFileSync(join(dir, 'pin.json'), JSON.stringify(pin));
    };
    restore();
    const detail = slotDetail(root, 'writer', id)!;
    expect(detail.shown).toBe(first.name);
    expect(detail.candidates[0]!.content).toContain(full);
    expect(detail.candidates[0]!.record).toBeDefined();
    expect(detail.candidates[1]!.record).toBeUndefined();
    const inputs = slotDetailInputs(detail, links, 'light');
    expect(inputs.specimen).toMatchObject(resolveCopy(detail.candidates[0]!.record));
    expect(inputs.specimen).toMatchObject({ kind: 'record', title: 'Strings', rows: [{ text: full }] });
    expect(inputs.options).toMatchObject({ rows: [{ pinned: true, preview: { rows: [{ text: full }] } }, { pinned: false, preview: { rows: [{ text: 'Newer draft' }] } }] });
    expect(inputs.contract).toMatchObject({ facts: expect.arrayContaining([{ label: 'purpose', value: 'Example copy' }]) });
    for (const mutation of [
      () => unlinkSync(join(dir, 'pin.json')),
      () => writeFileSync(join(dir, 'pin.json'), '{}'),
      () => writeFileSync(join(dir, 'pin.json'), JSON.stringify({ ...pin, candidate: 'absent-v1.md' })),
      () => writeFileSync(join(dir, 'pin.json'), JSON.stringify({ ...pin, sha256: '0'.repeat(64) })),
      () => writeFileSync(join(dir, 'slot.json'), JSON.stringify({ ...doc, id: 'passages.foreign' })),
      ...[first.bytes.replace(JSON.stringify(id), JSON.stringify('passages.foreign')), serializeFrontmatter({ slot: id, source: { kind: 'original', ref: [] }, locales: [] }, 'Invalid strings')].map(bytes => () => {
        writeFileSync(join(dir, 'candidates', first.name), bytes);
        writeFileSync(join(dir, 'pin.json'), JSON.stringify({ ...pin, sha256: createHash('sha256').update(bytes).digest('hex') }));
      }),
    ]) {
      restore(); mutation();
      const detail = slotDetail(root, 'writer', id)!;
      expect(detail.candidates.every(candidate => candidate.record === undefined)).toBe(true);
      expect(slotDetailInputs(detail, links, 'dark')).toMatchObject({ specimen: { kind: 'record', status: { tone: 'destructive' } }, options: { rows: [{ version: 1 }, { version: 2 }] } });
    }
  });

  it('binds only the validated native Director pin to the inline record specimen', () => {
    const { root } = fixture();
    const id = 'context.market.size', agent = join(root, 'clossys/agents/director');
    const dir = join(agent, id);
    mkdirSync(join(dir, 'candidates'), { recursive: true });
    const ia: IaDoc = { schema: 'clossys.ia/1', source: 'synthetic-test-only#director-viewports', extensions: [], nodes: [{ id: 'context', label: 'Context', children: [{ id: 'market', label: 'Market', slots: [id] }] }] };
    writeFileSync(join(agent, 'ia.json'), JSON.stringify(ia));
    const doc = { schema: 'clossys.slot/1', id, agent: 'director', ia: slotPositions('director', ia).get(id)!, kind: 'brief', contract: {}, inputs: [], uses: [] };
    const fields = { slot: id, source: { kind: 'original', ref: [] }, feeds: [], functions: [] };
    const body = '## Direction\nPinned demand\n## Because\nEvidence\n## Watch\nSignals';
    const bytes = serializeFrontmatter(fields, body);
    const pin = { candidate: 'brief-v1.md', sha256: createHash('sha256').update(bytes).digest('hex'), decidedBy: 'owner:synthetic-test-only:director-viewports', at: '2026-01-01T00:00:00Z' };
    const restore = () => {
      writeFileSync(join(dir, 'slot.json'), JSON.stringify(doc));
      writeFileSync(join(dir, 'candidates/brief-v1.md'), bytes);
      writeFileSync(join(dir, 'pin.json'), JSON.stringify(pin));
    };
    restore();
    writeFileSync(join(dir, 'candidates/brief-v2.md'), serializeFrontmatter(fields, body.replace('Pinned demand', 'Newer draft')));
    const detail = slotDetail(root, 'director', id)!;
    expect(detail.shown).toBe('brief-v1.md');
    expect(detail.candidates[0]!.issues).toEqual([]);
    expect(detail.candidates[0]!.record).toMatchObject({ kind: 'record', title: { copy: 'studio.direction' } });
    expect(JSON.stringify(detail.candidates[0]!.record)).toContain('Pinned demand');
    expect(detail.candidates[1]!.record).toBeUndefined();
    const inputs = slotDetailInputs(detail, links, 'dark');
    expect(inputs.specimen).toMatchObject(resolveCopy(detail.candidates[0]!.record));
    expect(inputs.options).toMatchObject({ rows: [{ label: 'brief-v1.md', pinned: true }, { label: 'brief-v2.md', pinned: false }] });
    const noPreview = () => {
      const detail = slotDetail(root, 'director', id)!;
      expect(detail.candidates.every(candidate => candidate.record === undefined)).toBe(true);
      expect(slotDetailInputs(detail, links, 'light').specimen).toMatchObject({ kind: 'record', status: { tone: 'destructive' } });
    };
    for (const mutation of [
      () => unlinkSync(join(dir, 'pin.json')),
      () => writeFileSync(join(dir, 'pin.json'), '{}'),
      () => writeFileSync(join(dir, 'pin.json'), JSON.stringify({ ...pin, candidate: 'absent-v1.md' })),
      () => writeFileSync(join(dir, 'pin.json'), JSON.stringify({ ...pin, sha256: '0'.repeat(64) })),
      () => writeFileSync(join(dir, 'slot.json'), JSON.stringify({ ...doc, id: 'context.foreign' })),
      () => writeFileSync(join(dir, 'slot.json'), JSON.stringify({ ...doc, ia: { ...doc.ia, order: doc.ia.order + 1 } })),
      ...[serializeFrontmatter({ ...fields, slot: 'context.foreign' }, body), serializeFrontmatter(fields, '## Direction\nMalformed brief')].map(bytes => () => {
        writeFileSync(join(dir, 'candidates/brief-v1.md'), bytes);
        writeFileSync(join(dir, 'pin.json'), JSON.stringify({ ...pin, sha256: createHash('sha256').update(bytes).digest('hex') }));
      }),
    ]) { restore(); mutation(); noPreview(); }
    restore();
    expect(slotDetail(root, 'director', id)!.checks).toContainEqual(expect.objectContaining({ label: { copy: 'studio.check-slot-placed' }, ok: true }));
    writeFileSync(join(dir, 'slot.json'), JSON.stringify({ ...doc, id: 'context.foreign' }));
    const misplaced = slotDetail(root, 'director', id)!;
    expect(misplaced.checks).toContainEqual(expect.objectContaining({ label: { copy: 'studio.check-slot-placed' }, ok: false }));
    expect(misplaced.checks).toContainEqual(expect.objectContaining({ label: { copy: 'studio.check-inputs-ready' }, ok: false }));
    expect(misplaced.checks).toContainEqual({ label: id, ok: false, detail: 'invalid-slot' });
    expect(slotDetail(root, 'director', 'context.unknown')).toBeUndefined();
  });

  it('links all six viewports only to the exact canonical pin without any legacy artifact', () => {
    const { root } = fixture();
    const consumer = join(root, 'clossys');
    const designer = join(consumer, 'agents/designer');
    const dir = join(designer, 'sections.example');
    mkdirSync(join(dir, 'candidates'), { recursive: true });
    const ia: IaDoc = { schema: 'clossys.ia/1', source: 'synthetic-test-only#B4-designer-viewport', extensions: [],
      nodes: [{ id: 'sections.test', label: 'Sections', children: [{ id: 'test-records', label: 'Test records', slots: ['sections.example'] }] }] };
    writeFileSync(join(designer, 'ia.json'), JSON.stringify(ia));
    writeFileSync(join(dir, 'slot.json'), JSON.stringify({ schema: 'clossys.slot/1', id: 'sections.example', agent: 'designer',
      ia: slotPositions('designer', ia).get('sections.example'), kind: 'element', contract: {}, inputs: [], uses: [] }));
    const item = { name: 'example', type: 'registry:block', files: [{ path: 'index.tsx', type: 'registry:component', content: 'export default function Example() { return null; }' }] };
    const file = join(dir, 'candidates/example-v1.json');
    const bytes = JSON.stringify({ ...item, meta: { slot: 'sections.example', source: { kind: 'original', ref: [] } } });
    writeFileSync(file, bytes);
    const pin = { candidate: 'example-v1.json', sha256: createHash('sha256').update(bytes).digest('hex'), decidedBy: 'owner:synthetic-test-only:canonical-viewport', at: '2026-01-01T00:00:00Z' };
    writeFileSync(join(dir, 'pin.json'), JSON.stringify(pin));
    const detail = slotDetail(root, 'designer', 'sections.example')!;
    const inputs = slotDetailInputs(detail, links, 'dark');
    expect(inputs.specimen).toMatchObject({ kind: 'viewports', specimens: [375, 768, 1280].map(viewport => ({ viewport,
      light: `/__specimen?element=sections.example%2Fexample&theme=light&width=${viewport}&v=1`,
      dark: `/__specimen?element=sections.example%2Fexample&theme=dark&width=${viewport}&v=1`,
    })) });
    writeFileSync(join(dir, 'candidates/example-v2.json'), bytes);
    expect(slotDetail(root, 'designer', 'sections.example')!.candidates[1]!.specimen).toBeUndefined();
    writeFileSync(file, bytes + '\n');
    expect(slotDetail(root, 'designer', 'sections.example')!.candidates[0]!.specimen).toBeUndefined();
    // Even a matching hash cannot grant a candidate with another element identity.
    const wrong = JSON.stringify({ ...JSON.parse(bytes), name: 'other' });
    writeFileSync(file, wrong);
    writeFileSync(join(dir, 'pin.json'), JSON.stringify({ ...pin, sha256: createHash('sha256').update(wrong).digest('hex') }));
    expect(slotDetail(root, 'designer', 'sections.example')!.candidates[0]!.specimen).toBeUndefined();
    expect(slotDetail(root, 'designer', 'sections.example')!.candidates[0]!.issues).toContain('candidate-identity: element identity differs from the candidate name or slot');
  });
});
