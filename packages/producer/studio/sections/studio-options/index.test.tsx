import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import OptionsSection from './index';

it('binds an option to its actual viewport and preserves its version and pin explanation', () => {
  const document = new JSDOM(renderToStaticMarkup(<OptionsSection options={{ name: 'Example', description: 'Recorded candidates', rows: [{ version: 3, pinned: true, label: 'Pinned v3', reason: 'Native pin', preview: { kind: 'frame', src: '/__specimen?element=example&width=768&v=3', viewport: 768 } }] }} />)).window.document;
  const frame = document.querySelector('iframe')!;
  expect(frame.src).toContain('width=768&v=3');
  expect(frame.title).toBe('Example v3, pinned');
  expect(frame.height).toBe('930');
  expect(document.querySelector('[data-slot="specimen-frame"]')).toBeNull();
  expect(document.body.textContent).toContain('Native pin');
});
