import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { isBuiltin } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { listSlots, readCandidate, readSlot } from '../records/slots.js';
import { CANDIDATE_NAME, validateCandidate, validateSlotDoc } from '../records/slot-model/index.js';
import { CODE_FILE, DS_COMPONENT_LAYER, DS_FRAME_LANDMARKS, dsOnlyEvents, scriptKind } from '@clossys/designer/ref-verbatim';

/**
 * AMEND-1 ds-only check for every Studio section and frame the page records place: each folder
 * imports components only from Designer's component layer (`@clossys/designer-ui`) or from inside
 * its own folder, and renders no raw styled markup (a lowercase element carrying `className` or `style`).
 *
 * A frame is the page shell of a shadcn block (sidebar-15), so it also runs the app: it may import
 * React, the Next router, lucide icons, type-only modules and Studio's runtime hooks, and its three
 * page landmarks (`header`, `main`, `aside`) carry the layout classes the block's shell carries.
 * Every other element a frame renders is a Designer component, exactly as in a section, or the
 * block's own markup: a raw element whose tag and literal `className` appear verbatim in the
 * reference blocks its pinned record's `lineage.source` and `lineage.parts` name (the shadcn snapshots under
 * `packages/designer/references/shadcn/<item>@<version>/registry/`).
 *
 * A section may also place another pinned Studio section's export (`../<folder>`) when, and only
 * when, its pinned canonical record declares that section in `meta.element.deps.elements`: composition the record
 * store tracks (a re-pin of the dependency marks the dependent stale), never an ad hoc import.
 */
const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), '../../studio');
// DS_ONLY_SECTIONS_ROOT points the section scan at another sections folder (a rule fixture).
const VIEWS = process.env.DS_ONLY_SECTIONS_ROOT ? resolve(process.env.DS_ONLY_SECTIONS_ROOT) : join(STUDIO, 'sections');
const FRAMES = join(STUDIO, 'frames');
const folders = (root: string) => readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
const FOLDERS = folders(VIEWS);
const FRAME_FOLDERS = folders(FRAMES);
const COMPONENT_LAYER = DS_COMPONENT_LAYER;
const FRAME_LANDMARKS = DS_FRAME_LANDMARKS;
const FRAME_RUNTIME = new Set(['react', 'next/navigation', 'lucide-react', '../../components/StudioProviders', '../../lib/studio-icons']);
const CLOSSYS = resolve(STUDIO, '../../../clossys');
const REFERENCES = resolve(STUDIO, '../../designer/references/shadcn');

const filesUnder = (root: string): string[] => readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? filesUnder(join(root, entry.name)) : [join(root, entry.name)]);
const classAttribute = (node: ts.JsxOpeningElement | ts.JsxSelfClosingElement) => node.attributes.properties.find((attribute): attribute is ts.JsxAttribute => ts.isJsxAttribute(attribute) && attribute.name.getText() === 'className');

/** `<tag> <className>` pairs of the raw elements in one reference block's source files. */
export function referenceMarkup(root: string): Set<string> {
  const pairs = new Set<string>();
  for (const file of filesUnder(root).filter(path => path.endsWith('.tsx'))) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        const value = classAttribute(node)?.initializer;
        if (/^[a-z]/.test(tag) && value && ts.isStringLiteral(value)) pairs.add(`${tag} ${value.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return pairs;
}

type Ref = { registry: string; item: string; version: string; hash: string };

/** Migrated lineage preserves structured objects and arrays as JSON strings. Decode deliberately. */
export function lineageReferences(refs: unknown): Ref[] {
  if (!Array.isArray(refs)) return [];
  const rows: unknown[] = refs.flatMap(value => {
    if (typeof value !== 'string') return [];
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [parsed]; } catch { return []; }
  });
  return rows.filter((row): row is Ref => !!row && typeof row === 'object'
    && (row as Ref).registry === 'shadcn' && /^[a-z0-9-]+$/.test((row as Ref).item ?? '')
    && /^\d+\.\d+\.\d+$/.test((row as Ref).version ?? '') && /^sha256:[a-f0-9]{64}$/.test((row as Ref).hash ?? ''));
}

/** Read only the exact valid canonical pin; a stale legacy record cannot authorize markup. */
function pinnedElement(folder: string, prefix: string, clossys: string): { item: any; slot: string; version: number } | undefined {
  const entries = listSlots(clossys, 'designer').filter(entry => entry.id.startsWith(prefix) && entry.pin && CANDIDATE_NAME.exec(entry.pin.candidate)?.[1] === folder);
  if (entries.length !== 1) return undefined;
  const entry = entries[0]!, name = entry.pin!.candidate;
  if (!entry.candidates.includes(name)) return undefined;
  const candidate = readCandidate(clossys, 'designer', entry.id, name), doc = readSlot(clossys, 'designer', entry.id);
  if (candidate.sha256 !== entry.pin!.sha256 || validateCandidate('element', entry.id, name, candidate.bytes).length
    || validateSlotDoc(doc).length || doc.kind !== 'element' || doc.id !== entry.id || doc.agent !== 'designer'
    || doc.ia.l0 !== entry.position.l0 || doc.ia.l1 !== entry.position.l1 || doc.ia.l2 !== entry.position.l2 || doc.ia.order !== entry.position.order) return undefined;
  const item = JSON.parse(candidate.bytes);
  if (item.name !== folder || item.meta?.element?.id !== folder || item.meta?.element?.slot !== entry.id) return undefined;
  return { item, slot: entry.id, version: Number(CANDIDATE_NAME.exec(name)![2]) };
}

/** Stock markup from exact reference identities in the pinned candidate's preserved lineage. */
export function frameBlockMarkup(folder: string, clossys = CLOSSYS, references = REFERENCES): Set<string> {
  const pinned = pinnedElement(folder, 'frames.', clossys);
  if (!pinned) return new Set();
  const manifest = JSON.parse(readFileSync(join(references, '../manifest.json'), 'utf8'));
  const markup = new Set<string>();
  for (const ref of lineageReferences(pinned.item.meta.source.ref)) {
    const exact = manifest.items.find((item: any) => item.registry === ref.registry && item.name === ref.item && item.version === ref.version && item.hash === ref.hash);
    if (!exact) continue;
    const root = join(references, `${ref.item}@${ref.version}`, 'registry');
    if (existsSync(root)) for (const line of referenceMarkup(root)) markup.add(line);
  }
  return markup;
}

/** Only declared dependencies on the exact pinned canonical section may compose. */
export function declaredSections(folder: string, clossys = CLOSSYS): Set<string> {
  const pinned = pinnedElement(folder, 'sections.', clossys);
  if (!pinned) return new Set();
  const doc = readSlot(clossys, 'designer', pinned.slot);
  const deps = pinned.item.meta.element.deps?.elements;
  if (!Array.isArray(deps)) return new Set();
  return new Set(deps.flatMap(dep => {
    if (typeof dep.slot !== 'string' || !dep.slot.startsWith('sections.') || typeof dep.element !== 'string'
      || typeof dep.hash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(dep.hash) || !doc.uses.includes(dep.slot)) return [];
    const target = pinnedElement(dep.element, 'sections.', clossys);
    return target && target.slot === dep.slot && target.version === dep.version && target.item.meta.source.hash === dep.hash ? [`../${dep.element}`] : [];
  }));
}

/**
 * The Studio app outside its sections and frames is held to the same rule. A renderer
 * (`studio/components`, `studio/lib`) runs the app and loads data, so it may import React, the Next
 * router, lucide icons, Node builtins, type-only modules, other `@clossys/*` engine packages as data and
 * anything inside the producer package; every component it renders comes from the Designer layer and
 * it renders no raw styled markup. A Studio frame inside `@clossys/designer-ui` (StudioAppFrame,
 * StudioPageFrame, the layout primitives, BlockViewerIframe) imports only React, lucide icons, type-only
 * modules and its own package's source, and styles only its page landmarks.
 */
type Kind = 'section' | 'frame' | 'renderer' | 'ui-frame';
const PRODUCER = resolve(STUDIO, '..');
const UI_SRC = resolve(STUDIO, '../../designer/ui/src');
const RENDERER_DIRS = ['components', 'lib'];
const RENDERER_RUNTIME = new Set(['react', 'next/navigation', 'lucide-react']);
const UI_FRAME_RUNTIME = new Set(['react', 'lucide-react']);
const UI_FRAMES = ['foundry/block-viewer-iframe.tsx', 'foundry/layout.tsx', 'foundry/studio-frames.tsx'];
// Every code extension the ref-verbatim gate accepts (`CODE_FILE`), so a `.jsx`/`.js`/`.mjs` file cannot sit outside the scan.
const isSource = (name: string) => CODE_FILE.test(name) && !name.endsWith('.d.ts') && !/\.test\.[cm]?[jt]sx?$/.test(name);
const sourceFiles = (folder: string) => readdirSync(folder).filter(isSource).map(name => join(folder, name));
// A section or frame folder is scanned to every depth: a subfolder file is still the folder's code.
const sourceFilesDeep = (folder: string): string[] => readdirSync(folder, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? sourceFilesDeep(join(folder, entry.name)) : isSource(entry.name) ? [join(folder, entry.name)] : []);
const MODULE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.mts', '.cts'];
const isFile = (path: string) => existsSync(path) && statSync(path).isFile();
/** The real path of the nearest existing ancestor of `path`, with the missing remainder appended. */
function realPathOf(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path ? path : join(realPathOf(parent), basename(path));
}

/**
 * Where a relative specifier imported by `file` lands on disk, as a real path (symlinks followed, from the
 * importing file's own real location): the module file a resolver would pick (exact, with a code extension,
 * a `.js`-style specifier's TypeScript source, or a directory's `index`), else the unresolved path under its
 * real existing ancestor. A directory carrying a `package.json` may point anywhere, so it resolves to nothing.
 */
export function resolveRelative(file: string, specifier: string): string | undefined {
  const base = resolve(dirname(realpathSync(file)), specifier);
  const stem = base.replace(/\.[cm]?jsx?$/, '');
  const files = [base, ...MODULE_EXTENSIONS.map(ext => base + ext), ...(stem === base ? [] : MODULE_EXTENSIONS.map(ext => stem + ext))];
  const found = files.find(isFile);
  if (found) return realpathSync(found);
  if (existsSync(base) && statSync(base).isDirectory()) {
    if (existsSync(join(base, 'package.json'))) return undefined;
    const index = MODULE_EXTENSIONS.map(ext => join(base, `index${ext}`)).find(isFile);
    if (index) return realpathSync(index);
  }
  return realPathOf(base);
}
const within = (file: string, specifier: string, root: string) => specifier.startsWith('.') && resolve(dirname(file), specifier).startsWith(root + sep);

function importAllowed(kind: Kind, file: string, folder: string, specifier: string, typeOnly: boolean, composes: ReadonlySet<string>): boolean {
  if (specifier === COMPONENT_LAYER) return true;
  if (kind === 'section' || kind === 'frame') {
    if (kind === 'frame' && typeOnly) return true;
    if (!specifier.startsWith('.')) return kind === 'frame' && FRAME_RUNTIME.has(specifier);
    // Every relative specifier is resolved to the real file it loads, which must stay inside the folder.
    const target = resolveRelative(file, specifier);
    if (!target) return false;
    const root = realpathSync(folder);
    if (target.startsWith(root + sep)) return true;
    // A declared sibling section or a frame's runtime module, named exactly as written from the folder's own top level.
    const atTop = dirname(realpathSync(file)) === root;
    return atTop && (composes.has(specifier) || (kind === 'frame' && FRAME_RUNTIME.has(specifier)));
  }
  if (composes.has(specifier)) return true;
  if (typeOnly) return true;
  if (kind === 'renderer') return RENDERER_RUNTIME.has(specifier) || isBuiltin(specifier) || (specifier.startsWith('@clossys/') && !specifier.startsWith(`${COMPONENT_LAYER}/`)) || within(file, specifier, PRODUCER);
  return UI_FRAME_RUNTIME.has(specifier) || within(file, specifier, UI_SRC);
}

/** Violations in one source file; `folder` bounds a section or frame's own imports. */
export function fileViolations(file: string, kind: Kind = 'section', composes: ReadonlySet<string> = new Set(), blockMarkup: ReadonlySet<string> = new Set(), folder = dirname(file), base = STUDIO): string[] {
  const violations: string[] = [];
  const label = relative(base, file);
  const landmarks = kind === 'frame' || kind === 'ui-frame';
  const text = readFileSync(file, 'utf8');
  // Imports come from the shared ds-only scanner: static imports and re-exports, and every `import(...)`
  // or `require(...)` call, which is held to the same rule as a static import (never type-only).
  for (const event of dsOnlyEvents(text, file)) {
    if (event.type === 'import' && !importAllowed(kind, file, folder, event.specifier, event.typeOnly, composes)) violations.push(`${label}: imports ${event.specifier}`);
    if (event.type === 'dynamic' && !importAllowed(kind, file, folder, event.specifier, false, composes)) violations.push(`${label}: imports ${event.specifier}`);
  }
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(ts, file));
  const markerTyped = source.text.includes('{ [marker: `data-clossys-${string}`]: string }');
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const value = classAttribute(node)?.initializer;
      const block = kind === 'frame' && !!value && ts.isStringLiteral(value) && blockMarkup.has(`${tag} ${value.text}`);
      if (/^[a-z]/.test(tag) && !(landmarks && FRAME_LANDMARKS.has(tag))) for (const attribute of node.attributes.properties) {
        if (block && ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'className') continue;
        // The generated provenance markers are typed `data-clossys-*` only, so their spread carries no styling.
        if (ts.isJsxSpreadAttribute(attribute) && attribute.expression.getText(source) === 'provenance' && markerTyped) continue;
        const attr = ts.isJsxAttribute(attribute) ? attribute.name.getText(source) : '{...spread}';
        if (attr === 'className' || attr === 'style' || attr === '{...spread}') violations.push(`${label}: <${tag} ${attr}>`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

export function dsOnlyViolations(folder: string, kind: 'section' | 'frame' = 'section', composes: ReadonlySet<string> = new Set(), blockMarkup: ReadonlySet<string> = new Set()): string[] {
  return sourceFilesDeep(folder).flatMap(file => fileViolations(file, kind, composes, blockMarkup, folder));
}

const RENDERER_FILES = RENDERER_DIRS.flatMap(dir => sourceFiles(join(STUDIO, dir))).map(file => relative(STUDIO, file)).sort();

describe('Studio sections are ds-only', () => {
  it('reads canonical pin lineage arrays and exact declared section dependencies without retired stores', () => {
    expect(lineageReferences(['[{"registry":"shadcn","item":"sidebar-07","version":"4.23.0","hash":"sha256:' + 'a'.repeat(64) + '"}]', 'not JSON', '{"version":5,"hash":"parent"}', '{"registry":"shadcn","item":"../escape","version":"4.23.0","hash":"sha256:' + 'a'.repeat(64) + '"}']))
      .toEqual([{ registry: 'shadcn', item: 'sidebar-07', version: '4.23.0', hash: `sha256:${'a'.repeat(64)}` }]);
    expect(frameBlockMarkup('studio-shell').size).toBeGreaterThan(0);
    // No placed Studio section composes another today; the positive case is a probe re-pin below.
    expect(FOLDERS.flatMap(folder => [...declaredSections(folder)])).toEqual([]);
    const probe = realpathSync(mkdtempSync(join(tmpdir(), 'ds-only-canonical-')));
    try {
      cpSync(join(CLOSSYS, 'agents/designer'), join(probe, 'agents/designer'), { recursive: true });
      expect(frameBlockMarkup('studio-shell', probe)).toEqual(frameBlockMarkup('studio-shell'));
      const frame = listSlots(probe, 'designer').find(entry => entry.id === 'frames.studio-shell')!;
      const pin = join(frame.dir, 'pin.json');
      writeFileSync(pin, JSON.stringify({ ...frame.pin, sha256: '0'.repeat(64) }));
      expect(frameBlockMarkup('studio-shell', probe)).toEqual(new Set());
      // Re-pin studio-home to declare the pinned studio-specimen; only that exact pin authorizes the import.
      const slots = listSlots(probe, 'designer');
      const home = slots.find(entry => entry.id === 'sections.studio.home')!, section = slots.find(entry => entry.id === 'sections.studio.specimen')!;
      const target = JSON.parse(readCandidate(probe, 'designer', section.id, section.pin!.candidate).bytes);
      const item = JSON.parse(readCandidate(probe, 'designer', home.id, home.pin!.candidate).bytes);
      item.meta.element.deps = { ...item.meta.element.deps, elements: [{ slot: section.id, element: 'studio-specimen', version: Number(CANDIDATE_NAME.exec(section.pin!.candidate)![2]), hash: target.meta.source.hash }] };
      const bytes = JSON.stringify(item, null, 2) + '\n';
      writeFileSync(join(home.dir, 'candidates', home.pin!.candidate), bytes);
      writeFileSync(join(home.dir, 'pin.json'), JSON.stringify({ ...home.pin, sha256: createHash('sha256').update(bytes).digest('hex') }));
      const slotDoc = JSON.parse(readFileSync(join(home.dir, 'slot.json'), 'utf8'));
      writeFileSync(join(home.dir, 'slot.json'), JSON.stringify({ ...slotDoc, uses: [...slotDoc.uses, section.id] }, null, 2) + '\n');
      expect(declaredSections('studio-home', probe)).toEqual(new Set(['../studio-specimen']));
      writeFileSync(join(section.dir, 'pin.json'), JSON.stringify({ ...section.pin, candidate: 'studio-specimen-v999.json' }));
      expect(declaredSections('studio-home', probe)).toEqual(new Set());
    } finally { rmSync(probe, { recursive: true, force: true }); }
  });

  it('covers every placed Studio section', () => {
    expect(FOLDERS).toEqual(['module-checks', 'module-outline', 'producer-pipeline-flow', 'producer-pipeline-legend', 'producer-system-empty', 'producer-team-strip', 'studio-checks', 'studio-contract', 'studio-history', 'studio-home', 'studio-leaf-header', 'studio-options', 'studio-page-header', 'studio-page-tabs', 'studio-references', 'studio-slot-groups', 'studio-specimen']);
  });

  it.each(FOLDERS)('%s imports only the Designer component layer and carries no raw styled markup', folder => {
    expect(dsOnlyViolations(join(VIEWS, folder), 'section', declaredSections(folder))).toEqual([]);
  });

  it('lets a section place a sibling section only when its pinned record declares it', () => {
    const probe = mkdtempSync(join(tmpdir(), 'ds-only-compose-'));
    try {
      writeFileSync(join(probe, 'Probe.tsx'), "import { SpecimenContent } from '../studio-specimen';\nimport { X } from '../studio-options';\nexport const A = () => <SpecimenContent />;\n");
      expect(dsOnlyViolations(probe, 'section', new Set(['../studio-specimen'])).map(line => line.split(': ').at(-1))).toEqual(['imports ../studio-options']);
      expect(dsOnlyViolations(probe).map(line => line.split(': ').at(-1))).toEqual(['imports ../studio-specimen', 'imports ../studio-options']);
      expect([...declaredSections('studio-home')]).toEqual([]);
    } finally { rmSync(probe, { recursive: true, force: true }); }
  });

  it('covers every placed Studio frame', () => {
    expect(FRAME_FOLDERS).toEqual(['studio-shell']);
  });

  it.each(FRAME_FOLDERS)('frame %s renders only Designer components inside its page landmarks', folder => {
    expect(dsOnlyViolations(join(FRAMES, folder), 'frame', new Set(), frameBlockMarkup(folder))).toEqual([]);
  });

  it('holds a frame to the section rule outside its landmarks and runtime imports', () => {
    const probe = mkdtempSync(join(tmpdir(), 'ds-only-frame-'));
    try {
      writeFileSync(join(probe, 'Probe.tsx'), "import { useState } from 'react';\nimport type { X } from '@other/types';\nimport { Y } from 'other-ui';\nexport const A = () => <main className=\"p-4\"><span className=\"truncate\" /><img className=\"size-7\" /></main>;\n");
      expect(dsOnlyViolations(probe, 'frame').map(line => line.split(': ').at(-1))).toEqual(['imports other-ui', '<span className>', '<img className>']);
      expect(dsOnlyViolations(probe).map(line => line.split(': ').at(-1))).toEqual(['imports react', 'imports @other/types', 'imports other-ui', '<main className>', '<span className>', '<img className>']);
      // The reference block's own markup passes in a frame only with its exact tag and className.
      const block = new Set(['span truncate', 'div grid flex-1']);
      expect(dsOnlyViolations(probe, 'frame', new Set(), block).map(line => line.split(': ').at(-1))).toEqual(['imports other-ui', '<img className>']);
      expect(dsOnlyViolations(probe, 'section', new Set(), block).map(line => line.split(': ').at(-1))).toContain('<span className>');
      // The shell's markup comes from sidebar-15 (the header) and its sidebar-07 part (the nav).
      expect(frameBlockMarkup('studio-shell').has('div flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground')).toBe(true);
      expect(frameBlockMarkup('studio-shell').has('div flex flex-1 items-center gap-2 px-3')).toBe(true);
    } finally { rmSync(probe, { recursive: true, force: true }); }
  });

  it('counts an outside import, an escaping relative import and raw styled markup', () => {
    const probe = mkdtempSync(join(tmpdir(), 'ds-only-'));
    try {
      writeFileSync(join(probe, 'Probe.tsx'), "import { X } from 'other-ui';\nimport { Y } from '../elsewhere';\nimport { Card } from '@clossys/designer-ui';\nexport const A = () => <div className=\"p-4\"><Card className=\"gap-2\"><X /><Y /></Card></div>;\n");
      expect(dsOnlyViolations(probe).map(line => line.split(': ').at(-1))).toEqual(['imports other-ui', 'imports ../elsewhere', '<div className>']);
    } finally { rmSync(probe, { recursive: true, force: true }); }
  });
  it('covers every Studio renderer and every Studio frame in the component layer', () => {
    expect(RENDERER_FILES).toEqual(['components/StudioInstalledPage.tsx', 'components/StudioPage.tsx', 'components/StudioProviders.tsx', 'components/StudioRouteMap.tsx',
      'lib/agents.ts', 'lib/cell-events.ts', 'lib/checks-copy.ts', 'lib/contract-copy.ts', 'lib/options-copy.ts', 'lib/pipeline-flow.ts', 'lib/producer-url.ts', 'lib/publisher-preview.ts',
      'lib/references-copy.ts', 'lib/shell-copy.ts', 'lib/slot-census-load.ts', 'lib/slot-census.ts', 'lib/slot-detail.ts', 'lib/studio-copy.ts', 'lib/studio-icons.tsx', 'lib/studio-report.ts',
      'lib/studio-route-map.ts', 'lib/studio-seed.ts']);
    for (const file of UI_FRAMES) expect(existsSync(join(UI_SRC, file)), file).toBe(true);
  });

  it.each(RENDERER_FILES)('renderer %s renders only Designer components and imports no outside UI', file => {
    expect(fileViolations(join(STUDIO, file), 'renderer')).toEqual([]);
  });

  it.each(UI_FRAMES)('component-layer frame %s styles only its page landmarks', file => {
    expect(fileViolations(join(UI_SRC, file), 'ui-frame', new Set(), new Set(), undefined, UI_SRC)).toEqual([]);
  });

  it('holds renderers and component-layer frames to their import and markup rules', () => {
    const probe = realpathSync(mkdtempSync(join(tmpdir(), 'ds-only-renderer-')));
    try {
      const file = join(probe, 'Probe.tsx');
      writeFileSync(file, "import { useState } from 'react';\nimport { readFileSync } from 'node:fs';\nimport type { T } from 'other-types';\nimport { RouterProvider } from 'react-aria-components';\nimport { map } from '@clossys/publisher/content-map';\nimport { cn } from './utils';\nexport const A = () => <main className=\"p-4\"><div style={{}} /><RouterProvider /></main>;\n");
      expect(fileViolations(file, 'renderer', new Set(), new Set(), undefined, probe)).toEqual(['Probe.tsx: imports react-aria-components', 'Probe.tsx: imports ./utils', 'Probe.tsx: <main className>', 'Probe.tsx: <div style>']);
      expect(fileViolations(file, 'ui-frame', new Set(), new Set(), undefined, probe)).toEqual(['Probe.tsx: imports node:fs', 'Probe.tsx: imports react-aria-components', 'Probe.tsx: imports @clossys/publisher/content-map', 'Probe.tsx: imports ./utils', 'Probe.tsx: <div style>']);
      } finally { rmSync(probe, { recursive: true, force: true }); }
    });

  it('scans .jsx/.js/.mjs files and holds require() and import() to the import rule (gate F2)', () => {
    const probe = realpathSync(mkdtempSync(join(tmpdir(), 'ds-only-js-')));
    try {
      writeFileSync(join(probe, 'Raw.jsx'), "export const A = () => <div className=\"p-4\" />;\n");
      writeFileSync(join(probe, 'Raw.js'), "export const B = () => <span style={{}} />;\n");
      writeFileSync(join(probe, 'load.mjs'), "const ui = require('other-ui');\nexport const C = () => import('../elsewhere');\nexport const D = () => import('@clossys/designer-ui');\n");
      writeFileSync(join(probe, 'Dyn.tsx'), "const x = require('react-aria-components');\nexport const E = async () => (await import('./local')).F;\n");
      expect(dsOnlyViolations(probe).map(line => { const [path, ...rest] = line.split(': '); return `${basename(path!)}: ${rest.join(': ')}`; }).sort()).toEqual([
        'Dyn.tsx: imports react-aria-components', 'Raw.js: <span style>', 'Raw.jsx: <div className>', 'load.mjs: imports ../elsewhere', 'load.mjs: imports other-ui',
      ]);
      expect(fileViolations(join(probe, 'Dyn.tsx'), 'renderer', new Set(), new Set(), undefined, probe)).toEqual(['Dyn.tsx: imports react-aria-components', 'Dyn.tsx: imports ./local']);
    } finally { rmSync(probe, { recursive: true, force: true }); }
  });

  it('resolves every relative import to its real path inside the folder and scans subfolders (gate R2)', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'ds-only-contain-')));
    try {
      const folder = join(root, 'sections/probe');
      mkdirSync(join(folder, 'sub'), { recursive: true });
      mkdirSync(join(root, 'sections/studio-options'), { recursive: true });
      mkdirSync(join(root, 'components'), { recursive: true });
      writeFileSync(join(root, 'sections/studio-options/index.tsx'), 'export const X = 1;\n');
      writeFileSync(join(root, 'components/X.tsx'), 'export const X = 1;\n');
      symlinkSync(join(root, 'components/X.tsx'), join(folder, 'linked.tsx'));
      writeFileSync(join(folder, 'own.tsx'), 'export const Own = 1;\n');
      writeFileSync(join(folder, 'index.tsx'), [
        "import { X } from './../studio-options';",
        "import { Y } from './../../components/X';",
        "import { Z } from './sub';",
        "import { L } from './linked';",
        "import { Own } from './own';",
        "import { Again } from './sub/../own';",
        'export const A = () => <Z />;',
      ].join('\n') + '\n');
      writeFileSync(join(folder, 'sub/index.tsx'), "import { Own } from '../own';\nimport { Out } from '../../studio-options';\nexport const Z = () => <div className=\"p-4\" />;\n");
      expect(dsOnlyViolations(folder).map(line => line.split(': ').at(-1)).sort()).toEqual([
        '<div className>', 'imports ../../studio-options', 'imports ./../../components/X', 'imports ./../studio-options', 'imports ./linked',
      ]);
      expect(dsOnlyViolations(folder).filter(line => line.endsWith('<div className>')).map(line => resolve(STUDIO, line.split(': ')[0]!))).toEqual([join(folder, 'sub/index.tsx')]);
      expect(dsOnlyViolations(folder, 'frame').map(line => line.split(': ').at(-1)).sort()).toEqual([
        '<div className>', 'imports ../../studio-options', 'imports ./../../components/X', 'imports ./../studio-options', 'imports ./linked',
      ]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('admits only the marker-typed provenance spread on raw markup', () => {
    const probe = mkdtempSync(join(tmpdir(), 'ds-only-'));
    try {
      const typed = "export default function A({ x, ...provenance }: { x: string } & { [marker: `data-clossys-${string}`]: string }) { return <section {...provenance} aria-label={x} />; }\n";
      writeFileSync(join(probe, 'Probe.tsx'), typed);
      expect(dsOnlyViolations(probe)).toEqual([]);
      writeFileSync(join(probe, 'Probe.tsx'), typed.replace(/provenance/g, 'rest'));
      expect(dsOnlyViolations(probe).map(line => line.split(': ').at(-1))).toEqual(['<section {...spread}>']);
      writeFileSync(join(probe, 'Probe.tsx'), "export default function A({ x, ...provenance }: { x: string; className?: string }) { return <section {...provenance} aria-label={x} />; }\n");
      expect(dsOnlyViolations(probe).map(line => line.split(': ').at(-1))).toEqual(['<section {...spread}>']);
    } finally { rmSync(probe, { recursive: true, force: true }); }
  });
});
