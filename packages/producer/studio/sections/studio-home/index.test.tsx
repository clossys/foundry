import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import HomeSection, { type HomeCensus, type HomeInput } from './index';

function render(census?: HomeCensus) {
  const home: HomeInput = { agentsLabel: 'Agents', agents: [{
    id: 'designer', label: 'Designer', purpose: 'Build interface parts', icon: <svg className="size-4" />,
    href: '/library', openLabel: 'Open library', census,
    // An old renderer count must never masquerade as a slot census.
    count: { label: '999 rendered cards', tone: 'secondary' },
  }] };
  return new JSDOM(renderToStaticMarkup(<HomeSection home={home} />)).window.document;
}

describe('Home slot census presentation', () => {
  it('displays the supplied census independently of renderer/map counts', () => {
    // Includes empty slots and older pins; collection semantics belong to the census reader.
    const document = render({ state: 'ready', total: 435, withCandidate: 32, pinned: 19 });
    const card = document.querySelector('[data-home-agent]')!;
    expect(card.getAttribute('data-census-state')).toBe('ready');
    expect(card.querySelector('[data-slot="card-title"]')!.textContent?.trim()).toBe('435');
    expect(card.querySelector('[data-slot="badge"]')!.getAttribute('aria-label')).toBe('32 slots with candidates');
    expect(card.querySelector('[data-slot="card-footer"]')!.textContent).toContain('19 pinned slots');
    expect(card.textContent).not.toContain('999');
    expect(card.querySelector('a,button,[data-slot="card-content"]')).toBeNull();
  });

  it('keeps a true empty census distinct from an error', () => {
    const card = render({ state: 'ready', total: 0, withCandidate: 0, pinned: 0 }).querySelector('[data-home-agent]')!;
    expect(card.querySelector('[data-slot="card-title"]')!.textContent?.trim()).toBe('0');
    expect(card.textContent).toContain('0 pinned slots');
    expect(card.textContent).not.toContain('Unavailable');
  });

  it('shows the supplied error without a zero or a loading placeholder', () => {
    const card = render({ state: 'error', message: 'Slot census request failed' }).querySelector('[data-home-agent]')!;
    expect(card.getAttribute('data-census-state')).toBe('error');
    expect(card.textContent).toContain('Slot census request failed');
    expect(card.textContent).toContain('Unavailable');
    expect(card.textContent).not.toMatch(/Loading|0 pinned slots|999/);
    expect(card.querySelector('[data-slot="card-title"]')!.textContent?.trim()).toBe('—');
  });

  it('distinguishes an in-flight census from a missing loader handoff', () => {
    expect(render({ state: 'loading' }).querySelector('[data-home-agent]')!.textContent).toContain('Loading');
    const missing = render().querySelector('[data-home-agent]')!;
    expect(missing.getAttribute('data-census-state')).toBe('missing');
    expect(missing.textContent).toContain('Unavailable');
    expect(missing.textContent).not.toContain('Loading');
  });
});
