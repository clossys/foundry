import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

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
 * when, its pinned library record declares that section in `deps.elements`: composition the record
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

type Ref = { registry: string; item: string; version: string };

/** The raw markup of the reference blocks a placed frame's pinned record names in `lineage.source` and `lineage.parts`. */
export function frameBlockMarkup(folder: string, clossys = CLOSSYS, references = REFERENCES): Set<string> {
  const pins = (JSON.parse(readFileSync(join(clossys, 'selection.json'), 'utf8')) as { pins: Record<string, { element: string; version: number }> }).pins;
  const slot = Object.keys(pins).find(key => key.startsWith('frames.') && pins[key]!.element === folder);
  if (!slot) return new Set();
  const pin = pins[slot]!;
  const record = JSON.parse(readFileSync(join(clossys, 'library', slot, pin.element, `v${pin.version}`, 'element.json'), 'utf8')) as { lineage?: { source?: Ref; parts?: readonly Ref[] } };
  const markup = new Set<string>();
  for (const ref of [record.lineage?.source, ...(record.lineage?.parts ?? [])]) {
    if (ref?.registry !== 'shadcn') continue;
    const root = join(references, `${ref.item}@${ref.version}`, 'registry');
    if (existsSync(root)) for (const line of referenceMarkup(root)) markup.add(line);
  }
  return markup;
}

/** Sibling section folders a placed section's pinned record declares it composes (`deps.elements`). */
export function declaredSections(folder: string, clossys = CLOSSYS): Set<string> {
  const pins = (JSON.parse(readFileSync(join(clossys, 'selection.json'), 'utf8')) as { pins: Record<string, { element: string; version: number }> }).pins;
  const slot = Object.keys(pins).find(key => key.startsWith('sections.') && pins[key]!.element === folder);
  if (!slot) return new Set();
  const pin = pins[slot]!;
  const record = JSON.parse(readFileSync(join(clossys, 'library', slot, pin.element, `v${pin.version}`, 'element.json'), 'utf8')) as { deps?: { elements?: { slot: string; element: string }[] } };
  return new Set((record.deps?.elements ?? []).filter(dep => dep.slot.startsWith('sections.')).map(dep => `../${dep.element}`));
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
