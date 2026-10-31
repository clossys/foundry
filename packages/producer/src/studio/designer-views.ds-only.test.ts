import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * AMEND-1 ds-only check for the PROOF-2 Designer views: each view folder imports
 * components only from Designer's component layer (`@clossys/designer-ui`) or
 * from inside its own folder, and renders no raw styled markup (a lowercase
 * element carrying `className` or `style`).
 */
const VIEWS = resolve(dirname(fileURLToPath(import.meta.url)), '../../studio/views');
const FOLDERS = ['designer-gallery', 'designer-detail'];
const COMPONENT_LAYER = '@clossys/designer-ui';

export function dsOnlyViolations(folder: string): string[] {
  const violations: string[] = [];
  for (const name of readdirSync(folder)) {
    if (!/\.tsx?$/.test(name)) continue;
    const file = join(folder, name);
    const label = relative(VIEWS, file);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
      if (specifier !== undefined) {
        const inside = specifier.startsWith('./') && !resolve(folder, specifier).slice(folder.length + 1).includes(sep);
        if (specifier !== COMPONENT_LAYER && !inside) violations.push(`${label}: imports ${specifier}`);
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        if (/^[a-z]/.test(tag)) for (const attribute of node.attributes.properties) {
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

describe('PROOF-2 Designer views are ds-only', () => {
  it.each(FOLDERS)('%s imports only the Designer component layer and carries no raw styled markup', folder => {
    expect(dsOnlyViolations(join(VIEWS, folder))).toEqual([]);
  });

  it('counts an outside import, an escaping relative import and raw styled markup', () => {
    const probe = mkdtempSync(join(tmpdir(), 'ds-only-'));
    try {
      writeFileSync(join(probe, 'Probe.tsx'), "import { X } from 'other-ui';\nimport { Y } from '../elsewhere';\nimport { Card } from '@clossys/designer-ui';\nexport const A = () => <div className=\"p-4\"><Card className=\"gap-2\"><X /><Y /></Card></div>;\n");
      expect(dsOnlyViolations(probe).map(line => line.split(': ').at(-1))).toEqual(['imports other-ui', 'imports ../elsewhere', '<div className>']);
    } finally { rmSync(probe, { recursive: true, force: true }); }
  });
});
