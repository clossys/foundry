import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

// R2F-03: Home's stock parts are the pinned components.studio.home-grid composition of stock shadcn
// parts, qualified natively by the ref-verbatim composition check; the earlier exact-range extraction
// (studio-home-stock-source/) is superseded and kept only as the vendored reference record.
const here = new URL('./', import.meta.url);
const designer = new URL('../../../clossys/agents/designer/', here);
const pinned = slot => {
  const pin = JSON.parse(readFileSync(new URL(`${slot}/pin.json`, designer), 'utf8'));
  return JSON.parse(readFileSync(new URL(`${slot}/candidates/${pin.candidate}`, designer), 'utf8'));
};
const STOCK = ['components.badge', 'components.button', 'components.card', 'components.field'];

test('Home stock parts are the pinned composition of stock parts, installed byte for byte', () => {
  const candidate = pinned('components.studio.home-grid');
  assert.equal(candidate.meta.source.kind, 'composition');
  assert.deepEqual(candidate.meta.source.parts.map(part => part.slot), STOCK);
  assert.equal(candidate.meta.refVerbatim, undefined);
  const file = candidate.files.find(entry => entry.path === 'studio-home-stock.tsx');
  const source = readFileSync(new URL('src/components/studio-home-stock.tsx', here), 'utf8');
  assert.equal(source, file.content);
  const actual = ts.createSourceFile('part.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = actual.statements.filter(ts.isImportDeclaration).map(node => node.moduleSpecifier.text);
  assert.deepEqual(imports, ['@/components/ui/badge', '@/components/ui/button', '@/components/ui/card', '@/components/ui/field']);
  const functions = actual.statements.filter(ts.isFunctionDeclaration);
  assert.deepEqual(functions.map(fn => fn.name.text), ['HomeStockGrid', 'HomeStockCensusCard', 'HomeStockHeader', 'HomeStockNeedsHeader']);
  assert.equal(actual.statements.length, functions.length + imports.length, 'no uncovered emitted statements');
  for (const fn of functions) assert.equal(fn.body.statements.length, 1, `${fn.name.text} only returns stock JSX`);
  assert.doesNotMatch(source, /className|style=|useState|useEffect/);
  const tags = new Set([...source.matchAll(/<([A-Za-z][A-Za-z0-9]*)/g)].map(match => match[1]));
  assert.ok([...tags].every(tag => /^[A-Z]/.test(tag)), `only stock components: ${[...tags].join(', ')}`);
  assert.ok(readFileSync(new URL('src/index.ts', here), 'utf8').includes('export * from "./foundry/studio-home-stock"'));
});

test('Home section is the pinned composition of the same stock parts', () => {
  const candidate = pinned('sections.studio.home');
  assert.equal(candidate.meta.source.kind, 'composition');
  assert.deepEqual(candidate.meta.source.parts.map(part => part.slot), STOCK);
  const file = candidate.files.find(entry => entry.path === 'index.tsx');
  assert.equal(readFileSync(new URL('../../producer/studio/sections/studio-home/index.tsx', here), 'utf8'), file.content);
});
