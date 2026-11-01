import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { slotDetail } from './slot-detail.js';
import { detailStrings, loadSlotDetail, slotDetailInputs } from '../../studio/lib/slot-detail';
import { serializeFrontmatter } from '../records/slot-model/index.js';

const roots: string[] = [];
const id = 'passages.example';
const links = { gallery: (agent: string) => `/${agent}`, leaf: (agent: string, slot: string) => `/${agent}/${slot}` };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'slot-detail-')); roots.push(root);
  const agent = join(root, 'clossys/agents/writer');
  const dir = join(agent, 'passages.test/test-records', id);
  mkdirSync(join(dir, 'candidates'), { recursive: true });
  writeFileSync(join(agent, 'ia.json'), JSON.stringify({ schema: 'clossys.ia/1', source: 'writer#fixture', extensions: [], nodes: [
    { id: 'passages.test', label: 'Passages', children: [{ id: 'test-records', label: 'Test records', slots: [id] }] },
  ] }));
  writeFileSync(join(dir, 'slot.json'), JSON.stringify({ schema: 'clossys.slot/1', id, agent: 'writer', kind: 'strings',
    ia: { l0: 'passages', l1: 'passages.test', l2: 'test-records', order: 0 }, contract: { purpose: 'Example copy' }, inputs: [], uses: [] }));
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
    expect(inputs).toMatchObject({ header: { statusLabel: 'No candidate' }, specimen: { kind: 'record', rows: [], empty: 'No candidate' }, options: { rows: [] }, history: { rows: [] } });
    expect(inputs.checks).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Candidate recorded', ok: false })]));
    expect(slotDetail(root, 'writer', 'passages.unknown')).toBeUndefined();
  });

  it('shows the pin beside every candidate and preserves real Writer text', () => {
    const { root, dir } = fixture();
    const full = 'First line.\nSecond line. ' + 'Full specimen text. '.repeat(40);
    const first = candidate(dir, 1, full);
    candidate(dir, 2, 'An unapproved alternative');
    const sha256 = createHash('sha256').update(first.bytes).digest('hex');
    writeFileSync(join(dir, 'pin.json'), JSON.stringify({ candidate: first.name, sha256, pinnedBy: 'owner', at: '2026-01-01T00:00:00Z' }));
    const detail = slotDetail(root, 'writer', id)!;
    expect(detail.shown).toBe(first.name);
    expect(detail.checks.every(check => check.ok)).toBe(true);
    expect(detail.history).toEqual([expect.objectContaining({ candidate: first.name, commit: 'working-tree' })]);
    const inputs = slotDetailInputs(detail, links, 'dark');
    expect(inputs.specimen).toMatchObject({ rows: [{ key: 'en/heading', text: full }] });
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
    expect(slotDetailInputs(detail, links, 'light')).toMatchObject({ specimen: { rows: [] } });
  });

  it('reports broken hashes and derives used-by from slot.json rather than candidate prose', () => {
    const { root, dir } = fixture(); candidate(dir, 1, 'No references in this text');
    const file = join(dir, 'slot.json');
    writeFileSync(file, JSON.stringify({ schema: 'clossys.slot/1', id, agent: 'writer', kind: 'strings', ia: {}, contract: {}, inputs: ['identity.missing'], uses: [id] }));
    writeFileSync(join(dir, 'pin.json'), JSON.stringify({ candidate: 'copy-v1.md', sha256: '0'.repeat(64), pinnedBy: 'owner', at: '2026-01-01T00:00:00Z' }));
    const detail = slotDetail(root, 'writer', id)!;
    expect(detail.usedBy).toEqual([{ agent: 'writer', id }]);
    expect(detail.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Pin matches candidate bytes', ok: false }),
      expect.objectContaining({ label: 'identity.missing', ok: false }),
    ]));
    expect(slotDetailInputs(detail, links, 'light')).toMatchObject({ references: { usedBy: [{ label: id, href: `/writer/${id}` }] } });
  });

  it('keeps locale identities distinct and does not emit metadata as Writer copy', () => {
    expect(detailStrings('## en\n### title\n<!-- {"id":"a"} -->\nHello\n## fr\n### title\n<!-- {"id":"b"} -->\nBonjour')).toEqual([
      { key: 'en/title', text: 'Hello' }, { key: 'fr/title', text: 'Bonjour' },
    ]);
  });

  it('falls back only for an explicit legacy response, never a missing or malformed detail', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ state: 'legacy' })));
    expect(await loadSlotDetail('writer', id, signal)).toBeUndefined();
    fetch.mockResolvedValueOnce(new Response('', { status: 404 }));
    expect(await loadSlotDetail('writer', id, signal)).toBeNull();
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ state: 'ready' })));
    await expect(loadSlotDetail('writer', id, signal)).rejects.toThrow('Slot detail response is invalid');
  });

  it('links all six live viewports only to a matching library artifact', () => {
    const { root } = fixture();
    const consumer = join(root, 'clossys');
    const designer = join(consumer, 'agents/designer');
    const dir = join(designer, 'sections.test/test-records/sections.example');
    mkdirSync(join(dir, 'candidates'), { recursive: true });
    writeFileSync(join(designer, 'ia.json'), JSON.stringify({ nodes: [{ id: 'sections.test', label: 'Sections', children: [{ id: 'test-records', label: 'Test records', slots: ['sections.example'] }] }] }));
    writeFileSync(join(dir, 'slot.json'), JSON.stringify({ id: 'sections.example', kind: 'element', contract: {}, inputs: [], uses: [] }));
    const item = { name: 'example', type: 'registry:block', files: [{ path: 'index.tsx', type: 'registry:component', content: 'export default function Example() { return null; }' }] };
    writeFileSync(join(dir, 'candidates/example-v1.json'), JSON.stringify({ ...item, meta: { slot: 'sections.example', source: { kind: 'registry', ref: ['example'] } } }));
    const library = join(consumer, 'library/sections.example/example/v1'); mkdirSync(library, { recursive: true });
    writeFileSync(join(library, 'registry-item.json'), JSON.stringify(item));
    writeFileSync(join(consumer, 'selection.json'), JSON.stringify({ pins: { 'sections.example': { element: 'example', version: 1 } } }));
    const detail = slotDetail(root, 'designer', 'sections.example')!;
    const inputs = slotDetailInputs(detail, links, 'dark');
    expect(inputs.specimen).toMatchObject({ kind: 'viewports', specimens: [375, 768, 1280].map(viewport => ({ viewport,
      light: `/__specimen?element=sections.example%2Fexample&theme=light&width=${viewport}&v=1`,
      dark: `/__specimen?element=sections.example%2Fexample&theme=dark&width=${viewport}&v=1`,
    })) });
    writeFileSync(join(library, 'registry-item.json'), JSON.stringify({ ...item, files: [] }));
    expect(slotDetail(root, 'designer', 'sections.example')!.candidates[0]!.specimen).toBeUndefined();
  });
});
