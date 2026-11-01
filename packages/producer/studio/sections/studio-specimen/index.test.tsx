import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SpecimenSection, { SpecimenContent, type ViewportSpecimen } from './index';

const frames: ViewportSpecimen[] = [375, 768, 1280].map(viewport => ({
  viewport: viewport as ViewportSpecimen['viewport'],
  light: `/__specimen?element=example&width=${viewport}&theme=light`,
  dark: `/__specimen?element=example&width=${viewport}&theme=dark`,
}));
const render = (element: React.ReactNode) => new JSDOM(renderToStaticMarkup(element)).window.document;

describe('detail and gallery specimen binding', () => {
  it('preserves every projected viewport/theme without a ratio frame', () => {
    const document = render(<SpecimenContent specimen={{ kind: 'viewports', name: 'Example', title: 'Specimen', description: '', specimens: frames, empty: 'No preview' }} />);
    const actual = [...document.querySelectorAll('iframe')];
    expect(actual).toHaveLength(6);
    expect(actual.map(frame => frame.getAttribute('src'))).toEqual([...frames].reverse().flatMap(row => [row.light, row.dark]));
    expect(actual.every(frame => frame.className === 'relative z-20 no-scrollbar w-full bg-background' && frame.height === '930')).toBe(true);
    expect(document.querySelector('[data-slot="specimen-frame"]')).toBeNull();
    expect(actual.every(frame => !frame.hasAttribute('inert'))).toBe(true);
  });

  it('keeps gallery previews inert and errors visible instead of inventing a preview', () => {
    const document = render(<SpecimenContent specimen={{ kind: 'viewports', name: 'Example', title: 'Specimen', description: '', specimens: [{ ...frames[0]!, dark: undefined, interactive: false }], empty: 'No preview' }} />);
    expect(document.querySelector('iframe')!.hasAttribute('inert')).toBe(true);
    const empty = render(<SpecimenContent specimen={{ kind: 'viewports', name: 'Example', title: 'Specimen', description: '', specimens: [], empty: 'No candidate' }} />);
    expect(empty.querySelector('iframe')).toBeNull();
    expect(empty.body.textContent).toContain('No candidate');
    const error = render(<SpecimenSection specimen={{ kind: 'record', name: 'Example', title: 'Candidate', description: 'Native detail', status: { label: 'Unavailable', tone: 'destructive', description: 'Artifact bytes did not match' }, empty: 'No candidate' }} />);
    expect(error.body.textContent).toContain('Artifact bytes did not match');
    expect(error.querySelector('iframe')).toBeNull();
  });

  it('rejects a viewport/source mismatch instead of accepting messages at an invented width', () => {
    expect(() => render(<SpecimenContent specimen={{ kind: 'viewports', name: 'Example', title: 'Specimen', description: '', specimens: [{ viewport: 375, light: '/__specimen?width=1280' }], empty: 'No preview' }} />)).toThrow('viewport');
  });
});
