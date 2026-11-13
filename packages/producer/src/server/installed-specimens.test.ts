import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { resolvePage, type BoundPage } from '@clossys/publisher/install';
import { pageModule } from '../publish/install.js';
import { firstComponentSource } from '../publish/component-export.js';
import { installedCode, resolveSampleCopy, SLOT_SPECIMEN_STATES, specimenStateOf, type SpecimenState } from './specimen-state.js';
import { createRequire } from 'node:module';
import { fixtureChildren, moduleExports, pinnedWriterCopy, specimenTreeIssues } from './specimen-tree.js';
import { createServer, request } from 'node:http';
import { slotInstallInputs } from '../specimen/slot-install-inputs.js';
import { SPECIMEN_STATE_FILE } from '../specimen/library-source.js';
import { componentSpecimenPage, hostOnlyFinding, installedRecordSource, installedSpecimenRoutes, specimenSiteCsp, type SiteInputs } from './installed-specimens.js';
import { SPECIMEN_FRAME_CSP, SPECIMEN_FRAME_SCRIPT_HASH } from './specimen-frame.js';
import { PREVIEW_PAGE_CSP, specimenHostCsp } from './publication.js';

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

/**
 * One item rendered to static markup through the generated specimen pages: its bound page module
 * (pageModule) inside the component leaf page Studio writes for it (componentSpecimenPage, so in
 * the state that candidate mounts in), or the page module alone with `bare`. `entry.export` unset
 * takes the first component export. `files` are the substrate: `@/<path>` resolves to a file there
 * (`.tsx`, `.ts`); an `@/` module the substrate lacks is a stand-in whose parts render their
 * children and whose hooks return `false` (listed in `standIns`), so only the item's own context
 * dependency is under test. `providerTag` is the start of the tag the slot's provider renders alone (its name and first
 * attribute, `<div data-slot="sidebar-wrapper"`), whatever class a fixture gives it.
 */
async function renderMounted(slot: string, entry: { readonly file: string; readonly export?: string }, files: Readonly<Record<string, string>>, options: { readonly props?: Record<string, unknown>; readonly bare?: boolean; readonly item?: unknown } = {}): Promise<{ markup: string; standIns: string[]; providerTag: string }> {
  const substrate = mkdtempSync(join(tmpdir(), 'specimen-mount-'));
  try {
    for (const [path, content] of Object.entries(files)) { mkdirSync(join(substrate, dirname(path)), { recursive: true }); writeFileSync(join(substrate, path), content); }
    mkdirSync(join(substrate, 'clossys/pages'), { recursive: true });
    const frame = { slot, key: slot, role: 'frame', id: `${slot}/item`, version: 1, entry, props: options.props ?? {}, copy: {}, text: {}, assets: {} } as const;
    const page = { schema: 'clossys.bound-page/1', id: 'specimen-mount', frame, sections: [], parts: [] } as unknown as BoundPage;
    writeFileSync(join(substrate, 'clossys/pages/item--item.tsx'), pageModule(page, substrate, { host: false }));
    writeFileSync(join(substrate, 'clossys/pages/item.tsx'), options.bare ? 'export { default } from "./item--item";\n' : componentSpecimenPage('./item--item', slot, options.item, entry));
    const state = specimenStateOf(slot), provider = state?.state === 'provider' ? state.provider : undefined;
    writeFileSync(join(substrate, 'clossys/pages/specimen.tsx'), [
      'export { default } from "./item";',
      ...(provider ? [`export { ${provider.export} as SlotProvider } from ${JSON.stringify(provider.module)};`] : []),
      '',
    ].join('\n'));
    const standIns: string[] = [];
    const standIn = (importer: string, path: string): string => {
      standIns.push(path);
      const names = [...readFileSync(importer, 'utf8').matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)].filter(match => match[2] === path)
        .flatMap(match => match[1]!.split(',').map(name => name.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!).filter(Boolean));
      return ['import { createElement } from "react";', ...[...new Set(names)].map(name => /^use[A-Z]/.test(name)
        ? `export const ${name} = () => false;`
        : `export const ${name} = (props: any) => createElement("div", { "data-stand-in": ${JSON.stringify(name)} }, props.children);`)].join('\n');
    };
    const alias = { name: 'substrate-alias', setup(on: any) {
      on.onResolve({ filter: /^@\// }, (args: { path: string; importer: string }) => {
        const file = ['.tsx', '.ts'].map(ext => join(substrate, args.path.slice(2)) + ext).find(path => existsSync(path));
        return file ? { path: file } : { path: args.path, namespace: 'stand-in', pluginData: standIn(args.importer, args.path) };
      });
      on.onLoad({ filter: /.*/, namespace: 'stand-in' }, (args: { pluginData: string }) => ({ contents: args.pluginData, loader: 'tsx', resolveDir: substrate }));
    } };
    const out = await build({ entryPoints: [join(substrate, 'clossys/pages/specimen.tsx')], bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', packages: 'external', plugins: [alias], logLevel: 'silent' });
    const module = { exports: {} as Record<string, any> };
    const requireHere = createRequire(import.meta.url);
    new Function('require', 'module', 'exports', out.outputFiles[0]!.text)((id: string) => id === 'react' ? React : requireHere(id), module, module.exports);
    const alone = module.exports.SlotProvider ? renderToStaticMarkup(React.createElement(module.exports.SlotProvider)) : '';
    return { markup: renderToStaticMarkup(React.createElement(module.exports.default)), standIns, providerTag: /^<[a-z]+(?:\s+[\w-]+="[^"]*")?/.exec(alone)?.[0] ?? '' };
  } finally { rmSync(substrate, { recursive: true, force: true }); }
}

type RecordedItem = { readonly type?: string; readonly files: readonly { readonly path: string; readonly type?: string; readonly target?: string; readonly content: string }[]; readonly meta?: { readonly preview?: { readonly fixtures?: { readonly file?: string; readonly export?: string; readonly props?: Record<string, unknown> } } } };

/** Every component slot's recorded candidates (Studio previews each), the pinned one first. */
const recordedComponents: ReadonlyMap<string, readonly { readonly candidate: string; readonly item: RecordedItem; readonly code: Readonly<Record<string, string>> }[]> = new Map(
  readdirSync(designer).filter(slot => slot.startsWith('components.') && existsSync(join(designer, slot, 'pin.json'))).sort().map(slot => {
    const pinned = JSON.parse(readFileSync(join(designer, slot, 'pin.json'), 'utf8')).candidate as string;
    const candidates = readdirSync(join(designer, slot, 'candidates')).filter(name => name.endsWith('.json')).sort((x, y) => Number(y === pinned) - Number(x === pinned) || x.localeCompare(y));
    return [slot, candidates.map(candidate => {
      const item = JSON.parse(readFileSync(join(designer, slot, 'candidates', candidate), 'utf8')) as RecordedItem;
      return { candidate, item, code: Object.fromEntries(installedCode(item).map(file => [file.path, file.content])) };
    })] as const;
  }));

describe('a specimen with no declared export', () => {
  const pick = new Function('mod', `return ${firstComponentSource('mod')}`) as (mod: Record<string, unknown>) => unknown;

  it('takes the first component export: never a hook, a context, its provider or an enum, whatever their order', () => {
    const Canvas = React.memo(() => null), Context = React.createContext(null);
    expect(pick({ useCanvas: () => ({ zoom: 1 }), CanvasContext: Context, CanvasProvider: Context.Provider, CanvasConsumer: Context.Consumer, Position: { Top: 'top' }, Canvas, Other: () => null })).toBe(Canvas);
    const Plain = () => null, Forwarded = React.forwardRef(() => null), Lazy = React.lazy(async () => ({ default: Plain }));
    expect(pick({ helper: () => 1, Plain })).toBe(Plain);
    expect(pick({ Forwarded })).toBe(Forwarded);
    expect(pick({ Lazy })).toBe(Lazy);
    expect(pick({ default: Plain, Canvas })).toBe(Plain);
    expect(pick({ useCanvas: () => 1, Context })).toBeUndefined();
  });

  it('mounts that export through the page module', async () => {
    const source = [
      'import { createElement, memo } from "react";',
      'export const Canvas = memo(() => createElement("div", { "data-part": "canvas" }));',
      'export function useCanvas() { return { zoom: 1 }; }',
      '',
    ].join('\n');
    expect((await renderMounted('components.sample', { file: 'lib/canvas.ts' }, { 'lib/canvas.ts': source }, { bare: true })).markup).toBe('<div data-part="canvas"></div>');
  });

});

/** A context hook called outside its provider: a shadcn guard, or React Flow's store. */
const CONTEXT_ERROR = /must be used within|provider as an ancestor/i;

describe('a component slot that reads a context', () => {
  // A slot is context-bound when a recorded candidate throws a guard (`useSidebar must be used
  // within a SidebarProvider`), calls a guarded hook a recorded file defines, or reads the React
  // Flow store: derived from the records alone, never from the state table.
  const sources = [...recordedComponents.values()].flatMap(candidates => candidates.flatMap(({ code }) => Object.values(code)));
  const guardHooks = new Set(sources.flatMap(source => [...source.matchAll(/must be used within/g)].flatMap(match => {
    const defined = [...source.slice(0, match.index).matchAll(/function\s+(use[A-Z]\w*)|const\s+(use[A-Z]\w*)\s*=/g)].at(-1);
    return defined ? [defined[1] ?? defined[2]!] : [];
  })));
  const readsContext = (source: string) => /must be used within|from\s+["']@xyflow\/react["']/.test(source) || [...guardHooks].some(hook => new RegExp(`\\b${hook}\\s*\\(`).test(source));
  const guarded = [...recordedComponents].filter(([, candidates]) => candidates.some(({ code }) => Object.values(code).some(readsContext))).map(([slot]) => slot);
  // The pinned components are the rest of the substrate, so a provider resolves to its real module.
  const substrate = Object.assign({}, ...[...recordedComponents.values()].map(candidates => candidates[0]!.code)) as Record<string, string>;
  const cnStub = { 'lib/utils.ts': 'export const cn = (...names: unknown[]) => names.filter(Boolean).join(" ");\n' };

  it('derives the guarded slots from the records', () => {
    expect([...guardHooks].sort()).toEqual(['useChart', 'useMeter', 'useProgress', 'useSidebar']);
    expect(guarded).toEqual(expect.arrayContaining(['components.chart-area', 'components.chart-bar', 'components.chart-line', 'components.meter', 'components.progress-bar', 'components.navigation-tree', 'components.sidebar', 'components.studio.sidebar-static-row', 'components.flow.canvas', 'components.flow.base-handle', 'components.flow.labeled-handle']));
  });

  it('every provider entry of the state table names a recorded component slot', () => {
    for (const [slot, state] of Object.entries(SLOT_SPECIMEN_STATES)) if (state.state === 'provider') expect(recordedComponents.has(slot), slot).toBe(true);
  });

  it('mounts every candidate through its component page and renders: a provider exactly where the bare mount needs one, never nested', async () => {
    const providerSlots = Object.entries(SLOT_SPECIMEN_STATES).filter(([, state]) => state.state === 'provider').map(([slot]) => slot);
    for (const slot of [...new Set([...guarded, ...providerSlots])].sort()) {
      const throwsBare: string[] = [];
      const provider = specimenStateOf(slot)?.state === 'provider' ? (specimenStateOf(slot) as Extract<SpecimenState, { state: 'provider' }>).provider : undefined;
      for (const [index, { candidate, item, code }] of recordedComponents.get(slot)!.entries()) {
        const own = Object.keys(code);
        if (!own.length) continue;
        const fixtures = item.meta?.preview?.fixtures;
        const file = (fixtures?.file && own.find(path => path.endsWith(`/${fixtures.file}`))) || own[0]!;
        const entry = fixtures?.export ? { file, export: fixtures.export } : { file };
        const files = { ...substrate, ...code, ...cnStub }, props = fixtures?.props ?? {};
        const mount = (options: { bare?: boolean }) => renderMounted(slot, entry, files, { props, item, ...options }).then(result => ({ ...result, error: result.markup ? undefined : 'rendered nothing' }), (error: Error) => ({ markup: '', standIns: [] as string[], providerTag: '', error: error.message }));
        const bare = await mount({ bare: true }), page = await mount({});
        const context = bare.error !== undefined && CONTEXT_ERROR.test(bare.error);
        if (context) throwsBare.push(candidate);
        if (!provider) expect(bare.error ?? '', `${slot} ${candidate} reads a context its slot declares no provider for`).not.toMatch(CONTEXT_ERROR);
        // The pinned candidate renders; another recorded one never fails for want of its context.
        if (index === 0) expect(page.error, `${slot} ${candidate}`).toBeUndefined();
        else expect(page.error ?? '', `${slot} ${candidate}`).not.toMatch(CONTEXT_ERROR);
        if (!provider) continue;
        // The provider is the substrate's own module (or a package), never a stand-in for it.
        expect(page.standIns, `${slot} ${candidate} provider ${provider.module}`).not.toContain(provider.module);
        // A provider that renders markup is counted: the page adds one exactly when the bare mount
        // throws for it, so an entry that is the provider itself is never wrapped in a second copy.
        const tag = page.providerTag || bare.providerTag;
        if (tag && !page.error && (context || !bare.error)) {
          const count = (markup: string) => markup.split(tag).length - 1;
          expect(count(page.markup), `${slot} ${candidate} ${provider.export} wrappers`).toBe(count(bare.markup) + (context ? 1 : 0));
          // The slot's provider takes the state's props (a sidebar wrapper sized to its content).
          if (context && provider.props?.style) expect(page.markup, `${slot} ${candidate} provider props`).toContain('min-height:0');
        }
      }
      if (provider) expect(throwsBare, `${slot} declares a provider no candidate needs`).not.toEqual([]);
    }
  }, 60_000);

  it.each(['components.navigation-tree', 'components.flow.canvas', 'components.flow.base-handle'])('resolves the pinned %s through the installed record source and mounts it inside exactly one provider', async slot => {
    const library = join(repo, 'clossys');
    const { pins } = slotInstallInputs(library)!;
    const provider = (specimenStateOf(slot) as Extract<SpecimenState, { state: 'provider' }>).provider;
    // The production path: installed records -> resolvePage -> componentSpecimenPage.
    const { slots, findings } = await resolvePage({ id: 'specimen-provider', frame: slot, sections: [] }, pins, installedRecordSource(library, pinnedWriterCopy(library)));
    expect(findings.filter(finding => finding.slot === slot), slot).toEqual([]);
    const row = slots.find(row => row.slot === slot && row.mounted);
    expect(row?.entry, `${slot} resolves to a mounted entry`).toBeDefined();
    // The record carries no state module: the component page is the one layer that wraps.
    expect(row!.record.payload.files.map(file => file.path)).not.toContain(SPECIMEN_STATE_FILE);
    expect((row!.record.sources ?? []).map(file => file.path)).not.toContain(SPECIMEN_STATE_FILE);
    const item = JSON.parse(row!.record.payload.raw);
    const page = componentSpecimenPage('./item--item', slot, item, row!.entry!);
    expect(page.split('<SpecimenProvider').length - 1, `${slot} page wrappers`).toBe(1);
    const fixtures = row!.record.preview.fixtures as Record<string, unknown> | undefined;
    const props = (typeof fixtures?.file === 'string' ? fixtures.props : fixtures) as Record<string, unknown> | undefined;
    const files = { ...substrate, ...Object.fromEntries(installedCode(item).map(file => [file.path, file.content])), ...cnStub };
    const mounted = await renderMounted(slot, row!.entry!, files, { props: props ?? {}, item });
    expect(mounted.markup, slot).not.toBe('');
    expect(mounted.standIns, `${slot} provider ${provider.module}`).not.toContain(provider.module);
    await expect(renderMounted(slot, row!.entry!, files, { props: props ?? {}, item, bare: true }), `${slot} needs its provider`).rejects.toThrow(CONTEXT_ERROR);
    if (mounted.providerTag) expect(mounted.markup.split(mounted.providerTag).length - 1, `${slot} rendered wrappers`).toBe(1);
  }, 60_000);
});

describe('specimen route policies', () => {
  it('serves the built specimen page and its files under a CSP scoped to that one build, and the frame page under its own', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'specimen-site-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><script type="module" crossorigin src="/__specimen-site/0123abcd/assets/index.js"></script>');
    writeFileSync(join(dist, 'assets/index.js'), 'export {};');
    const site = { key: '0123abcd', builds: [{ key: '0123abcd', dist }], findings: [],
      pages: new Map([['components.button/button@v2', { page: 'specimen-components-button-v2', element: 'button', version: 2, build: '0123abcd' }]]) };
    const routes = installedSpecimenRoutes(Promise.resolve(site));
    const server = createServer((req, res) => { void routes.handle(req, res, new URL(req.url!, 'http://x').pathname).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }); });
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
    const port = (server.address() as { port: number }).port, origin = `http://127.0.0.1:${port}`;
    const get = (path: string) => new Promise<{ status: number; headers: Record<string, any>; text: string }>((accept, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path }, response => { let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; }); response.on('end', () => accept({ status: response.statusCode!, headers: response.headers, text })); });
      req.on('error', reject); req.end();
    });
    try {
      const expected = `sandbox allow-scripts allow-same-origin; default-src 'none'; script-src ${origin}/__specimen-site/0123abcd/; style-src ${origin}/__specimen-site/0123abcd/ 'unsafe-inline'; font-src ${origin}/__specimen-site/0123abcd/ data:; img-src ${origin}/__specimen-site/0123abcd/ data:; frame-src ${origin}/__specimen; connect-src 'none'; base-uri 'none'; form-action 'none'`;
      for (const path of ['/__specimen-site/0123abcd/index.html?page=specimen-components-button-v2', '/__specimen-site/0123abcd/', '/__specimen-site/0123abcd/assets/index.js']) {
        const response = await get(path);
        expect(response.status, path).toBe(200);
        expect(response.headers['content-security-policy'], path).toBe(expected);
        // The header the server sends frames by one path source: never 'self' or a wildcard, in any directive.
        const sent = String(response.headers['content-security-policy']);
        expect(sent.split('; ').filter(part => part.startsWith('frame-src ')), path).toEqual([`frame-src ${origin}/__specimen`]);
        expect(sent, path).not.toMatch(/'self'|\*/);
      }
      const policy = new Map(expected.split('; ').map(part => [part.split(' ')[0]!, part.slice(part.indexOf(' ') + 1)]));
      // Script only from this build's own files; nothing to fetch; no top navigation, popups or forms (the sandbox grants none).
      expect(policy.get('script-src')).toBe(`${origin}/__specimen-site/0123abcd/`);
      expect(policy.get('connect-src')).toBe("'none'");
      expect(policy.get('sandbox')!.split(' ').sort()).toEqual(['allow-same-origin', 'allow-scripts']);
      // It frames exactly one path, the specimen frame route (block-viewer-iframe previews a specimen in an
      // iframe): one host-source with a path and no trailing slash, never 'self', a wildcard or a scheme.
      expect(policy.get('frame-src')).toBe(`${origin}/__specimen`);
      expect([...policy.keys()]).toEqual(['sandbox', 'default-src', 'script-src', 'style-src', 'font-src', 'img-src', 'frame-src', 'connect-src', 'base-uri', 'form-action']);
      expect(expected).not.toMatch(/'self'|\*|'unsafe-eval'|allow-top-navigation|allow-popups|allow-forms|frame-ancestors|child-src|object-src|http:(?:;|\s|$)/);
      // The frame page that loads it runs only its hashed script and may be framed only by Studio's origin.
      const frame = await get('/__specimen?element=components.button%2Fbutton&v=2&width=375');
      expect(frame.status).toBe(200);
      expect(frame.headers['content-security-policy']).toBe(SPECIMEN_FRAME_CSP);
      expect(frame.text).toContain('src="/__specimen-site/0123abcd/index.html?page=specimen-components-button-v2"');
      expect((await get('/__specimen-site/other/index.html')).status).toBe(404);
    } finally {
      await new Promise(accept => server.close(accept));
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it('fails closed for an origin or build that is not a local specimen build', () => {
    for (const [origin, build] of [['http://example.test', '0123abcd'], ['http://127.0.0.1:1', '../x'], ['http://127.0.0.1:1 *', '0123abcd'], ['http://', '0123abcd']]) {
      const policy = specimenSiteCsp(origin!, build!);
      expect(policy, `${origin} ${build}`).toContain("script-src 'none';");
      expect(policy, `${origin} ${build}`).toContain("frame-src 'none';");
      expect(policy).not.toContain(origin!.length > 7 ? origin! : 'http://');
    }
  });
});

describe('policies outside the specimen site', () => {
  // The specimen-site frame-src (R2F-C11) is the only change: every other route's policy stays byte for byte.
  it('keeps the frame, preview and served-page policies unchanged', () => {
    expect(SPECIMEN_FRAME_CSP).toBe(`default-src 'none'; script-src '${SPECIMEN_FRAME_SCRIPT_HASH}'; style-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`);
    expect(PREVIEW_PAGE_CSP).toBe("sandbox allow-same-origin; default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; connect-src 'none'");
    const origin = 'http://127.0.0.1:4711';
    expect(specimenHostCsp(origin, 'studio')).toBe(`sandbox allow-same-origin allow-scripts; default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; frame-src ${origin}/__specimen ${origin}/preview/studio/pages/; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; connect-src 'none'`);
  });
});

describe('host-only candidates', () => {
  // A candidate whose code imports a host package (`@clossys/designer-ui`) is never built in the
  // substrate; its frame request must fall through to the host mount at once instead of staying
  // pending on the pinned site's build (the Studio capture readiness timeout on Producer sections).
  const inputs = { pins: { 'sections.producer.flow': { element: 'flow', version: 14 } }, options: new Map(), unpinned: {},
    hostOnly: new Map([['sections.producer.flow/flow@v14', ['@clossys/designer-ui']], ['sections.producer.flow/flow@v1', ['@clossys/designer-ui']]]) } as unknown as SiteInputs;
  const never = new Promise<undefined>(() => {});
  const answer = (handled: Promise<boolean>) => Promise.race([handled, new Promise<'pending'>(accept => setTimeout(() => accept('pending'), 200))]);
  const call = (url: string) => installedSpecimenRoutes(never, Promise.resolve(inputs)).handle({ url } as never, {} as never, '/__specimen');

  it('hands a named host-only candidate to the host mount without waiting on the pinned build', async () => {
    expect(await answer(call('/__specimen?element=sections.producer.flow%2Fflow&v=1&width=1280'))).toBe(false);
    expect(await answer(call('/__specimen?element=sections.producer.flow%2Fflow&v=14&theme=dark'))).toBe(false);
  });

  it('hands the pinned host-only candidate (no version) to the host mount without waiting', async () => {
    expect(await answer(call('/__specimen?element=sections.producer.flow%2Fflow&width=375'))).toBe(false);
  });

  it('still waits on the pinned build for a candidate the substrate builds', async () => {
    expect(await answer(call('/__specimen?element=components.button%2Fbutton&v=2'))).toBe('pending');
  });

  it('records the refusal as a slot finding rather than an install failure', () => {
    const finding = hostOnlyFinding('sections.producer.flow', { element: 'flow', version: 14 }, ['@clossys/designer-ui']);
    expect(finding).toMatchObject({ code: 'invalid-page', slot: 'sections.producer.flow' });
    expect(finding.detail).toContain('@clossys/designer-ui');
  });
});
