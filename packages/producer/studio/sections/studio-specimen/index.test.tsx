import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SpecimenSection, { SpecimenContent, specimenSource, type SpecimenInput, type ViewportSpecimen } from './index';

const frames: ViewportSpecimen[] = [375, 768, 1280].map(viewport => ({
  viewport: viewport as ViewportSpecimen['viewport'],
  light: `/__specimen?element=example&width=${viewport}&theme=light`,
  dark: `/__specimen?element=example&width=${viewport}&theme=dark`,
  heading: `${viewport} px`, title: `Example at ${viewport} px, light`, darkTitle: `Example at ${viewport} px, dark`,
}));
const rowsCopy = { label: 'Example specimen', key: 'Key', content: 'Content' };
const render = (element: React.ReactNode) => new JSDOM(renderToStaticMarkup(element)).window.document;

describe('detail and gallery specimen binding', () => {
  it.each(['tables', 'rows'] as const)('keeps complete Writer %s content in the stock table, scrolling rather than clipping in a narrow candidate pane', kind => {
    const values = ['Publications', 'Overview', '  significant spaces\nsecond line  ', 'UnbrokenRecordValue'.repeat(24)];
    const specimen: SpecimenInput = {
      kind: 'record', name: 'strings.common', title: 'Candidate', description: '', empty: 'No records', rowsCopy, citation: null,
      ...(kind === 'tables' ? {
        tables: [{ id: 'strings', label: 'Strings', columns: ['Key', 'Text'], prose: 1,
          rows: values.map((text, index) => ({ key: `record-${index}`, cells: [{ text: `record-${index}` }, { text, ...(index === 3 ? { href: '/records/long' } : {}) }] })),
        }],
      } : {
        rows: values.map((text, index) => ({ key: `record-${index}`, label: `record-${index}`, text, ...(index === 3 ? { href: '/records/long' } : {}) })),
      }),
    };
    const before = JSON.stringify(specimen);
    const document = render(<SpecimenContent specimen={specimen} />);
    const cells = [...document.querySelectorAll<HTMLElement>('[data-slot="table-cell"]')];
    expect(cells.map(cell => cell.textContent)).toEqual(values.flatMap((text, index) => [`record-${index}`, text]));
    // Stock aria-nova table (P0 shadcn reset): cells keep the stock classes and are never clipped; a wide
    // record scrolls inside the stock table container instead of being restyled to wrap.
    expect(cells.every(cell => !['min-w-48', 'truncate', 'overflow-hidden', 'text-ellipsis', 'line-clamp-1'].some(token => cell.classList.contains(token)))).toBe(true);
    expect(cells.every(cell => !cell.hasAttribute('style'))).toBe(true);
    const container = cells[0]!.closest('[data-slot="table-container"]')!;
    expect(container.classList.contains('overflow-x-auto')).toBe(true);
    const link = document.querySelector<HTMLElement>('a[href="/records/long"]')!;
    expect(link.textContent).toBe(values[3]);
    expect(container.contains(link)).toBe(true);
    expect(['truncate', 'overflow-hidden', 'text-ellipsis'].some(token => link.classList.contains(token))).toBe(false);
    expect(JSON.stringify(specimen)).toBe(before);
  });

  it('preserves every projected viewport/theme without a ratio frame', () => {
    const document = render(<SpecimenContent specimen={{ kind: 'viewports', name: 'Example', title: 'Specimen', description: '', specimens: frames, empty: 'No preview' }} />);
    const actual = [...document.querySelectorAll('iframe')];
    expect(actual).toHaveLength(6);
    expect(actual.map(frame => frame.getAttribute('src'))).toEqual([...frames].reverse().flatMap(row => [row.light, row.dark]));
    // Each frame is the page at its own CSS width and a screen-sized height, unstyled, in a stock scroll area.
    expect(actual.map(frame => [frame.width, frame.height])).toEqual([[1280, 800], [1280, 800], [768, 1024], [768, 1024], [375, 667], [375, 667]].map(pair => pair.map(String)));
    expect(actual.every(frame => !frame.hasAttribute('class') && !frame.hasAttribute('style') && frame.parentElement?.getAttribute('data-slot') === 'scroll-area')).toBe(true);
    expect(document.querySelector('[data-slot="specimen-frame"]')).toBeNull();
    expect(actual.every(frame => !frame.hasAttribute('inert'))).toBe(true);
  });

  it('leaves the frames out while deferred (server render and hydration) and keeps the viewport headings', () => {
    const document = render(<SpecimenContent specimen={{ kind: 'viewports', name: 'Example', title: 'Specimen', description: '', specimens: frames, empty: 'No preview', deferred: true }} />);
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.body.textContent).toContain('1280 px');
    expect(document.body.textContent).not.toContain('No preview');
  });

  it('keeps gallery previews inert and errors visible instead of inventing a preview', () => {
    const document = render(<SpecimenContent specimen={{ kind: 'viewports', name: 'Example', title: 'Specimen', description: '', specimens: [{ ...frames[0]!, dark: undefined, interactive: false }], empty: 'No preview' }} />);
    expect(document.querySelector('iframe')!.hasAttribute('inert')).toBe(true);
    const empty = render(<SpecimenContent specimen={{ kind: 'viewports', name: 'Example', title: 'Specimen', description: '', specimens: [], empty: 'No candidate' }} />);
    expect(empty.querySelector('iframe')).toBeNull();
    expect(empty.body.textContent).toContain('No candidate');
    const error = render(<SpecimenSection specimen={{ kind: 'record', name: 'Example', title: 'Candidate', description: 'Native detail', rowsCopy, status: { label: 'Unavailable', tone: 'destructive', description: 'Artifact bytes did not match' }, citation: { source: 'check:slot-pins', result: 'Failed' }, empty: 'No candidate' }} />);
    expect(error.querySelector('[data-citation="check:slot-pins"]')!.textContent).toBe('check:slot-pins · Failed');
    expect(error.body.textContent).toContain('Artifact bytes did not match');
    expect(error.querySelector('iframe')).toBeNull();
  });

  it('accepts only projected local sources whose width matches the frame', () => {
    expect(specimenSource('/__specimen?element=sample&width=375', 375)).toContain('width=375');
    expect(specimenSource('/preview/publication/frame/page.html', 1280)).toContain('/preview/');
    expect(specimenSource('/preview/example/frame/home.html?width=768', 768)).toContain('width=768');
    for (const source of ['https://example.org/__specimen', '//example.org/__specimen', 'javascript:alert(1)', '/preview/../../other', '/\\example.org/__specimen', '/other', '/__specimen\n']) {
      expect(() => specimenSource(source, 1280)).toThrow();
    }
    for (const source of ['/__specimen?width=1280', '/__specimen', '/__specimen?width=375&width=1280']) {
      expect(() => specimenSource(source, 375)).toThrow('viewport');
    }
  });

  it('rejects a viewport/source mismatch instead of accepting messages at an invented width', () => {
    expect(() => render(<SpecimenContent specimen={{ kind: 'viewports', name: 'Example', title: 'Specimen', description: '', specimens: [{ viewport: 375, light: '/__specimen?width=1280', heading: '375 px', title: 'Example at 375 px' }], empty: 'No preview' }} />)).toThrow('viewport');
  });
});
