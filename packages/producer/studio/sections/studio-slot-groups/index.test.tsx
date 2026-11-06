import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import SlotGroupsSection, { type SlotCard, type SlotGroupsInput } from './index';

const EMPTY = 'No rendered specimen at this size yet; the slot has no pinned candidate to preview.';

function card(id: string, specimen: SlotCard['specimen']): SlotCard {
  return { id, name: id, href: `/designer/${id}`, statusLabel: 'Pinned', statusTone: 'secondary', version: 1, versionLabel: 'v1', specimen };
}
const framed = (id: string) => card(id, { name: id, kind: 'viewports', empty: EMPTY, specimens: [{ viewport: 1280, light: `/__specimen?element=${encodeURIComponent(id)}&width=1280`, title: id }] });

function render(groups: SlotGroupsInput) {
  return new JSDOM(renderToStaticMarkup(<SlotGroupsSection groups={groups} />), { url: "http://localhost/" }).window.document;
}

describe('slot-groups gallery (R2F-03b)', () => {
  it('lays cards out in responsive rows of two, padding a short last row so every card keeps half the width', () => {
    const document = render({ empty: 'none', groups: [{ id: 'g', label: 'Group', cards: ['a', 'b', 'c'].map(framed) }] });
    const rows = [...document.querySelectorAll('[data-slot="field-group"] > [data-slot="field"]')];
    expect(rows.map(row => row.getAttribute('data-orientation'))).toEqual(['responsive', 'responsive']);
    expect(rows.map(row => [...row.children].map(cell => cell.getAttribute('data-slot')))).toEqual([['field-content', 'field-content'], ['field-content', 'field-content']]);
    expect(rows.map(row => [...row.querySelectorAll('[data-slot-card]')].map(node => node.getAttribute('data-slot-card')))).toEqual([['a', 'b'], ['c']]);
    expect(rows[1]!.lastElementChild!.getAttribute('aria-hidden')).toBe('true');
    expect(rows[1]!.lastElementChild!.children).toHaveLength(0);
  });

  it('frames a preview in a fixed-aspect host the specimen frame scales to fit, never a fixed pixel height', () => {
    const document = render({ empty: 'none', groups: [{ id: 'g', label: 'Group', cards: [framed('a')] }] });
    const frame = document.querySelector('iframe')!;
    const host = frame.parentElement!;
    expect(host.getAttribute('data-slot')).toBe('card-content');
    expect(host.getAttribute('data-specimen-fit')).toBe('content');
    expect(host.className.split(/\s+/)).toContain('aspect-square');
    expect(frame.getAttribute('width')).toBe('100%');
    expect(frame.getAttribute('height')).toBe('100%');
    expect(frame.getAttribute('loading')).toBe('lazy');
  });

  it('never sets a long decision line (Not needed: <reason>) in a single-line badge, so it cannot widen the card', () => {
    const reason = 'Not needed: planner:DS-COMPLETE; no pinned candidate, slot uses list or publication composes it; candidate v1 has no trusted registry lineage.';
    const decided = card('decided', { name: 'decided', kind: 'record', empty: reason, status: { label: reason, tone: 'secondary', description: 'components.decided' } });
    const document = render({ empty: 'none', groups: [{ id: 'g', label: 'Group', cards: [decided] }] });
    const shown = document.querySelector('[data-preview-status="status"]')!;
    expect(shown.textContent).toBe(reason);
    expect(shown.closest('[data-slot="badge"]')).toBeNull();
    expect(shown.getAttribute('data-slot')).toBe('card-description');
    expect([...document.querySelectorAll('[data-slot="badge"]')].map(node => node.textContent)).not.toContain(reason);
  });

  it('never sets the long empty-state text in a single-line badge, so it cannot run out of the card', () => {
    const empties = [
      card('none', { name: 'none', kind: 'viewports', empty: EMPTY, specimens: [] }),
      card('record', { name: 'record', kind: 'record', empty: EMPTY }),
    ];
    const document = render({ empty: 'none', groups: [{ id: 'g', label: 'Group', cards: empties }] });
    const shown = [...document.querySelectorAll('[data-preview-status="empty"]')];
    expect(shown).toHaveLength(2);
    for (const node of shown) {
      expect(node.textContent).toBe(EMPTY);
      expect(node.closest('[data-slot="badge"]')).toBeNull();
      expect(node.getAttribute('data-slot')).toBe('card-description');
    }
  });
});
