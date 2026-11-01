import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { GroupSection } from './GroupSection';
import { LeafCard } from './LeafCard';
import type { GalleryCardData } from './types';

const card: GalleryCardData = { key: 'sample', name: 'Sample slot', href: '/library/sample', statusTone: 'outline', statusLabel: 'No candidate' };

describe('source-backed gallery hunks', () => {
  it('keeps every supplied leaf in order in one stock vertical flow', () => {
    const document = new JSDOM(renderToStaticMarkup(<GroupSection unit={['slot', 'slots']} group={{ id: 'group', label: 'Group', level: 1, cards: [card, { ...card, key: 'second', name: 'Second slot' }] }} />)).window.document;
    const flow = document.querySelector('[data-layout="list"]')!;
    expect(flow.className).toBe('flex flex-col gap-4 py-4 md:gap-6 md:py-6');
    expect([...flow.children].map(row => row.getAttribute('data-gallery-leaf'))).toEqual(['sample', 'second']);
    expect(document.querySelector('[data-slot="card-grid"]')).toBeNull();
    expect(document.querySelector('a')!.getAttribute('href')).toBe(card.href);
    expect(document.querySelector('a')!.className).toBe('underline underline-offset-4');
  });

  it('uses the picked skeleton only for loading and preserves a failed preview as a status', () => {
    const loading = new JSDOM(renderToStaticMarkup(<LeafCard level={4} card={{ ...card, specimenStatus: { label: 'Loading preview', tone: 'outline', loading: true } }} />)).window.document;
    expect(loading.querySelector('[data-slot="skeleton"]')!.className).toContain('aspect-square w-full');
    const error = new JSDOM(renderToStaticMarkup(<LeafCard level={4} card={{ ...card, specimenStatus: { label: 'Preview request failed', tone: 'destructive' } }} />)).window.document;
    expect(error.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(error.querySelector('[data-preview-status="status"]')!.textContent).toBe('Preview request failed');
  });
});
