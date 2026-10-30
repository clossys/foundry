import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as ReactDOMServer from 'react-dom/server';
import * as JSXRuntime from 'react/jsx-runtime';
import * as JSXDevRuntime from 'react/jsx-dev-runtime';
import * as components from '@clossys/designer/components';
import { applyLibraryChange, libraryHash, loadCatalog, loadComponentRegistry, resolve, type CompositeCatalogData, type CompositeEngineInput } from '@clossys/designer/catalog';
import { loadCatalogBundles } from '@clossys/designer/catalog-bundles';
import { componentSpecimenPreview, emittedDesignerSpecimenContext, type EmittedDesignerSpecimenRuntime } from '@clossys/designer/studio';
import { beforeAll, expect, it } from 'vitest';
import { agentModule, agentRoot } from './cells.js';
import { compileSelection, selectionRuntime } from './selection.js';

let profile: ReturnType<typeof resolve>;
let runtime: EmittedDesignerSpecimenRuntime & { ComponentProvider: React.ComponentType<{ profile: typeof profile; children: React.ReactNode }> };
let directory: string;
const leaf = 'components.card', entry = 'components/card/card.tsx';

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'producer-edited-card-host-'));
  const bundles = loadCatalogBundles();
  const catalog: CompositeCatalogData = { values: loadCatalog(), components: { slots: loadComponentRegistry().slots, fills: bundles.componentFills }, surfaces: { slots: [], fills: [], transforms: [], rules: [], materializations: [] } };
  const document = catalog.components.fills.find(document => document.$extensions['com.clossys.fill'].slot === leaf && document.$extensions['com.clossys.fill'].source === 'shadcn@aria')!;
  const candidate = structuredClone(Object.values(document.components)[0]!);
  const bundle = bundles.sourceBundles.find(bundle => bundle.slot === leaf)!;
  const { sha256 } = await agentModule('designer', 'catalog-core/digest.js');
  const files = bundle.files.map(file => {
    if (file.path !== entry) return file;
    expect(file.content.match(/data-slot="card"/g)).toHaveLength(1);
    return { ...file, content: file.content.replace('data-slot="card"', 'data-slot="card" data-native-source="edited"') };
  });
  candidate.outputSha256 = files.map(file => ({ path: file.path, sha256: sha256(file.content) }));
  const empty = { source: { id: 'example', kind: 'consumer' as const, author: 'consumer' as const, license: 'MIT' }, adoptedAt: '2026-10-30', values: { fills: [] }, components: { fills: [], files: [] }, surfaces: { version: 1 as const, fills: [], files: [] } };
  const componentOptions = { packageExports: Object.fromEntries(await Promise.all(['react', 'clsx', 'tailwind-merge', '@clossys/designer/components'].map(async module => [module, Object.keys(await import(module))]))) };
  const values = catalog.values.slots.filter(slot => slot.layer === 'tokens').flatMap(slot => {
    const offers = catalog.values.fills.filter(fill => fill.$extensions['com.clossys.fill'].slot === slot.id && fill.$extensions['com.clossys.fill'].mode !== 'reference');
    const fill = ['foundry', 'tailwind-default'].map(source => offers.find(fill => fill.$extensions['com.clossys.fill'].source === source)).find(Boolean) ?? offers[0];
    return fill ? [{ portion: 'values' as const, change: { op: 'adopt' as const, slot: slot.id, source: fill.$extensions['com.clossys.fill'].source } }] : [];
  });
  const library = applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: [...values,
    { portion: 'components', change: { op: 'adopt', slot: 'components.semantic-content', source: 'foundry' } },
    { portion: 'components', change: { op: 'author', slot: leaf, fill: candidate, files } },
  ] }, { componentOptions });
  // An actual authored closure crosses the native public fixture's disk and cell boundaries.
  const reader = await agentModule('designer', 'library-cli/fs-library.js');
  const source = join(directory, 'library');
  for (const [name, contents] of reader.libraryFiles(catalog, library, [], componentOptions)) {
    const path = join(source, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, contents);
  }
  const cellRoot = agentRoot(join(directory, 'consumer'), 'designer');
  await (await agentModule('designer', 'library-cli/cells.js')).libraryToCells(source, cellRoot, { catalog, date: '2026-10-30' });
  const input: CompositeEngineInput = { catalog, library: await reader.readLibraryFromCells(cellRoot, catalog), componentOptions };
  profile = resolve(input);
  const host = globalThis as typeof globalThis & { __studioDesignerRuntime?: Record<string, unknown> };
  const previous = host.__studioDesignerRuntime;
  host.__studioDesignerRuntime = { react: React, 'react-dom': ReactDOM, 'react-dom/client': ReactDOMClient, 'react-dom/server': ReactDOMServer, 'react/jsx-runtime': JSXRuntime, 'react/jsx-dev-runtime': JSXDevRuntime };
  try {
    const selection = await compileSelection(directory, input, [], libraryHash(input.library));
    const hash = new URL(selection.runtimeUrl!, 'http://127.0.0.1').searchParams.get('hash')!;
    await symlink(fileURLToPath(new URL('../../../../node_modules', import.meta.url)), join(directory, 'node_modules'), 'dir');
    const output = join(directory, 'runtime.mjs'); await writeFile(output, selectionRuntime(hash)!);
    runtime = await import(pathToFileURL(output).href);
  } finally { host.__studioDesignerRuntime = previous; }
}, 90_000);

it('an actual edited Card closure uses its authenticated host recipe and real secondary exports', async () => {
  const defaults = await agentModule('designer', 'studio/default-component-previews.js');
  expect(defaults.defaultComponentPreviews.preview(leaf, profile)).toBeUndefined();
  const context = emittedDesignerSpecimenContext(profile, runtime);
  expect(context.componentPreviewNeeds?.[leaf]).toBeUndefined();
  expect(context.componentOptions?.specimens?.[leaf]).toBeTypeOf('function');
  const preview = componentSpecimenPreview({ ...context.componentOptions, modules: context.modules, restOnly: true }).preview(leaf, profile);
  const rendered = await ReactDOMServer.renderToReadableStream(React.createElement(runtime.ComponentProvider, { profile }, preview));
  await rendered.allReady;
  const html = await new Response(rendered).text();
  expect(html).toContain('data-native-source="edited"');
  for (const part of ['card-header', 'card-title', 'card-content']) expect(html).toContain(`data-slot="${part}"`);
  expect(runtime.componentSourceIdentities![leaf]!.files.some(file => file.path === entry)).toBe(true);
});

it('missing or changed source dependencies refuse the real host binding', () => {
  const dependency = profile.components.components[leaf]!.descriptor.outputSha256!.find(file => file.path !== entry && file.path.endsWith('.ts'))!;
  expect(dependency).toBeDefined();
  const missing = structuredClone(profile); missing.components.files = missing.components.files.filter(file => file.path !== dependency.path);
  expect(() => emittedDesignerSpecimenContext(missing, runtime)).toThrow(/output hash differs/);
  const changed = structuredClone(profile); changed.components.files.find(file => file.path === dependency.path)!.content += '\n';
  expect(() => emittedDesignerSpecimenContext(changed, runtime)).toThrow(/output hash differs/);
});

it('replaced root namespaces, parts and current source identities refuse before previewing', () => {
  const raw = runtime.componentModules![entry]!;
  expect(() => emittedDesignerSpecimenContext(profile, { ...runtime, componentModules: { ...runtime.componentModules, [entry]: { ...raw, Card: components.Card } } })).toThrow(/source closure or selected namespace differs/);
  expect(() => emittedDesignerSpecimenContext(profile, { ...runtime, componentModules: { ...runtime.componentModules, [entry]: { ...raw, CardContent: components.Card } } })).toThrow(/source closure or selected namespace differs|selected source part/);
  const identity = { ...runtime.componentSourceIdentities![leaf]!, sourceHash: 'changed' };
  expect(() => emittedDesignerSpecimenContext(profile, { ...runtime, componentSourceIdentities: { ...runtime.componentSourceIdentities, [leaf]: identity } })).toThrow(/source closure or selected namespace differs/);
  const missing = emittedDesignerSpecimenContext(profile, { ...runtime, componentSourceIdentities: {} });
  expect(missing.componentPreviewNeeds?.[leaf]).toContain('no authenticated host preview');
  expect(missing.componentOptions?.specimens?.[leaf]).toBeUndefined();
});
