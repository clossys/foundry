import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import type { BoundPage } from '@clossys/publisher/install';
import { pageModule } from '../publish/install.js';
import { resolveSampleCopy } from './specimen-state.js';
import { fixtureChildren, moduleExports, pinnedWriterCopy, specimenTreeIssues } from './specimen-tree.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const designer = join(repo, 'clossys/agents/designer');

/** A stand-in compound component module: each part renders a tagged element around its children. */
const TABS_MODULE = [
  'import { createElement } from "react";',
  'const part = (name: string) => (props: any) => createElement("div", { "data-part": name, id: props.id, "aria-label": props["aria-label"] }, props.children);',
  'export const Tabs = part("tabs");',
  'export const TabsList = part("list");',
  'export const TabsTrigger = part("trigger");',
  'function TabsContent(props: any) { return createElement("section", { "data-part": "panel", id: props.id }, props.children); }',
  'export { TabsContent };',
  '',
].join('\n');

/** The page module the specimen renderer writes for one component, rendered to static markup. */
async function renderSpecimen(children: unknown, copy: Record<string, string>): Promise<string> {
  const substrate = mkdtempSync(join(tmpdir(), 'specimen-tree-'));
  try {
    mkdirSync(join(substrate, 'components/ui'), { recursive: true });
    mkdirSync(join(substrate, 'clossys/pages'), { recursive: true });
    writeFileSync(join(substrate, 'components/ui/tabs.tsx'), TABS_MODULE);
    const issues = specimenTreeIssues(children, moduleExports(TABS_MODULE), copy);
    if (issues.length) throw new Error(issues.join('; '));
    const frame = { slot: 'components.tabs', key: 'components.tabs', role: 'frame', id: 'components.tabs/tabs', version: 2,
      entry: { file: 'components/ui/tabs.tsx', export: 'Tabs' }, props: { children: resolveSampleCopy(children, copy) }, copy: {}, text: {}, assets: {} } as const;
    const page = { schema: 'clossys.bound-page/1', id: 'specimen-components-tabs-v2', frame, sections: [], parts: [] } as unknown as BoundPage;
    const entry = join(substrate, 'clossys/pages/specimen.tsx');
    writeFileSync(entry, pageModule(page, substrate, { host: false }));
    const out = await build({ entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'], logLevel: 'silent' });
    const module = { exports: {} as Record<string, any> };
    new Function('require', 'module', 'exports', out.outputFiles[0]!.text)((id: string) => { if (id === 'react') return React; throw new Error(id); }, module, module.exports);
    return renderToStaticMarkup(React.createElement(module.exports.default));
  } finally { rmSync(substrate, { recursive: true, force: true }); }
}

describe('specimen element trees', () => {
  it('renders a nested preview fixture through the page module, with Writer copy and plain text', async () => {
    const tree = [
      { $component: 'TabsList', props: { 'aria-label': { $copy: 'sample.label' } }, children: [
        { $component: 'TabsTrigger', props: { id: 'one' }, children: { $copy: 'sample.one' } },
        { $component: 'TabsTrigger', props: { id: 'two' }, children: 'Two' },
      ] },
      { $component: 'TabsContent', props: { id: 'one' }, children: ['Panel ', { $copy: 'sample.panel' }] },
    ];
    const html = await renderSpecimen(tree, { 'sample.label': 'Sample tabs', 'sample.one': 'One', 'sample.panel': 'text' });
    expect(html).toBe('<div data-part="tabs"><div data-part="list" aria-label="Sample tabs"><div data-part="trigger" id="one">One</div><div data-part="trigger" id="two">Two</div></div><section data-part="panel" id="one">Panel text</section></div>');
  });

  it('rejects a fixture naming a component its candidate does not export, before any page is written', async () => {
    const tree = [{ $component: 'TabsList', children: [{ $component: 'TabsPanel', children: 'x' }] }];
    expect(specimenTreeIssues(tree, moduleExports(TABS_MODULE), {})).toEqual(['children[0].children[0]: the candidate exports no component TabsPanel']);
    await expect(renderSpecimen(tree, {})).rejects.toThrow('the candidate exports no component TabsPanel');
    // Other slots, assets, unknown copy keys and non-renderable children are rejected too.
    expect(specimenTreeIssues([{ $element: 'components.button' }, { $copy: 'nope' }, { text: 'x' }], moduleExports(TABS_MODULE), {})).toEqual([
      'children[0]: a child is text, { "$copy" } or { "$component" }',
      'children[1]: Writer has no copy key nope',
      'children[2]: a child is text, { "$copy" } or { "$component" }',
    ]);
  });

  it('reads value exports from declarations, export lists and aliases, never types', () => {
    expect([...moduleExports('export function A() {}\nexport const b = 1\nexport { C, D as E, type F }\nexport type { G }\n// export const H = 1\n')].sort()).toEqual(['A', 'C', 'E', 'b']);
  });

  it('every pinned component fixture tree resolves against its own exports and the pinned Writer copy', async () => {
    const copy = pinnedWriterCopy(join(repo, 'clossys'));
    expect(copy['studio.specimen.tabs-overview']).toBe('Overview');
    for (const slot of ['components.tabs', 'components.card']) {
      const pin = JSON.parse(readFileSync(join(designer, slot, 'pin.json'), 'utf8'));
      const item = JSON.parse(readFileSync(join(designer, slot, 'candidates', pin.candidate), 'utf8'));
      const file = item.files.find((row: { path: string }) => row.path === item.meta.preview.fixtures.file);
      const tree = fixtureChildren(item.meta.preview.fixtures);
      expect.soft(tree, slot).toBeDefined();
      expect.soft(specimenTreeIssues(tree, moduleExports(file.content), copy), slot).toEqual([]);
    }
  });
});
