import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentGallery, agentLeaf } from './agent-library.js';
import { slotDetail } from './slot-detail.js';
import { recordSpecimenInput } from './slot-gallery.js';
import { listSlots, readCandidate } from '../records/slots.js';
import { agentGalleryLayers, type AgentCard, type AgentLeafRecords, type GalleryPreviews } from '../../studio/lib/agent-library';
import { loadGalleryLeaves, galleryLeafInputs } from '../../studio/lib/gallery-specimens';
import { slotDetailInputs } from '../../studio/lib/slot-detail';
import { SpecimenContent, type SpecimenInput } from '../../studio/sections/studio-specimen';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const links = { gallery: (agent: string) => `/${agent}`, leaf: (agent: string, id: string) => `/${agent}/${id}` };
const signal = () => new AbortController().signal;
const card: AgentCard = { id: 'page.example', slug: 'page.example', name: 'Example', version: 1, status: 'active', records: 1, excerpt: [] };
const legacy: AgentLeafRecords = {
  agent: 'publisher', card, trail: [], statusDetail: [], specimen: { summary: 'Legacy page', rows: [{ label: 'Page', text: 'Legacy content' }] },
  contract: { facts: [{ label: 'Frame', value: 'frames.example' }], lists: [{ label: 'Sections', items: ['sections.example'] }] }, checks: [], history: [], uses: [], usedBy: [],
};
afterEach(() => vi.unstubAllGlobals());

describe('slot-first gallery specimen collection', () => {
  it('preserves every pinned migrated Studio string in native specimens, details and shared rendering', async () => {
    const reference: { locale: string; entries: { id: string; text: string }[] } = JSON.parse(readFileSync(join(repo, 'packages/producer/studio/generated/studio-copy.json'), 'utf8'));
    expect(reference.locale).toBe('en');
    const expected = new Map(reference.entries.map(row => [row.id, row.text]));
    expect(expected.size).toBe(218);
    const counts = { 'strings.common': 168, 'strings.statuses': 26, 'strings.descriptions': 5, 'strings.field-labels': 19 };
    const consumer = join(repo, 'clossys');
    const entries = listSlots(consumer, 'writer');
    const gallery = (await agentGallery(repo, 'writer'))!;
    const cards = gallery.sections.flatMap(section => section.cards);
    const seen: string[] = [];
    const renderedTexts = (specimen: SpecimenInput) => {
      const document = new JSDOM(renderToStaticMarkup(createElement(SpecimenContent, { specimen }))).window.document;
      expect(document.querySelector('iframe')).toBeNull();
      return [...document.querySelectorAll('[data-slot="table-cell"]')].filter((_, index) => index % 2 === 1).map(cell => cell.textContent);
    };
    for (const [id, count] of Object.entries(counts)) {
      const entry = entries.find(row => row.id === id)!;
      const pin = entry.pin!;
      const candidate = readCandidate(consumer, 'writer', id, pin.candidate);
      expect(candidate.sha256).toBe(pin.sha256);
      // Read identities from the real pinned payload; expected text is independent
      // of the tested specimen parsers and comes from F7's generated registry.
      const ids = [...candidate.bytes.matchAll(/^<!-- (.+) -->$/gm)].map(match => JSON.parse(match[1]!).id as string);
      expect(ids).toHaveLength(count);
      for (const key of ids) expect(expected.has(key)).toBe(true);
      seen.push(...ids);
      const texts = ids.map(key => expected.get(key)!);
      const card = cards.find(row => row.id === id)!;
      const url = new URL(card.specimenUrl!, 'http://studio.invalid');
      expect(Object.fromEntries(url.searchParams)).toMatchObject({ agent: 'writer', slot: id, candidate: pin.candidate });
      const native = recordSpecimenInput(consumer, 'writer', id)!;
      expect(native.rows).toEqual(ids.map((key, index) => ({ key: String(index), label: `en: ${key}`, text: texts[index] })));
      const detail = slotDetail(repo, 'writer', id)!;
      expect(detail.shown).toBe(pin.candidate);
      expect(detail.candidates.find(row => row.name === detail.shown)?.sha256).toBe(pin.sha256);
      const detailPreview = slotDetailInputs(detail, links, 'light').specimen as SpecimenInput;
      const galleryPreview = galleryLeafInputs({ source: 'slot', detail }, links, 'light').specimen;
      expect(detailPreview).toMatchObject({ kind: 'record', rows: ids.map((key, index) => ({ key: `en/${key}`, text: texts[index] })) });
      expect(galleryPreview).toEqual(detailPreview);
      for (const preview of [native, detailPreview, galleryPreview]) expect(renderedTexts(preview)).toEqual(texts);
    }
    expect([...seen].sort()).toEqual([...expected.keys()].sort());
    // This separate existing draft is still a NEED, not one of the migrated
    // candidates. Rendering must not silently shorten it to its 60-char limit.
    const draft = JSON.parse(readFileSync(join(repo, 'packages/writer/src/catalog/records/admin-studio.r1.en.json'), 'utf8')).records.find((row: { id: string }) => row.id === 'st.aqdaz871km');
    expect(expected.has(draft.id)).toBe(false);
    expect(draft.text).toHaveLength(85);
    expect(draft.text.length).toBeGreaterThan(60);
    expect(renderedTexts({ kind: 'record', name: draft.id, title: '', description: '', empty: '', rows: [{ key: draft.id, label: draft.id, text: draft.text }] })).toEqual([draft.text]);
  }, 15_000);

  it('renders a native publication candidate without a legacy cell and makes zero legacy requests', async () => {
    const gallery = (await agentGallery(repo, 'publisher'))!;
    const cards = gallery.sections.flatMap(section => section.cards) as AgentCard[];
    const detail = slotDetail(repo, 'publisher', 'publication.studio')!;
    expect(detail.shown).toBeDefined();
    expect(await agentLeaf(repo, 'publisher', 'publication.studio')).toBeUndefined();
    const legacyRequests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/slots/publisher/')) {
        const value = slotDetail(repo, 'publisher', decodeURIComponent(url.split('/').at(-1)!));
        return value ? Response.json({ state: 'ready', detail: value }) : new Response('', { status: 404 });
      }
      legacyRequests.push(url);
      return Response.json({ state: 'missing' }, { status: 404 });
    }));
    const collected = await loadGalleryLeaves('publisher', cards, signal());
    expect.soft(legacyRequests).toEqual([]);
    const previews: GalleryPreviews = new Map([...collected].map(([id, row]) => [id, row ? galleryLeafInputs(row, links, 'light').specimen : null]));
    const actual = previews.get('publication.studio');
    expect.soft(actual).toEqual(slotDetailInputs(detail, links, 'light').specimen);
    expect.soft(actual).toMatchObject({ kind: 'record', title: 'Candidate', rows: [{ text: detail.candidates.find(row => row.name === detail.shown)!.content }] });
    if (actual) expect(renderToStaticMarkup(createElement(SpecimenContent, { specimen: actual }))).toContain('clossys.publication/1');
    const layers = agentGalleryLayers({ state: 'ready', ...gallery } as never, links, previews);
    expect(layers.flatMap(layer => layer.groups.flatMap(group => group.cards.map(row => row.key)))).toEqual(cards.map(row => row.id));
    expect(layers.flatMap(layer => layer.groups.flatMap(group => group.cards)).filter(row => row.key === 'publication.studio')).toHaveLength(1);
  });

  it('falls back only on an explicit legacy response and preserves its contract', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ state: 'legacy' })).mockResolvedValueOnce(Response.json({ state: 'ready', leaf: legacy }));
    vi.stubGlobal('fetch', fetch);
    const rows = await loadGalleryLeaves('publisher', [card], signal());
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/slots/publisher/page.example', '/api/agents/publisher/library/page.example']);
    const inputs = galleryLeafInputs(rows.get(card.id)!, links, 'light');
    expect(inputs.contract).toEqual(legacy.contract);
    expect(inputs.specimen.kind).toBe('record');
  });

  it.each([
    ['missing', () => new Response('', { status: 404 })],
    ['error', () => new Response('', { status: 500 })],
    ['malformed', () => Response.json({ state: 'ready', detail: {} })],
  ])('keeps a %s slot unavailable without a legacy request', async (_label, response) => {
    const fetch = vi.fn().mockImplementation(response); vi.stubGlobal('fetch', fetch);
    expect((await loadGalleryLeaves('publisher', [card], signal())).get(card.id)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe('/api/slots/publisher/page.example');
  });

  it('retains missing-pin candidate data without legacy fallback and skips empty/failed or already-projected previews', async () => {
    const original = slotDetail(repo, 'publisher', 'publication.studio')!;
    const detail = { ...original, pin: null, candidates: original.candidates.map(row => ({ ...row, pinned: false })) };
    const fetch = vi.fn().mockResolvedValue(Response.json({ state: 'ready', detail })); vi.stubGlobal('fetch', fetch);
    const cards = [{ ...card, id: detail.id, slug: detail.id, emptyState: 'No pin' as const }, { ...card, id: 'empty', records: 0, status: 'missing' as const }, { ...card, id: 'failed', records: 0, status: 'failing' as const }, { ...card, id: 'projected', specimenUrl: '/__specimen?agent=writer&slot=strings.example' }];
    const rows = await loadGalleryLeaves('publisher', cards, signal());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect([...rows.keys()]).toEqual([detail.id]);
    expect(galleryLeafInputs(rows.get(detail.id)!, links, 'light').specimen).toEqual(slotDetailInputs(detail, links, 'light').specimen);
    expect(agentGalleryLayers({ state: 'ready', agent: 'publisher', count: cards.length, sections: [{ id: 'group', label: 'Group', level: 1, cards }] }, links)[0]!.groups[0]!.cards.map(row => row.statusLabel)).toEqual(['No pin', 'Missing', 'Failing', 'Active']);
  });

  it('preserves canonical contracts and uses an emitted preview only for a page-kind slot', () => {
    const detail = slotDetail(repo, 'publisher', 'publication.studio')!;
    const url = '/preview/example/frame/home.html?theme=dark&width=1280';
    const publication = galleryLeafInputs({ source: 'slot', detail }, links, 'dark', url);
    expect(publication.specimen.kind).toBe('record');
    expect(publication.contract).toEqual(slotDetailInputs(detail, links, 'dark').contract);
    const page = galleryLeafInputs({ source: 'slot', detail: { ...detail, kind: 'page' } }, links, 'dark', url);
    expect(page.specimen).toMatchObject({ kind: 'viewports', specimens: [{ viewport: 1280, light: url, interactive: false }] });
  });
});
