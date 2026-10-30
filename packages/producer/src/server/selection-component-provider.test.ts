import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as ReactDOMServer from 'react-dom/server';
import * as JSXRuntime from 'react/jsx-runtime';
import * as JSXDevRuntime from 'react/jsx-dev-runtime';
import { renderToReadableStream, renderToStaticMarkup } from 'react-dom/server';
import * as components from '@clossys/designer/components';
import { applyLibraryChange, importFoundryComponents, libraryHash, loadCatalog, loadComponentRegistry, resolve, type CompositeCatalogData, type CompositeEngineInput, type CompositeLibraryData } from '@clossys/designer/catalog';
import { beforeAll, expect, it } from 'vitest';
import { agentModule, agentRoot } from './cells.js';
import { studioComponentProviderSource } from './selection-component-provider.js';
import { compileSelection, selectionRuntime } from './selection.js';
import { emittedDesignerSpecimenContext, renderSpecimenSwatchHostPart, renderSpecimenContrastHostPart, STUDIO_SPECIMEN_HOST_PARTS, type EmittedDesignerSpecimenRuntime } from '@clossys/designer/studio';

let input: CompositeEngineInput;
let executable: { ComponentProvider: any; Content: any };
let nativeHtml: string;
let production: EmittedDesignerSpecimenRuntime & { ComponentProvider: any; surfaces: { Content: any }; components: { SemanticContent: unknown } };

beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'producer-native-component-provider-'));
  const surfaces = (await agentModule('designer', 'library-cli/surface-catalog.js')).foundrySurfaceCatalog();
  const catalog: CompositeCatalogData = { values: loadCatalog(), components: { slots: loadComponentRegistry().slots, fills: importFoundryComponents().fills }, surfaces };
  const empty: CompositeLibraryData = { source: { id: 'example', kind: 'consumer', author: 'consumer', license: 'MIT' }, adoptedAt: '2026-10-30', values: { fills: [] }, components: { fills: [], files: [] }, surfaces: { version: 1, fills: [], files: [] } };
  const componentOptions = { packageExports: { '@clossys/designer/components': Object.keys(components) } };
  const surfaceOptions = { packages: await (await agentModule('designer', 'library-cli/surface-package-evidence.js')).readSurfacePackageEvidence(surfaces.fills), measurements: [] };
  const valueChanges = catalog.values.slots.filter(slot => slot.layer === 'tokens').flatMap(slot => {
    const offers = catalog.values.fills.filter(fill => fill.$extensions['com.clossys.fill'].slot === slot.id && fill.$extensions['com.clossys.fill'].mode !== 'reference');
    const fill = ['foundry', 'tailwind-default'].map(source => offers.find(fill => fill.$extensions['com.clossys.fill'].source === source)).find(Boolean) ?? offers[0];
    return fill ? [{ portion: 'values' as const, change: { op: 'adopt' as const, slot: slot.id, source: fill.$extensions['com.clossys.fill'].source } }] : [];
  });
  const library = applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: [
    ...valueChanges,
    { portion: 'components', change: { op: 'adopt', slot: 'components.semantic-content', source: 'foundry' } },
    { portion: 'surfaces', change: { op: 'adopt', slot: 'sections.content', source: 'foundry' } },
  ] }, { componentOptions, surfaceOptions });
  // Use the same native engine -> library files -> active cells lineage as the
  // public historical Studio fixture. No reader, compiler or provider is mocked.
  const reader = await agentModule('designer', 'library-cli/fs-library.js');
  const source = join(directory, 'library');
  for (const [name, contents] of reader.libraryFiles(catalog, library, [], componentOptions, surfaceOptions)) {
    const path = join(source, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, contents);
  }
  const cells = await agentModule('designer', 'library-cli/cells.js');
  const root = agentRoot(join(directory, 'consumer'), 'designer');
  await cells.libraryToCells(source, root, { catalog, date: '2026-10-30', surfaceOptions });
  input = { catalog, library: await reader.readLibraryFromCells(root, catalog), componentOptions, surfaceOptions };
  const profile = resolve(input);
  const provider = await studioComponentProviderSource(profile, new Map());
  const compiled = await build({ stdin: { contents: provider + '\nexport { ContentSection as Content } from "@clossys/designer/blocks";\n', resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', metafile: true, external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'], logLevel: 'silent' });
  expect(Object.keys(compiled.metafile!.inputs).some(path => /typescript|surface-evidence-compiler|measure-specimen-surfaces/.test(path))).toBe(false);
  await symlink(fileURLToPath(new URL('../../../../node_modules', import.meta.url)), join(directory, 'node_modules'), 'dir');
  const entry = join(directory, 'provider.mjs'); await writeFile(entry, compiled.outputFiles[0]!.text);
  executable = await import(pathToFileURL(entry).href);
  const rendered = await renderToReadableStream(createElement(executable.ComponentProvider, { profile }, createElement(executable.Content, null, 'Native provider content')));
  await rendered.allReady;
  nativeHtml = await new Response(rendered).text();
  const host = globalThis as typeof globalThis & { __studioDesignerRuntime?: Record<string, unknown> };
  const previous = host.__studioDesignerRuntime;
  host.__studioDesignerRuntime = { react: React, 'react-dom': ReactDOM, 'react-dom/client': ReactDOMClient, 'react-dom/server': ReactDOMServer, 'react/jsx-runtime': JSXRuntime, 'react/jsx-dev-runtime': JSXDevRuntime };
  try {
    const selection = await compileSelection(directory, input, [], libraryHash(input.library));
    const hash = new URL(selection.runtimeUrl!, 'http://127.0.0.1').searchParams.get('hash')!;
    const output = join(directory, 'production.mjs'); await writeFile(output, selectionRuntime(hash)!);
    production = await import(pathToFileURL(output).href);
  } finally { host.__studioDesignerRuntime = previous; }
}, 90_000);

it('the actual compiled provider supplies the selected semantic leaf to a native section', () => {
  const profile = resolve(input);
  expect(Object.keys(profile.components.components)).toEqual(['components.semantic-content']);
  expect(nativeHtml).toContain('Native provider content');
  expect(nativeHtml).toContain('data-ds-leaf="sections.content"');
  expect(() => renderToStaticMarkup(createElement(executable.Content, null, 'Missing provider'))).toThrow(/NEED component selection/);
});

it('registered token host parts render current member references through the actual selected production binding', async () => {
  const profile = resolve(input), context = emittedDesignerSpecimenContext(profile, production);
  expect(STUDIO_SPECIMEN_HOST_PARTS['studio.specimen-swatch'].export).toBe('renderSpecimenSwatchHostPart');
  expect(STUDIO_SPECIMEN_HOST_PARTS['studio.specimen-contrast'].export).toBe('renderSpecimenContrastHostPart');
  const parts = (['light', 'dark'] as const).flatMap(mode => [
    renderSpecimenSwatchHostPart(context, { memberId: 'tokens.surface-color.base', mode }),
    renderSpecimenContrastHostPart(context, { backgroundMemberId: 'tokens.surface-color.base', colorMemberId: 'tokens.text-color.primary', pairMemberId: 'tokens.text-color.primary', mode, children: 'Native provider content' }),
  ]);
  const stream = await renderToReadableStream(createElement(production.ComponentProvider, { profile }, parts));
  await stream.allReady;
  const html = await new Response(stream).text();
  expect(html.match(/background:var\(--color-surface-base\)/g)).toHaveLength(4);
  expect(html.match(/color:var\(--color-ink-primary\)/g)).toHaveLength(2);
  expect(() => renderSpecimenSwatchHostPart(context, { memberId: '#ffffff', mode: 'light' })).toThrow(/no matching registered color reference/);
  const changed = structuredClone(profile);
  changed.values.members['tokens.surface-color.base']!.emit = '--unregistered';
  expect(() => renderSpecimenSwatchHostPart({ ...context, profile: changed }, { memberId: 'tokens.surface-color.base', mode: 'light' })).toThrow(/no matching registered color reference/);
});

it('the actual provider rejects a different index revision and a changed selected descriptor', () => {
  const profile = resolve(input);
  const stale = structuredClone(profile); stale.components.selectionHash = 'sha256:stale';
  expect(() => renderToStaticMarkup(createElement(executable.ComponentProvider, { profile: stale }, 'Stale'))).toThrow(/index selection hash differs/);
  const edited = structuredClone(profile);
  edited.components.components['components.semantic-content']!.descriptor.props = ['changed'];
  expect(() => renderToStaticMarkup(createElement(executable.ComponentProvider, { profile: edited }, createElement(executable.Content, null, 'Changed')))).toThrow(/stale descriptor/);
});

it('the production projection shares the provider context and keeps raw implementations distinct from adapters', async () => {
  const profile = resolve(input);
  const installed = production.ComponentProvider({ profile, children: null }).props.value;
  expect(installed.modules['@clossys/designer/components'].SemanticContent).not.toBe(production.components.SemanticContent);
  const rendered = await renderToReadableStream(createElement(production.ComponentProvider, { profile }, createElement(production.surfaces.Content, null, 'Production provider content')));
  await rendered.allReady;
  expect(await new Response(rendered).text()).toContain('Production provider content');
  expect(() => renderToStaticMarkup(createElement(production.surfaces.Content, null, 'Missing production provider'))).toThrow(/NEED component selection/);
}, 30_000);
