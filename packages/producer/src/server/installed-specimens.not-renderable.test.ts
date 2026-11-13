/**
 * A section or frame candidate whose entry module is not a React component (the vendored
 * @tailwindcss/typography plugin source of sections.article v1/v2, sectioned-document v1/v2 and
 * legal-prose v1): the installed specimen page renders the explicit `not-renderable` specimen
 * state instead of mounting the module, so the page never throws React #31.
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import type { BoundPage } from '@clossys/publisher/install';
import { pageModule } from '../publish/install.js';
import { commonJsEntry, itemSpecimenPage, leafPageFiles, SPECIMEN_NOT_RENDERABLE_KEY } from './installed-specimens.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const designer = join(repo, 'clossys/agents/designer');

/** The plugin's shape: `plugin.withOptions(...)` is a function returning `{ handler, config }`. */
const PLUGIN_CJS = [
  'const withOptions = make => Object.assign(options => ({ handler: make(options), config: {} }), { __isOptionsFunction: true });',
  'module.exports = withOptions(() => () => {});',
  '',
].join('\n');
const PLAIN_OBJECT_ESM = 'export default { handler() {}, config: {} };\n';
const COMPONENT_ESM = 'export function Article(props: any) { return <article data-item="article">{props.children}</article>; }\n';
/** Stand-in for the pinned specimen document: the state it is given, on its root. */
const SPECIMEN_DOCUMENT = 'export function ComponentSpecimen(props: any) { return <main data-specimen-state={props.state}>{props.children}</main>; }\n';

type Entry = { readonly file: string; readonly export?: string };

/** One section page: `guarded` is the page Studio writes (itemSpecimenPage), else the bare page module it wraps. */
async function render(entry: Entry, source: string, guarded: boolean): Promise<string> {
  const substrate = mkdtempSync(join(tmpdir(), 'specimen-not-renderable-'));
  try {
    mkdirSync(join(substrate, dirname(entry.file)), { recursive: true });
    writeFileSync(join(substrate, entry.file), source);
    mkdirSync(join(substrate, 'components'), { recursive: true });
    writeFileSync(join(substrate, 'components/specimen-document.tsx'), SPECIMEN_DOCUMENT);
    mkdirSync(join(substrate, 'clossys/pages'), { recursive: true });
    const frame = { slot: 'sections.article', key: 'sections.article', role: 'frame', id: 'sections.article/article', version: 2, entry, props: { children: 'Body' }, copy: {}, text: {}, assets: {} } as const;
    const page = { schema: 'clossys.bound-page/1', id: 'specimen-sections-article--article-v2', frame, sections: [], parts: [] } as unknown as BoundPage;
    writeFileSync(join(substrate, 'clossys/pages/item--item.tsx'), pageModule(page, substrate, { host: false }));
    writeFileSync(join(substrate, 'clossys/pages/item.tsx'), guarded
      ? itemSpecimenPage('./item--item', entry, '../../' + entry.file.replace(/\.[cm]?[jt]sx?$/, ''), { commonJs: commonJsEntry(source), text: 'Not renderable' })
      : 'export { default } from "./item--item";\n');
    const alias = { name: 'substrate-alias', setup(on: any) {
      on.onResolve({ filter: /^@\// }, (args: { path: string }) => ({ path: ['.tsx', '.ts', '.js'].map(ext => join(substrate, args.path.slice(2)) + ext).find(path => existsSync(path)) }));
    } };
    const out = await build({ entryPoints: [join(substrate, 'clossys/pages/item.tsx')], bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', packages: 'external', plugins: [alias], logLevel: 'silent' });
    const module = { exports: {} as Record<string, any> };
    const requireHere = createRequire(import.meta.url);
    new Function('require', 'module', 'exports', out.outputFiles[0]!.text)((id: string) => id === 'react' ? React : requireHere(id), module, module.exports);
    return renderToStaticMarkup(React.createElement(module.exports.default));
  } finally { rmSync(substrate, { recursive: true, force: true }); }
}

const NOT_RENDERABLE = '<main data-specimen-state="not-renderable">Not renderable</main>';

describe('a candidate whose entry module is not a component', () => {
  it('mounted bare, the plugin entry throws React #31 (the capture failure this guards)', async () => {
    await expect(render({ file: 'lib/typography/index.js' }, PLUGIN_CJS, false)).rejects.toThrow(/Objects are not valid as a React child|#31/);
  });

  it('renders the not-renderable state for a CommonJS plugin entry, never mounting it', async () => {
    expect(await render({ file: 'lib/typography/index.js' }, PLUGIN_CJS, true)).toBe(NOT_RENDERABLE);
  });

  it('renders the not-renderable state for an entry whose export is a plain object', async () => {
    expect(await render({ file: 'lib/plugin.ts' }, PLAIN_OBJECT_ESM, true)).toBe(NOT_RENDERABLE);
  });

  it('still mounts a component entry, unwrapped', async () => {
    expect(await render({ file: 'components/article.tsx', export: 'Article' }, COMPONENT_ESM, true)).toBe('<article data-item="article">Body</article>');
    expect(await render({ file: 'components/article.tsx' }, COMPONENT_ESM, true)).toBe('<article data-item="article">Body</article>');
  });

  it('reads its text from a Writer key, never a literal', () => {
    expect(SPECIMEN_NOT_RENDERABLE_KEY).toBe('studio.specimen.not-renderable');
    const page = itemSpecimenPage('./x--item', { file: 'lib/a.js' }, '../../lib/a', { commonJs: true, text: '[missing copy studio.specimen.not-renderable]' });
    expect(page).toContain(JSON.stringify('[missing copy studio.specimen.not-renderable]'));
    // A CommonJS entry is never imported: its module is not bundled into the layer.
    expect(page).not.toContain('../../lib/a');
    expect(page).not.toContain('./x--item');
  });
});

describe('the leaf page files of every layer', () => {
  const base = { page: 'p', entry: { file: 'lib/typography/index.js' }, item: undefined, bound: () => 'BOUND', specifier: '../../lib/typography/index', text: 'T' } as const;

  it('a CommonJS entry is one not-renderable page in a component slot too, with no bound page module', () => {
    for (const slot of ['components.semantic-content', 'sections.article', 'frames.app']) {
      const files = leafPageFiles({ ...base, slot, commonJs: true });
      expect(Object.keys(files), slot).toEqual(['p.tsx']);
      expect(files['p.tsx'], slot).toContain('state="not-renderable"');
    }
  });

  it('a component entry keeps its bound page module and its page: the specimen state for a component, the export guard otherwise', () => {
    const component = leafPageFiles({ ...base, slot: 'components.button', entry: { file: 'components/ui/button.tsx', export: 'Button' }, commonJs: false });
    expect(Object.keys(component).sort()).toEqual(['p--item.tsx', 'p.tsx']);
    expect(component['p--item.tsx']).toBe('BOUND');
    expect(component['p.tsx']).toContain('<ComponentSpecimen state={"rest"}><Item /></ComponentSpecimen>');
    const section = leafPageFiles({ ...base, slot: 'sections.article', entry: { file: 'components/article.tsx', export: 'Article' }, commonJs: false });
    expect(section['p.tsx']).toContain('renderable ? <Item />');
  });
});

describe('the recorded candidates', () => {
  /** Every sections candidate's entry file content: its first code file (the one the installer mounts when none is declared). */
  const sections = readdirSync(designer).filter(slot => (slot.startsWith('sections.') || slot.startsWith('components.')) && existsSync(join(designer, slot, 'candidates'))).sort();
  const entryOf = (slot: string, candidate: string) => {
    const item = JSON.parse(readFileSync(join(designer, slot, 'candidates', candidate), 'utf8')) as { files: { path: string; content?: string }[] };
    return item.files.find(file => /\.(?:[cm]?[jt]sx?)$/.test(file.path))?.content ?? '';
  };

  it('the vendored typography plugin candidates (sections and components) are CommonJS entries', () => {
    for (const [slot, candidate] of [['sections.article', 'article-v1.json'], ['sections.article', 'article-v2.json'], ['sections.sectioned-document', 'sectioned-document-v1.json'], ['sections.sectioned-document', 'sectioned-document-v2.json'], ['sections.legal-prose', 'legal-prose-v1.json'], ['components.semantic-content', 'semantic-content-v2.json']] as const) {
      expect.soft(commonJsEntry(entryOf(slot, candidate)), `${slot}/${candidate}`).toBe(true);
    }
  });

  it('no pinned sections or components candidate is a CommonJS entry', () => {
    for (const slot of sections) {
      if (!existsSync(join(designer, slot, 'pin.json'))) continue;
      const pinned = JSON.parse(readFileSync(join(designer, slot, 'pin.json'), 'utf8')).candidate as string;
      expect.soft(commonJsEntry(entryOf(slot, pinned)), `${slot}/${pinned}`).toBe(false);
    }
  });
});
