import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { overflowFindings } from './studio-overflow.mjs';

// Geometry is explicit because jsdom has no layout engine. Exercise the actual browser probe.
function fixture() {
  const { document } = new JSDOM('<main><div data-slot="card" style="overflow-x:hidden;overflow-y:hidden"><span data-slot="badge">19 pinned</span></div></main>').window;
  const rect = (left, right, top = 0, bottom = 60) => ({ left, right, top, bottom, width: right - left, height: bottom - top });
  const dimensions = (element, { clientWidth = 300, scrollWidth = clientWidth, clientHeight = 60, scrollHeight = clientHeight } = {}) => {
    for (const [name, value] of Object.entries({ clientWidth, scrollWidth, clientHeight, scrollHeight })) Object.defineProperty(element, name, { value, configurable: true });
  };
  for (const element of document.querySelectorAll('*')) {
    dimensions(element);
    element.getBoundingClientRect = () => rect(0, 300);
  }
  return { document, rect, dimensions, card: document.querySelector('[data-slot="card"]'), badge: document.querySelector('[data-slot="badge"]') };
}

test('accepts contained content at all required viewport widths', () => {
  for (const width of [375, 768, 1280]) {
    const { document, dimensions } = fixture();
    dimensions(document.documentElement, { clientWidth: width });
    assert.deepEqual(overflowFindings(document), []);
  }
});

test('rejects a badge clipped at a card edge even when card scroll metrics fit', () => {
  const { document, badge, rect } = fixture();
  badge.getBoundingClientRect = () => rect(280, 340, 0, 20);
  assert.ok(overflowFindings(document).some(row => row.rule === 'descendant-clipped' && row.slot === 'badge' && row.ancestor === 'card' && row.axis === 'x'));
});

test('rejects page overflow and vertically clipped card content', () => {
  const { document, card, dimensions } = fixture();
  dimensions(document.documentElement, { clientWidth: 375, scrollWidth: 420 });
  dimensions(card, { scrollHeight: 90 });
  const rows = overflowFindings(document);
  assert.ok(rows.some(row => row.rule === 'viewport-overflow' && row.hidden === 45));
  assert.ok(rows.some(row => row.rule === 'content-clipped-y' && row.hidden === 30));
});

test('accepts an explicit scroll owner but rejects silently overflowing content', () => {
  const { document, card, dimensions } = fixture();
  dimensions(card, { scrollWidth: 500 });
  card.style.overflowX = 'auto';
  assert.deepEqual(overflowFindings(document), []);
  card.style.overflowX = 'visible';
  assert.ok(overflowFindings(document).some(row => row.rule === 'content-overflow-x' && row.slot === 'card'));
});

test('accepts offscreen descendants inside nested deliberate scroll owners', () => {
  for (const overflow of ['auto', 'scroll']) {
    for (const axis of ['x', 'y']) {
      const { document, card, badge, rect, dimensions } = fixture();
      const scroller = document.createElement('div');
      scroller.dataset.slot = 'scroll-owner';
      scroller.style.setProperty(`overflow-${axis}`, overflow);
      scroller.getBoundingClientRect = () => rect(0, 300);
      dimensions(scroller, axis === 'x' ? { scrollWidth: 500 } : { scrollHeight: 120 });
      card.append(scroller);
      scroller.append(badge);
      badge.getBoundingClientRect = () => axis === 'x' ? rect(400, 440, 0, 20) : rect(0, 40, 80, 100);
      assert.deepEqual(overflowFindings(document), [], `${overflow} ${axis} owns its offscreen content`);
    }
  }
});

test('still rejects a scroll owner whose own viewport is clipped by the card', () => {
  const { document, card, badge, rect, dimensions } = fixture();
  const scroller = document.createElement('div');
  scroller.dataset.slot = 'scroll-owner';
  scroller.style.overflowX = 'auto';
  scroller.getBoundingClientRect = () => rect(0, 340);
  dimensions(scroller, { clientWidth: 340, scrollWidth: 500 });
  card.append(scroller);
  scroller.append(badge);
  const rows = overflowFindings(document);
  assert.ok(rows.some(row => row.rule === 'descendant-clipped' && row.slot === 'scroll-owner' && row.ancestor === 'card' && row.axis === 'x'));
});

test('the browser checks default to the page records at one width; --full sweeps every entry at three', async () => {
  const { WIDTHS, pageRecords, scopeEntries } = await import('./studio-dom-check.mjs');
  const entries = [{ id: 'home', path: '/' }, { id: 'designer-themes', path: '/designer/themes' }, { id: 'designer-themes.colors', path: '/designer/themes/colors' }, { id: 'designer-themes:accent', path: '/designer/themes/colors/accent' }];
  assert.deepEqual(pageRecords(entries).map(entry => entry.id), ['home', 'designer-themes']);
  assert.deepEqual(scopeEntries(entries).map(entry => entry.id), ['home', 'designer-themes']);
  assert.equal(scopeEntries(entries, { full: true }).length, 4);
  assert.deepEqual(scopeEntries(entries, { only: ['/designer/themes/colors'] }).map(entry => entry.id), ['designer-themes.colors']);
  assert.deepEqual([...WIDTHS.pages], [1280]);
  assert.deepEqual([...WIDTHS.full], [375, 768, 1280]);
});
