#!/usr/bin/env node
/** Current canonical Swatch and registered host-part S5 styling proof. Not whole-leaf S8 clearance. */
import ts from 'typescript';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as React from 'react';
import { renderToReadableStream } from 'react-dom/server';
import { applyLibraryChange, importFoundryComponents, libraryHash, loadCatalog, loadComponentRegistry, loadSectionRegistry, resolve as resolveProfile } from '../dist/catalog-core/index.js';
import { bindSurfaceSource, surfaceDogfoodImportBindings } from '../dist/catalog-core/surface-bindings.js';
import { buildSurfaceConsumption } from '../dist/catalog-core/surface-consumption.js';
import { surfaceManifest, surfaceOf } from '../dist/catalog-core/surface-library.js';
import { specimenSectionSourceCatalog } from '../dist/importers/specimen-sections.js';
import { STUDIO_SPECIMEN_HOST_PARTS } from '../dist/catalog-core/studio-host-parts.js';
import { agentModule, agentRoot } from '../../producer/dist/server/cells.js';
import { studioComponentProviderSource } from '../../producer/dist/server/selection-component-provider.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sha256 = text => createHash('sha256').update(text).digest('hex');
const reportArgument = process.argv.slice(2);
if (reportArgument.length && (reportArgument.length !== 2 || reportArgument[0] !== '--report')) throw new Error('Usage: check-specimen-token-host-parts.mjs [--report FILE]');
const canonicalPath = 'packages/designer/src/studio/specimen-token-assets.tsx';
const hostPath = 'packages/designer/src/studio/specimen-token-host-parts.tsx';
const canonical = await readFile(join(root, canonicalPath), 'utf8'), host = await readFile(join(root, hostPath), 'utf8');
const configPath = join(root, 'packages/designer/tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath)).options;
const program = ts.createProgram([join(root, canonicalPath), join(root, hostPath), join(root, 'packages/designer/src/studio/index.ts')], options);
const checker = program.getTypeChecker();
const ast = program.getSourceFile(join(root, canonicalPath)), hostAst = program.getSourceFile(join(root, hostPath));
const sourceInputs = [];
for (const name of [canonicalPath, hostPath, 'packages/designer/src/studio/specimen-token-reference.ts', 'packages/designer/src/catalog-core/studio-host-parts.ts']) {
  const file = program.getSourceFile(join(root, name));
  if (!file) throw new Error(`Actual source unavailable: ${name}`);
  let emitted;
  const result = program.emit(file, (name, content) => { if (name.endsWith('.js')) emitted = content; });
  const installed = await readFile(join(root, name.replace('/src/', '/dist/').replace(/\.tsx?$/, '.js')), 'utf8');
  if (result.emitSkipped || emitted !== installed) throw new Error(`Current source build required: ${name}`);
  sourceInputs.push({ path: name, sha256: sha256(file.text), compiledSha256: sha256(installed) });
}
const tokenRegistryPath = 'packages/designer/src/catalog/slots/tokens.json';
const tokenRegistrySource = await readFile(join(root, tokenRegistryPath), 'utf8');
const tokenRegistryInstalled = await readFile(join(root, tokenRegistryPath.replace('/src/', '/dist/')), 'utf8');
if (JSON.stringify(JSON.parse(tokenRegistrySource)) !== JSON.stringify(JSON.parse(tokenRegistryInstalled))) throw new Error('The current registered token/member emit mappings differ from the installed build');
sourceInputs.push({ path: tokenRegistryPath, sha256: sha256(tokenRegistrySource), compiledSha256: sha256(tokenRegistryInstalled), proof: 'current source JSON data equals actual installed registry' });
const unalias = symbol => symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(join(root, 'packages/designer/src/studio/index.ts'))));
const constructorImport = hostAst.statements.filter(ts.isImportDeclaration).flatMap(statement => statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings) ? statement.importClause.namedBindings.elements : []).find(element => element.name.text === 'studioSpecimenTokenStyle');
if (!constructorImport || unalias(checker.getSymbolAtLocation(constructorImport.name)) !== unalias(exports.find(symbol => symbol.name === 'studioSpecimenTokenStyle'))) throw new Error('The actual constructor and public export are different source symbols');
for (const part of Object.values(STUDIO_SPECIMEN_HOST_PARTS)) {
  const declaration = hostAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === part.export);
  if (!declaration || unalias(exports.find(symbol => symbol.name === part.export)) !== checker.getSymbolAtLocation(declaration.name)) throw new Error('The registered host export is not the actual source declaration');
}

const directory = await mkdtemp(join(tmpdir(), 'studio-token-host-proof-'));
const compiler = spawnSync(process.execPath, ['dist/library-cli/surface-evidence-compiler.js'], { cwd: join(root, 'packages/designer'), input: JSON.stringify({ modules: ['react', '@clossys/designer/components', '@clossys/designer/studio', '@clossys/designer/catalog'] }), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
await writeFile(join(directory, 'dependency-compiler.stdout.json'), compiler.stdout);
await writeFile(join(directory, 'dependency-compiler.stderr.txt'), compiler.stderr);
if (compiler.status !== 0) throw new Error(`Actual dependency compiler failed: ${compiler.stderr}`);
const inventory = JSON.parse(compiler.stdout);
const catalog = { values: loadCatalog(), components: { slots: loadComponentRegistry().slots, fills: importFoundryComponents().fills } };
const componentOptions = { packageExports: Object.fromEntries(inventory.packages.map(row => [row.module, row.values])) };
const empty = { source: { id: 'example', kind: 'consumer', author: 'consumer', license: 'MIT' }, adoptedAt: '2026-10-30', values: { fills: [] }, components: { fills: [], files: [] } };
const changes = catalog.values.slots.filter(slot => slot.layer === 'themes').flatMap(slot => {
  const offers = catalog.values.fills.filter(fill => fill.$extensions['com.clossys.fill'].slot === slot.id && fill.$extensions['com.clossys.fill'].mode !== 'reference');
  const fill = ['foundry', 'tailwind-default'].map(source => offers.find(fill => fill.$extensions['com.clossys.fill'].source === source)).find(Boolean) ?? offers[0];
  return fill ? [{ portion: 'values', change: { op: 'adopt', slot: slot.id, source: fill.$extensions['com.clossys.fill'].source } }] : [];
});
const library = applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: [...changes, { portion: 'components', change: { op: 'adopt', slot: 'components.semantic-content', source: 'foundry' } }] }, { componentOptions });
const reader = await agentModule('designer', 'library-cli/fs-library.js');
for (const [name, content] of reader.libraryFiles(catalog, library, [], componentOptions)) {
  const file = join(directory, 'library', name); await mkdir(dirname(file), { recursive: true }); await writeFile(file, content);
}
const cells = agentRoot(join(directory, 'consumer'), 'designer');
await (await agentModule('designer', 'library-cli/cells.js')).libraryToCells(join(directory, 'library'), cells, { catalog, date: '2026-10-30' });
const profile = resolveProfile({ catalog, library: await reader.readLibraryFromCells(cells, catalog), componentOptions });
const providerSource = await studioComponentProviderSource(profile, new Map());
const canonicalDist = join(root, 'packages/designer/dist/studio/specimen-token-assets.js');
const source = `${providerSource}\nexport { Swatch } from ${JSON.stringify(canonicalDist)};\nexport { renderSpecimenSwatchHostPart, renderSpecimenContrastHostPart, studioSpecimenTokenStyle, specimenTokenReference, componentSpecimenPreview } from "@clossys/designer/studio";\n`;
const bundled = await build({ stdin: { contents: source, resolveDir: root, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', metafile: true, external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'], banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' }, logLevel: 'silent', plugins: [{ name: 'actual-private-swatch-export', setup(context) { context.onLoad({ filter: /specimen-token-assets\.js$/ }, async args => args.path === canonicalDist ? { loader: 'js', contents: await readFile(args.path, 'utf8') + '\nexport { Swatch };\n' } : undefined); } }] });
if (Object.keys(bundled.metafile.inputs).some(file => /typescript|surface-evidence-compiler|measure-specimen-surfaces/.test(file))) throw new Error('Build-only code reached the real host module');
await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
const bundlePath = join(directory, 'actual-host-binding.mjs'); await writeFile(bundlePath, bundled.outputFiles[0].text);
const executable = await import(pathToFileURL(bundlePath).href);
const context = { profile, modules: executable.componentModules };
const memberId = 'themes.background.default', pairMemberId = 'themes.foreground.default';
const callbackCalls = [];
const parts = {
  'studio.specimen-swatch': input => { callbackCalls.push({ part: 'studio.specimen-swatch', ...input }); return executable.renderSpecimenSwatchHostPart(context, input); },
  'studio.specimen-contrast': input => { callbackCalls.push({ part: 'studio.specimen-contrast', ...input, children: undefined }); return executable.renderSpecimenContrastHostPart(context, input); },
};
const runtimeFindings = [];
let html;
try {
  const rendered = await renderToReadableStream(React.createElement(executable.ComponentProvider, { profile }, React.createElement(executable.Swatch, { id: memberId, member: profile.values.members[memberId], context, renderParts: parts })));
  await rendered.allReady; html = await new Response(rendered).text();
  if (callbackCalls.length !== 4 || !html.includes('background:var(--color-surface-base)') || !html.includes('color:var(--color-ink-primary)')) throw new Error('The actual canonical callbacks did not render both registered token modes');
} catch (error) { runtimeFindings.push({ code: 'S5', evidence: error.message }); }

const original = surfaceOf(specimenSectionSourceCatalog().fills.find(document => document.$extensions['com.clossys.fill'].slot === 'sections.specimen-swatch'));
const selected = executable.componentSpecimenPreview({ modules: context.modules }).bind('components.semantic-content', profile);
if ('refusal' in selected) throw new Error(selected.refusal.detail);
const nativeFindings = [], cases = [];
const swatch = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Swatch');
const sources = [{ name: 'Swatch', text: 'export ' + swatch.getText(ast), imports: 'import type { ResolvedMember } from "@clossys/designer/catalog";\nimport type { DesignerSpecimenContext, SpecimenLeafProps } from "@clossys/designer/studio";\n', sourcePath: canonicalPath }];
for (const [id, part] of Object.entries(STUDIO_SPECIMEN_HOST_PARTS)) {
  const node = hostAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === part.export);
  const request = id === 'studio.specimen-swatch' ? { memberId, mode: 'light' } : { backgroundMemberId: memberId, colorMemberId: pairMemberId, pairMemberId, mode: 'light' };
  try { if (executable[part.export](context, request).type !== selected.binding.Component) throw new Error('The actual host returned a different selected component'); } catch (error) { runtimeFindings.push({ code: 'S5', evidence: error.message }); }
  sources.push({ name: part.export, text: node.getText(hostAst).replace('  const Content = selectedContent(context);\n', ''), imports: 'import type { ReactNode } from "react";\nimport { studioSpecimenTokenStyle, specimenTokenReference, type DesignerSpecimenContext, type SpecimenSwatchHostRequest, type SpecimenContrastHostRequest } from "@clossys/designer/studio";\n', sourcePath: hostPath });
}
for (const source of sources) {
  const entry = `sections/specimen-swatch/${source.name}.tsx`;
  const code = 'import { SemanticContent as Content } from "../../components/semantic-content/index.js";\n' + source.imports + source.text + '\n';
  const file = { path: entry, content: code };
  const modules = new Set(['react', '@clossys/designer/components', ...[...code.matchAll(/from\s+["']([^"']+)["']/g)].map(row => row[1]).filter(module => !module.startsWith('.'))]);
  const fill = { ...original, impl: { kind: 'source', entry, export: source.name }, api: { version: 1, exports: [{ name: source.name, export: source.name }] }, bindings: [{ file: entry, module: '../../components/semantic-content/index.js', name: 'SemanticContent', local: 'Content', slot: 'components.semantic-content' }], dependencies: inventory.dependencies.filter(row => modules.has(row.module)), outputSha256: surfaceManifest([file]) };
  const bound = bindSurfaceSource(fill, [file], profile, inventory.packages);
  if (bound.proof.findings.length) throw new Error(JSON.stringify(bound.proof.findings));
  const resolvedImports = surfaceDogfoodImportBindings(fill, bound);
  const report = buildSurfaceConsumption({ tokens: catalog.values.slots.filter(slot => slot.layer === 'themes').map(slot => ({ id: slot.id, contract: { emit: slot.contract.emit } })), assets: catalog.values.slots.filter(slot => slot.layer === 'assets'), components: catalog.components.slots, sections: loadSectionRegistry().slots.filter(slot => slot.id === fill.slot), frames: [], fills: [{ id: 'foundry/sections.specimen-swatch', slot: fill.slot, source: 'foundry' }], sourceScans: [{ fill: 'foundry/sections.specimen-swatch', files: [file], resolvedImports }], themeCss: '' });
  nativeFindings.push(...report.findings);
  cases.push({ sourcePath: source.sourcePath, export: source.name, observedPath: entry, observedSourceSha256: sha256(code), originalDeclarationSha256: sha256(source.name === 'Swatch' ? swatch.getText(ast) : hostAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === source.name).getText(hostAst)), s4Findings: bound.proof.findings, resolvedImports, findings: report.findings });
}
const negatives = [];
const expectRefusal = (name, operation) => { try { operation(); negatives.push({ name, rejected: false }); } catch (error) { negatives.push({ name, rejected: true, evidence: error.message }); } };
const good = executable.specimenTokenReference(profile.values, memberId, 'light');
expectRefusal('forged raw-css reference', () => executable.studioSpecimenTokenStyle('studio.specimen-swatch', profile.values, { memberId, mode: 'light' }, { member: { css: '#ffffff' } }));
expectRefusal('valid capability for another member', () => executable.studioSpecimenTokenStyle('studio.specimen-swatch', profile.values, { memberId: pairMemberId, mode: 'light' }, { member: good }));
expectRefusal('wrong mode capability', () => executable.studioSpecimenTokenStyle('studio.specimen-swatch', profile.values, { memberId, mode: 'dark' }, { member: good }));
expectRefusal('different selected values identity', () => executable.studioSpecimenTokenStyle('studio.specimen-swatch', structuredClone(profile.values), { memberId, mode: 'light' }, { member: good }));
for (const value of ['#ffffff', 'var(--unknown)', 'var(--color-surface-base, #ffffff)']) expectRefusal(`unregistered token input ${value}`, () => executable.specimenTokenReference(profile.values, value, 'light'));
const df2 = nativeFindings.filter(finding => finding.code === 'DF2');
const result = { scope: 'Actual current canonical Swatch and two registered host-part S5 styling/binding proof; not complete native-leaf or S8 qualification.', status: !df2.length && !runtimeFindings.length && negatives.every(row => row.rejected) ? 'PASS' : 'FAIL', qualifiedNativeLeaves: 0, canonical: { path: canonicalPath, sha256: sha256(canonical) }, sourceInputs, sourceSymbolIdentity: { constructor: 'actual host import === actual public export', registeredParts: Object.keys(STUDIO_SPECIMEN_HOST_PARTS) }, publicFixture: directory, lineage: ['actual-engine', 'libraryFiles', 'libraryToCells', 'readLibraryFromCells', 'actual shared production provider source', 'full current canonical compiled module'], dependencyCompiler: { argv: [process.execPath, 'dist/library-cli/surface-evidence-compiler.js'], exitCode: compiler.status, stdoutSha256: sha256(compiler.stdout), stderrSha256: sha256(compiler.stderr) }, cases, df2, otherNativeFindings: nativeFindings.filter(finding => finding.code !== 'DF2'), runtimeFindings, actualCanonicalCallbackCalls: callbackCalls, negatives, runtimeBundleSha256: sha256(bundled.outputFiles[0].text) };
if (reportArgument.length) await writeFile(resolve(reportArgument[1]), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ scope: result.scope, status: result.status, canonical: result.canonical, df2: result.df2, otherNativeFindings: result.otherNativeFindings, runtimeFindings, negatives, report: reportArgument[1] }));
process.exitCode = result.status === 'PASS' ? 0 : 1;
