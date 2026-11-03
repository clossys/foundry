import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import AgentGallery from '.';
import { GroupSection } from './GroupSection';
import { LeafCard } from './LeafCard';
import type { AgentGalleryInput, GalleryCardData } from './types';

const card: GalleryCardData = { key: 'sample', name: 'Sample slot', state: 'empty', href: '/library/sample', statusTone: 'outline', statusLabel: 'No candidate' };
const dom = (html: string) => new JSDOM(html).window.document;

describe('agent gallery layout', () => {
  it('lays an L2 group out as a heading over a 1, 2, then 3 column card grid in order', () => {
    const document = dom(renderToStaticMarkup(<GroupSection section={{ id: 'group/part', label: 'Part', cards: [card, { ...card, key: 'second', name: 'Second slot' }] }} />));
    expect(document.querySelector('[role="heading"][aria-level="2"]')!.textContent).toBe('Part');
    const grid = document.querySelector('[data-layout="grid"]')!;
    expect(grid.className).toContain('grid-cols-1');
    expect(grid.className).toContain('md:grid-cols-2');
    expect(grid.className).toContain('xl:grid-cols-3');
    expect([...grid.children].map(row => row.getAttribute('data-gallery-leaf'))).toEqual(['sample', 'second']);
    expect(document.querySelector('a')!.getAttribute('href')).toBe(card.href);
  });

  it('shows one state badge, and an empty slot says so once with no body', () => {
    const document = dom(renderToStaticMarkup(<LeafCard level={3} card={card} />));
    expect([...document.querySelectorAll('[data-slot="badge"]')].map(badge => badge.textContent)).toEqual(['No candidate']);
    expect(document.querySelector('[data-slot="card-content"]')).toBeNull();
    expect(document.body.textContent!.match(/No candidate/g)).toHaveLength(1);
  });

  it('uses the skeleton only while loading and keeps a failed preview as a status', () => {
    const loading = dom(renderToStaticMarkup(<LeafCard level={3} card={{ ...card, state: 'pinned', specimenStatus: { label: 'Loading preview', tone: 'outline', loading: true } }} />));
    expect(loading.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    const error = dom(renderToStaticMarkup(<LeafCard level={3} card={{ ...card, state: 'pinned', specimenStatus: { label: 'Preview request failed', tone: 'destructive' } }} />));
    expect(error.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(error.querySelector('[data-preview-status="status"]')!.textContent).toBe('Preview request failed');
  });

  it('renders tabs per layer and only the selected L1 group', () => {
    const input: AgentGalleryInput = {
      header: { title: 'Agent', description: 'Purpose', pinned: 'Pinned 0/2' },
      layers: [
        { id: 'one', label: 'One', groups: [
          { id: 'a', label: 'A', count: 1, sections: [{ id: 'a/x', label: 'X', cards: [card] }] },
          { id: 'b', label: 'B', count: 1, sections: [{ id: 'b/y', label: 'Y', cards: [{ ...card, key: 'other' }] }] },
        ] },
        { id: 'two', label: 'Two', groups: [{ id: 'c', label: 'C', count: 0, sections: [] }] },
      ],
      selection: { layer: 'one', group: 'b' },
    };
    const document = dom(renderToStaticMarkup(<AgentGallery gallery={input} />));
    expect([...document.querySelectorAll('[role="tab"]')].map(tab => tab.textContent)).toEqual(expect.arrayContaining(['One', 'Two']));
    expect([...document.querySelectorAll('[data-gallery-leaf]')].map(leaf => leaf.getAttribute('data-gallery-leaf'))).toEqual(['other']);
  });
});
