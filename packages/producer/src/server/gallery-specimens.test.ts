import { createElement } from 'react';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentGallery, agentLeaf } from './agent-library.js';
import { slotDetail, type SlotDetail } from './slot-detail.js';
import { agentGalleryLayers, type AgentCard, type AgentLeafRecords, type GalleryPreviews } from '../../studio/lib/agent-library';
import { loadGalleryLeaves, galleryLeafInputs } from '../../studio/lib/gallery-specimens';
import { slotDetailInputs } from '../../studio/lib/slot-detail';
import { SpecimenContent } from '../../studio/sections/studio-specimen';
import { parsePublicationResponse } from '../../studio/lib/publisher-preview';
import { contractCopy } from '../../studio/lib/contract-copy';

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
    expect(inputs.contract).toEqual({ ...legacy.contract, copy: contractCopy() });
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

  it('preserves canonical contracts and does not use a raw URL as native preview evidence', () => {
    const detail = slotDetail(repo, 'publisher', 'publication.studio')!;
    const url = '/preview/example/frame/home.html?theme=dark&width=1280';
    const publication = galleryLeafInputs({ source: 'slot', detail }, links, 'dark', url);
    expect(publication.specimen.kind).toBe('record');
    expect(publication.contract).toEqual(slotDetailInputs(detail, links, 'dark').contract);
    const page = galleryLeafInputs({ source: 'slot', detail: { ...detail, kind: 'page' } }, links, 'dark', url);
    expect(page.specimen).toMatchObject({ kind: 'viewports', specimens: [] });
  });

  it('projects all six native gallery width/theme combinations in stable order and rejects pin drift', () => {
    const content = JSON.stringify({ schema: 'clossys.page/1', title: 'Example', path: '/example', frame: null, sections: [], copy: {}, meta: { source: { kind: 'original', ref: [] } } });
    const sha256 = createHash('sha256').update(content).digest('hex');
    const detail: SlotDetail = {
      agent: 'publisher', id: 'page.example', kind: 'page', trail: [],
      contract: { purpose: 'Synthetic gallery test' }, inputs: [], uses: [], usedBy: [], links: [], history: [], checks: [],
      shown: 'example-v1.json', candidates: [{ name: 'example-v1.json', version: 1, sha256, pinned: true, content, source: { kind: 'original', ref: [] }, issues: [] }],
      pin: { candidate: 'example-v1.json', sha256, pinnedBy: 'migration:SLOT-MODEL', at: '2026-10-31T00:00:00Z' },
    };
    const publication = parsePublicationResponse({ state: 'ready', publication: 'example', publications: ['example'],
      manifest: { schemaVersion: 1, publication: 'example', contentMap: { entries: [] } },
      pages: [{ id: 'emitted-example', cellId: detail.id, route: '/example', previewUrl: '/preview/example/pages/emitted-example.html', frameUrl: '/preview/example/frame/emitted-example.html', emitted: true }],
    });
    const rawUrl = '/preview/example/frame/emitted-example.html?theme=dark&width=1280';
    for (const theme of ['light', 'dark'] as const) {
      const inputs = galleryLeafInputs({ source: 'slot', detail }, links, theme, rawUrl, publication);
      expect(inputs.specimen).toMatchObject({ kind: 'viewports', specimens: [375, 768, 1280].map(viewport => ({ viewport,
        light: `/preview/example/frame/emitted-example.html?theme=light&width=${viewport}`,
        dark: `/preview/example/frame/emitted-example.html?theme=dark&width=${viewport}`,
        interactive: false,
      })) });
      if (inputs.specimen.kind !== 'viewports') throw new Error('Expected viewport specimens');
      expect(inputs.specimen.specimens.flatMap(row => [row.light, row.dark])).toHaveLength(6);
      expect(inputs.contract).toEqual(slotDetailInputs(detail, links, theme, publication).contract);
    }
    for (const rejected of [
      { ...detail, pin: null, candidates: detail.candidates.map(candidate => ({ ...candidate, pinned: false })) },
      { ...detail, pin: { ...detail.pin!, sha256: '0'.repeat(64) } },
      { ...detail, candidates: detail.candidates.map(candidate => ({ ...candidate, issues: ['Invalid candidate'] })) },
    ]) expect(galleryLeafInputs({ source: 'slot', detail: rejected }, links, 'light', rawUrl, publication).specimen).toMatchObject({ kind: 'viewports', specimens: [] });
  });
});
