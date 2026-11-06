import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import OptionsSection, { type OptionsInput } from './index';
import { optionCopy, optionsCopy } from '../../lib/options-copy';

it('binds an option to its actual viewport and preserves its version and pin explanation', () => {
  const document = new JSDOM(renderToStaticMarkup(<OptionsSection options={{ name: 'Example', description: 'Recorded candidates', copy: optionsCopy(), rows: [{ version: 3, pinned: true, copy: optionCopy('Example', { version: 3, pinned: true }), label: 'Pinned v3', reason: 'Native pin', preview: { kind: 'frame', src: '/__specimen?element=example&width=768&v=3', viewport: 768 } }] }} />)).window.document;
  const frame = document.querySelector('iframe')!;
  expect(frame.src).toContain('width=768&v=3');
  expect(frame.title).toBe('Example v3, pinned');
  // The page at its own 768 px CSS width and a tablet-screen height, in a stock scroll area.
  expect([frame.width, frame.height]).toEqual(['768', '1024']);
  expect(frame.parentElement!.getAttribute('data-slot')).toBe('scroll-area');
  expect(document.querySelector('[data-slot="specimen-frame"]')).toBeNull();
  expect(document.body.textContent).toContain('Native pin');
});

it('keeps stock comparison columns and complete Writer records without an intrinsic cell width floor', () => {
  const values = ['Publications', 'Overview', '  significant spaces\nsecond line  ', 'UnbrokenRecordValue'.repeat(24)];
  const options: OptionsInput = {
    name: 'strings.common', description: 'Recorded candidates', copy: optionsCopy(),
    rows: [2, 3].map((version): OptionsInput['rows'][number] => ({
      version, pinned: version === 2, copy: optionCopy('strings.common', { version, pinned: version === 2 }),
      label: `Version ${version}`, reason: 'Recorded candidate',
      preview: { kind: 'strings', rows: values.map((text, index) => ({ key: index === 3 ? 'UnbrokenRecordKey'.repeat(24) : `record-${index}`, text, change: 'same' })) },
    })),
  };
  const before = JSON.stringify(options);
  const document = new JSDOM(renderToStaticMarkup(<OptionsSection options={options} />)).window.document;
  // Stock field group: one responsive field row holding a field per version, side by side where wide enough.
  const row = document.querySelector('[data-slot="field-group"] > [data-slot="field"][data-orientation="responsive"]')!;
  const figures = [...row.querySelectorAll(':scope > [data-option-version]')];
  expect(figures.map(figure => figure.getAttribute('data-option-version'))).toEqual(['2', '3']);
  for (const figure of figures) {
    expect(figure.getAttribute('data-slot')).toBe('field');
    const cells = [...figure.querySelectorAll<HTMLElement>('[data-slot="table-cell"]')];
    expect(cells.map(cell => cell.textContent)).toEqual(values.flatMap((text, index) => [index === 3 ? 'UnbrokenRecordKey'.repeat(24) : `record-${index}`, text]));
    expect(cells.every(cell => cell.style.overflowWrap === 'anywhere' && cell.classList.contains('whitespace-pre-wrap'))).toBe(true);
    expect(cells.every(cell => !['min-w-48', 'whitespace-nowrap', 'truncate', 'overflow-hidden', 'text-ellipsis'].some(token => cell.classList.contains(token)))).toBe(true);
  }
  expect(document.querySelector('[data-slot="card-content"]')!.classList.contains('min-w-0')).toBe(true);
  expect(JSON.stringify(options)).toBe(before);
});
