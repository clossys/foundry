import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { listSlots, readCandidate, readSlot } from '../records/slots.js';
import { CANDIDATE_NAME, validateCandidate, validateSlotDoc } from '../records/slot-model/index.js';

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
const VIEWS = join(STUDIO, 'sections');
const FRAMES = join(STUDIO, 'frames');
const folders = (root: string) => readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
const FOLDERS = folders(VIEWS);
const FRAME_FOLDERS = folders(FRAMES);
const COMPONENT_LAYER = '@clossys/designer-ui';
const FRAME_RUNTIME = new Set(['react', 'next/navigation', 'lucide-react', '../../components/StudioProviders', '../../lib/studio-icons']);
const FRAME_LANDMARKS = new Set(['header', 'main', 'aside']);
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

export function dsOnlyViolations(folder: string, kind: 'section' | 'frame' = 'section', composes: ReadonlySet<string> = new Set(), blockMarkup: ReadonlySet<string> = new Set()): string[] {
  const violations: string[] = [];
  for (const name of readdirSync(folder)) {
    if (!/\.tsx?$/.test(name)) continue;
    const file = join(folder, name);
    const label = relative(STUDIO, file);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
      if (specifier !== undefined) {
        const inside = specifier.startsWith('./') && !resolve(folder, specifier).slice(folder.length + 1).includes(sep);
        const typeOnly = ts.isImportDeclaration(node) && !!node.importClause?.isTypeOnly;
        const runtime = kind === 'frame' && (FRAME_RUNTIME.has(specifier) || typeOnly);
        if (specifier !== COMPONENT_LAYER && !inside && !runtime && !composes.has(specifier)) violations.push(`${label}: imports ${specifier}`);
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        const value = classAttribute(node)?.initializer;
        const block = kind === 'frame' && !!value && ts.isStringLiteral(value) && blockMarkup.has(`${tag} ${value.text}`);
        if (/^[a-z]/.test(tag) && !(kind === 'frame' && FRAME_LANDMARKS.has(tag))) for (const attribute of node.attributes.properties) {
          if (block && ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'className') continue;
          const attr = ts.isJsxAttribute(attribute) ? attribute.name.getText(source) : '{...spread}';
          if (attr === 'className' || attr === 'style' || attr === '{...spread}') violations.push(`${label}: <${tag} ${attr}>`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return violations;
}

describe('Studio sections are ds-only', () => {
  it('reads canonical pin lineage arrays and exact declared section dependencies without retired stores', () => {
    expect(lineageReferences(['[{"registry":"shadcn","item":"sidebar-07","version":"4.23.0","hash":"sha256:' + 'a'.repeat(64) + '"}]', 'not JSON', '{"version":5,"hash":"parent"}', '{"registry":"shadcn","item":"../escape","version":"4.23.0","hash":"sha256:' + 'a'.repeat(64) + '"}']))
      .toEqual([{ registry: 'shadcn', item: 'sidebar-07', version: '4.23.0', hash: `sha256:${'a'.repeat(64)}` }]);
    expect(frameBlockMarkup('studio-shell').size).toBeGreaterThan(0);
    expect(declaredSections('studio-agent-gallery')).toEqual(new Set(['../studio-specimen']));
    const probe = realpathSync(mkdtempSync(join(tmpdir(), 'ds-only-canonical-')));
    try {
      cpSync(join(CLOSSYS, 'agents/designer'), join(probe, 'agents/designer'), { recursive: true });
      expect(frameBlockMarkup('studio-shell', probe)).toEqual(frameBlockMarkup('studio-shell'));
      const frame = listSlots(probe, 'designer').find(entry => entry.id === 'frames.studio-shell')!;
      const pin = join(frame.dir, 'pin.json');
      writeFileSync(pin, JSON.stringify({ ...frame.pin, sha256: '0'.repeat(64) }));
      expect(frameBlockMarkup('studio-shell', probe)).toEqual(new Set());
      const section = listSlots(probe, 'designer').find(entry => entry.id === 'sections.studio.specimen')!;
      writeFileSync(join(section.dir, 'pin.json'), JSON.stringify({ ...section.pin, candidate: 'studio-specimen-v999.json' }));
      expect(declaredSections('studio-agent-gallery', probe)).toEqual(new Set());
    } finally { rmSync(probe, { recursive: true, force: true }); }
  });

  it('covers every placed Studio section', () => {
    expect(FOLDERS).toEqual(['module-checks', 'module-explorer', 'module-outline', 'studio-agent-gallery', 'studio-checks', 'studio-contract', 'studio-history', 'studio-home', 'studio-leaf-header', 'studio-options', 'studio-publications', 'studio-references', 'studio-specimen']);
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
});
