import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createSpecimenBuilder, specimenEntry, specimenExport } from './build.js';
import { specimenRecordFrom, adaptPreview } from './source.js';
import { renderSpecimenPage } from './render.js';
import { slotDetail } from '../../../producer/src/server/slot-detail.js';
import { slotDetailInputs } from '../../../producer/studio/lib/slot-detail.js';
import type { SpecimenFile } from './types.js';

const { JSDOM } = createRequire(import.meta.url)('jsdom');
const workspace = fileURLToPath(new URL('../../../../', import.meta.url));
const detail = slotDetail(workspace, 'designer', 'sections.studio.checks')!;
const props = { checks: slotDetailInputs(detail, { gallery: agent => `/${agent}`, leaf: (agent, id) => `/${agent}/${id}`, label: () => undefined, back: { href: '/designer', label: 'Designer' } }, 'light').checks };
const files: SpecimenFile[] = [
  // This helper precedes the entry and is executed by it. Props are the native detail projection.
  { path: 'helpers.tsx', content: 'export const finding = ({ rows }) => rows.find(row => !row.ok)?.label ?? rows[0].label;' },
  { path: 'index.tsx', content: 'import { Button } from "@clossys/designer-ui"; import { finding } from "./helpers"; export default function Checks({ checks }) { return <Button>{finding(checks)}</Button>; }' },
  // A package-local @/components/ui/dialog must never capture this virtual record file.
  { path: 'components/ui/dialog.tsx', content: 'export const RecordOnlyDialog = () => <span>virtual-record-dialog</span>;' },
];
const record = (payload = files, preview: unknown = { fixtures: { file: 'index.tsx', export: 'default', props } }) => specimenRecordFrom({
  id: 'sections.test/runtime', version: 1, kind: 'registry:block',
  files: [{ path: 'runtime.json', content: JSON.stringify({ files: payload }) }], preview, contentHash: 'fixture',
});

describe('specimen runtime source boundaries', () => {
  it('bundles a multi-file record while package-local aliases retain the real package resolution', async () => {
    expect(props.checks.rows).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Pin matches candidate bytes' })]));
    expect(props.checks.copy).toBeDefined();
    const input = record();
    expect(specimenEntry(input)?.path).toBe('index.tsx');
    expect(input.preview).toEqual({ entry: 'index.tsx', export: 'default', fixtures: props });
    const built = await createSpecimenBuilder({ workspace }).build(input);
    expect(built.errors).toEqual([]);
    expect(built.js).toContain('createElement');
    expect(built.js).not.toContain('virtual-record-dialog');
    const html = renderSpecimenPage({ query: { element: input.id }, record: input, build: built, mode: 'light', assetBase: '/assets/', nonce: 'test' });
    const config = JSON.parse(/id="specimen-props">([^<]+)/.exec(html)![1]!);
    expect(config).toEqual({ props, export: 'default' });
    expect(built.js).toContain('payload has no component export ');
  }, 30_000);

  it('retains explicit entry/export and rejects a descriptor that names no actual source file', () => {
    expect(adaptPreview({ fixtures: { file: 'helpers.tsx', export: 'finding', props }, entry: 'index.tsx', export: 'default' }))
      .toEqual({ entry: 'index.tsx', export: 'default', fixtures: props });
    expect(adaptPreview({ fixtures: { checks: props.checks } })).toEqual({ fixtures: props });
    for (const file of ['missing.tsx', '../index.tsx', '/index.tsx', 'runtime.json']) {
      expect(() => record(files, { fixtures: { file, export: 'default', props } })).toThrow(/not a code file in the payload/);
    }
    expect(() => record(files, { fixtures: { file: 'index.tsx', export: '', props } })).toThrow(/fixtures need/);
  });

  it('parses the actual canonical fixture descriptor without inventing missing required inputs', () => {
    const native = JSON.parse(detail.candidates.find(candidate => candidate.pinned)!.content);
    const input = specimenRecordFrom({ id: 'sections.studio.checks/studio-checks', version: 1, kind: native.type,
      files: [{ path: 'studio-checks.json', content: JSON.stringify(native) }], preview: native.meta.preview, contentHash: detail.pin!.sha256 });
    expect(input.preview).toMatchObject({ entry: 'index.tsx', export: 'default', fixtures: {} });
    expect(input.contentHash).toBe(detail.pin!.sha256);
    expect(input.payload.files.find(file => file.path === 'index.tsx')!.content).toContain('const { rows, copy } = checks;');
    expect(input.preview.fixtures).not.toHaveProperty('checks');
    // Source membership and normalization also hold for the helper-first canonical shell.
    const shell = slotDetail(workspace, 'designer', 'frames.studio-shell')!;
    const item = JSON.parse(shell.candidates.find(candidate => candidate.pinned)!.content);
    const shellRecord = specimenRecordFrom({ id: 'frames.studio-shell/studio-shell', version: 6, kind: item.type,
      files: [{ path: 'studio-shell.json', content: JSON.stringify(item) }], preview: item.meta.preview, contentHash: shell.pin!.sha256 });
    expect(shellRecord.payload.files.find(file => file.path.endsWith('.tsx'))!.path).toBe('PageNotice.tsx');
    expect(specimenEntry(shellRecord)?.path).toBe('index.tsx');
    expect(shellRecord.preview.fixtures).toEqual({});
  });

  it('does not resolve a virtual alias by basename, escape to the filesystem, or mount a bundle on build failure', async () => {
    const input = record([
      { path: 'index.tsx', content: 'import { Missing } from "@/unrelated/button"; export default Missing;' },
      { path: 'one/button.tsx', content: 'export const Missing = () => null;' },
      { path: 'two/button.tsx', content: 'export const Missing = () => null;' },
    ]);
    const built = await createSpecimenBuilder({ workspace }).build(input);
    expect(built.js).toBeUndefined();
    expect(built.errors).toContain('unresolved element import @/unrelated/button');
    const html = renderSpecimenPage({ query: { element: input.id }, record: input, build: built, mode: 'light', assetBase: '/assets/', nonce: 'test' });
    expect(html).toContain('"preErrors":[{"source":"build","message":"unresolved element import @/unrelated/button"}]');
    expect(html).not.toContain('type="module"');
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    try {
      dom.window.eval(dom.window.document.querySelector('head script')!.textContent!);
      const health = (dom.window as any).__clossysSpecimen.health();
      expect(health.errors).toMatchObject({ count: 1, items: [{ source: 'build', message: 'unresolved element import @/unrelated/button' }] });
      expect(health.weight.jsBytes).toBe(0);
    } finally { dom.window.close(); }
    const external = record([{ path: 'index.tsx', content: 'import X from "../../host-only"; export default X;' }]);
    expect((await createSpecimenBuilder({ workspace }).build(external)).errors).toContain('unresolved relative import ../../host-only from index.tsx');
  }, 30_000);

  it('keeps a missing executable bundle red even if the bundler returns no diagnostics', async () => {
    const input = record();
    const built = await createSpecimenBuilder({ workspace, esbuild: { build: async () => ({ outputFiles: [], errors: [] }) } }).build(input);
    expect(built.js).toBeUndefined();
    expect(built.errors).toEqual(['visual specimen has no executable bundle']);
    const html = renderSpecimenPage({ query: { element: input.id }, record: input, build: built, mode: 'light', assetBase: '/assets/', nonce: 'test' });
    expect(html).toContain('"preErrors":[{"source":"build","message":"visual specimen has no executable bundle"}]');
    expect(html).not.toContain('type="module"');
  });

  it('mounts a fixture element tree of the payload exports and reports a non-exported part as a render error', async () => {
    const parts = { path: 'index.tsx', content: 'const part = tag => ({ children, ...props }) => <div data-part={tag} {...props}>{children}</div>; export const Tabs = part("tabs"); export const TabsList = part("list"); export const TabsTrigger = part("trigger");' };
    const mount = async (children: unknown) => {
      const input = record([parts], { fixtures: { file: 'index.tsx', export: 'Tabs', props: { children } } });
      const built = await createSpecimenBuilder({ workspace }).build(input);
      expect(built.errors).toEqual([]);
      const html = renderSpecimenPage({ query: { element: input.id }, record: input, build: built, mode: 'light', assetBase: '/assets/', nonce: 'test' });
      const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
      dom.window.eval(dom.window.document.querySelector('head script')!.textContent!);
      dom.window.eval(built.js!.replace(/^export\s*\{[^}]*\};?\s*$/m, ''));
      await new Promise(resolve => setTimeout(resolve, 50));
      return dom;
    };
    const ok = await mount([{ $component: 'TabsList', props: { 'aria-label': 'Sample' }, children: [{ $component: 'TabsTrigger', children: 'One' }, 'Two'] }]);
    try {
      expect(ok.window.document.getElementById('specimen-root')!.innerHTML).toBe('<div data-part="tabs"><div data-part="list" aria-label="Sample"><div data-part="trigger">One</div>Two</div></div>');
      expect((ok.window as any).__clossysSpecimen.health().errors.items.filter((item: { source: string }) => item.source === 'render')).toEqual([]);
    } finally { ok.window.close(); }
    const bad = await mount([{ $component: 'TabsPanel', children: 'x' }]);
    try {
      expect(bad.window.document.querySelector('[data-specimen-error]')!.textContent).toContain('payload has no component export TabsPanel');
      expect((bad.window as any).__clossysSpecimen.health().errors.count).toBeGreaterThanOrEqual(1);
    } finally { bad.window.close(); }
  }, 30_000);

  it('mounts a component that has only named exports by the same rule for every component', async () => {
    const item = (id: string, files: SpecimenFile[], preview: unknown = null) => specimenRecordFrom({
      id, version: 1, kind: 'registry:ui', files: [{ path: 'item.json', content: JSON.stringify({ name: id.split('/')[1], type: 'registry:ui', files }) }], preview, contentHash: 'fixture',
    });
    const area = item('components.scroll-area/scroll-area', [{ path: 'scroll-area.tsx', type: 'registry:ui', content: [
      '// export default nothing here',
      'function ScrollBar() { return <span data-part="bar" />; }',
      'function ScrollArea({ children }) { return <div data-part="area">{children ?? "area"}<ScrollBar /></div>; }',
      'export { ScrollArea, ScrollBar }',
    ].join('\n') }]);
    expect(specimenExport(area)).toBe('ScrollArea');
    // The element name, then the entry file name, then the first component export in source order.
    expect(specimenExport(item('components.disclosure/disclosure', [{ path: 'collapsible.tsx', content: 'export function CollapsibleTrigger() {}\nexport function Collapsible() {}' }]))).toBe('Collapsible');
    expect(specimenExport(item('components.breadcrumbs/breadcrumbs', [{ path: 'crumbs.tsx', content: 'export const crumbVariants = 1; export function BreadcrumbItem() {} export function BreadcrumbList() {}' }]))).toBe('BreadcrumbItem');
    expect(specimenExport(item('components.x/x', [{ path: 'x.tsx', content: 'const X = () => null; export { X as default, X as Y }' }]))).toBe('default');
    expect(specimenExport(item('components.x/x', [{ path: 'x.tsx', content: 'export const X = () => null;' }], { fixtures: { file: 'x.tsx', export: 'Y', props: {} } }))).toBe('Y');
    expect(specimenExport(item('components.x/x', [{ path: 'x.tsx', content: 'export type X = 1; export const value = 2;' }]))).toBeUndefined();
    const built = await createSpecimenBuilder({ workspace }).build(area);
    expect(built.errors).toEqual([]);
    expect(built.export).toBe('ScrollArea');
    const html = renderSpecimenPage({ query: { element: area.id }, record: area, build: built, mode: 'light', assetBase: '/assets/', nonce: 'test' });
    expect(JSON.parse(/id="specimen-props">([^<]+)/.exec(html)![1]!).export).toBe('ScrollArea');
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    try {
      dom.window.eval(dom.window.document.querySelector('head script')!.textContent!);
      dom.window.eval(built.js!.replace(/^export\s*\{[^}]*\};?\s*$/m, ''));
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(dom.window.document.getElementById('specimen-root')!.innerHTML).toBe('<div data-part="area">area<span data-part="bar"></span></div>');
      expect((dom.window as any).__clossysSpecimen.health().errors.items.filter((row: { source: string }) => row.source === 'render')).toEqual([]);
    } finally { dom.window.close(); }
    // A forwardRef object re-exported under an alias (React Aria's ComboBox as Combobox) mounts by the same rule.
    const combo = item('components.combo-box/combo-box', [{ path: 'combobox.tsx', type: 'registry:ui', content: [
      'import * as React from "react";',
      'const ComboBoxPrimitive = React.forwardRef(function ComboBox(props, ref) { return <div ref={ref} data-part="combo" />; });',
      'export { ComboBoxPrimitive as Combobox }',
    ].join('\n') }]);
    expect(specimenExport(combo)).toBe('Combobox');
    const comboBuilt = await createSpecimenBuilder({ workspace }).build(combo);
    expect(comboBuilt.errors).toEqual([]);
    const comboDom = new JSDOM(renderSpecimenPage({ query: { element: combo.id }, record: combo, build: comboBuilt, mode: 'light', assetBase: '/assets/', nonce: 'test' }), { runScripts: 'outside-only', pretendToBeVisual: true });
    try {
      comboDom.window.eval(comboDom.window.document.querySelector('head script')!.textContent!);
      comboDom.window.eval(comboBuilt.js!.replace(/^export\s*\{[^}]*\};?\s*$/m, ''));
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(comboDom.window.document.getElementById('specimen-root')!.innerHTML).toBe('<div data-part="combo"></div>');
      expect((comboDom.window as any).__clossysSpecimen.health().errors.items.filter((row: { source: string }) => row.source === 'build' || row.source === 'render')).toEqual([]);
    } finally { comboDom.window.close(); }
  }, 30_000);

  it('resolves `@/` through the source to the item that installs it, at its install path', async () => {
    const asked: [string, readonly string[]][] = [];
    const button = specimenRecordFrom({ id: 'components.button/button', version: 1, kind: 'registry:ui', files: [{ path: 'button.json', content: JSON.stringify({ files: [
      { path: 'button.tsx', type: 'registry:ui', content: 'import { cn } from "@/lib/utils"; export function Button({ children }) { return <button className={cn("b")}>{children}</button>; }' },
    ] }) }], preview: null, contentHash: 'b' });
    const source = { read: async () => undefined, theme: async () => undefined, alias: async (path: string, context: { registryDependencies: readonly string[] }) => { asked.push([path, context.registryDependencies]); return path === 'components/ui/button' ? button : undefined; } };
    const input = specimenRecordFrom({ id: 'components.sidebar/sidebar', version: 1, kind: 'registry:ui', files: [{ path: 'sidebar.json', content: JSON.stringify({ registryDependencies: ['button', 'use-mobile'], files: [
      { path: 'sidebar.tsx', type: 'registry:ui', content: 'import { Button } from "@/components/ui/button"; import { useIsMobile } from "@/hooks/use-mobile"; import { Self } from "@/components/ui/sidebar-part"; export function Sidebar() { return <Button><Self /></Button>; }' },
      { path: 'sidebar-part.tsx', type: 'registry:ui', content: 'export const Self = () => <i>part</i>;' },
    ] }) }], preview: null, contentHash: 's' });
    const built = await createSpecimenBuilder({ workspace }).build(input, source as never);
    // Own files answer their own install path; only foreign paths reach the source, with the declared dependencies.
    expect(asked).toEqual([['hooks/use-mobile', ['button', 'use-mobile']], ['components/ui/button', ['button', 'use-mobile']]].sort((a, b) => asked.findIndex(row => row[0] === a[0]) - asked.findIndex(row => row[0] === b[0])));
    expect(built.errors).toContain('import @/hooks/use-mobile: no pinned item installs it');
    expect(built.errors.some(error => error.includes('components/ui/button'))).toBe(false);
  }, 30_000);
});
