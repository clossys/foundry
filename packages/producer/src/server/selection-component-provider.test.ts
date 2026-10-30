import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToReadableStream, renderToStaticMarkup } from 'react-dom/server';
import * as components from '@clossys/designer/components';
import { applyLibraryChange, importFoundryComponents, libraryHash, loadCatalog, loadComponentRegistry, resolve, type CompositeCatalogData, type CompositeEngineInput, type CompositeLibraryData } from '@clossys/designer/catalog';
import { beforeAll, expect, it } from 'vitest';
import { agentModule, agentRoot } from './cells.js';
import { studioComponentProviderSource } from './selection-component-provider.js';

let input: CompositeEngineInput;
let executable: { ComponentProvider: any; Content: any };
let nativeHtml: string;

beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'producer-native-component-provider-'));
  const catalog: CompositeCatalogData = { values: loadCatalog(), components: { slots: loadComponentRegistry().slots, fills: importFoundryComponents().fills }, surfaces: { slots: [], fills: [], transforms: [], rules: [], materializations: [] } };
  const empty: CompositeLibraryData = { source: { id: 'example', kind: 'consumer', author: 'consumer', license: 'MIT' }, adoptedAt: '2026-10-30', values: { fills: [] }, components: { fills: [], files: [] }, surfaces: { version: 1, fills: [], files: [] } };
  const componentOptions = { packageExports: { '@clossys/designer/components': Object.keys(components) } };
  const library = applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: [
    { portion: 'values', change: { op: 'adopt', slot: 'tokens.accent-color', source: 'foundry' } },
    { portion: 'components', change: { op: 'adopt', slot: 'components.semantic-content', source: 'foundry' } },
  ] }, { componentOptions });
  // Use the same native engine -> library files -> active cells lineage as the
  // public historical Studio fixture. No reader, compiler or provider is mocked.
  const reader = await agentModule('designer', 'library-cli/fs-library.js');
  const source = join(directory, 'library');
  for (const [name, contents] of reader.libraryFiles(catalog, library, [], componentOptions)) {
    const path = join(source, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, contents);
  }
  const cells = await agentModule('designer', 'library-cli/cells.js');
  const root = agentRoot(join(directory, 'consumer'), 'designer');
  await cells.libraryToCells(source, root, { catalog, date: '2026-10-30' });
  input = { catalog, library: await reader.readLibraryFromCells(root, catalog), componentOptions };
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
}, 90_000);

it('the actual compiled provider supplies the selected semantic leaf to a native section', () => {
  const profile = resolve(input);
  expect(Object.keys(profile.components.components)).toEqual(['components.semantic-content']);
  expect(nativeHtml).toContain('Native provider content');
  expect(nativeHtml).toContain('data-ds-leaf="sections.content"');
  expect(() => renderToStaticMarkup(createElement(executable.Content, null, 'Missing provider'))).toThrow(/NEED component selection/);
});

it('the actual provider rejects a different index revision and a changed selected descriptor', () => {
  const profile = resolve(input);
  const stale = structuredClone(profile); stale.components.selectionHash = 'sha256:stale';
  expect(() => renderToStaticMarkup(createElement(executable.ComponentProvider, { profile: stale }, 'Stale'))).toThrow(/index selection hash differs/);
  const edited = structuredClone(profile);
  edited.components.components['components.semantic-content']!.descriptor.props = ['changed'];
  expect(() => renderToStaticMarkup(createElement(executable.ComponentProvider, { profile: edited }, createElement(executable.Content, null, 'Changed')))).toThrow(/stale descriptor/);
});
