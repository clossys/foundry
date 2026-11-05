import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const here = new URL('./', import.meta.url);
const sourceRoot = new URL('studio-home-stock-source/', here);
const read = path => readFileSync(new URL(path, sourceRoot));
const manifest = JSON.parse(read('provenance.json'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const source = readFileSync(new URL(manifest.emitted.file, here), 'utf8');
const parse = text => ts.createSourceFile('part.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function jsx(node) {
  if (ts.isParenthesizedExpression(node)) return jsx(node.expression);
  if (ts.isJsxText(node)) return node.text.trim() ? ['text', node.text.replace(/\s+/g, ' ').trim()] : undefined;
  if (ts.isJsxExpression(node)) return ['binding', node.expression?.getText()];
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  assert.ok(ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening));
  return [opening.tagName.getText(), opening.attributes.properties.map(attr => {
    assert.ok(ts.isJsxAttribute(attr), 'spreads are not an allowed stock adaptation');
    return [attr.name.getText(), attr.initializer && (ts.isStringLiteral(attr.initializer) ? ['literal', attr.initializer.text] : jsx(attr.initializer))];
  }), ts.isJsxElement(node) ? node.children.map(jsx).filter(Boolean) : []];
}

function bind(part, text) {
  const replace = (from, to) => { assert.equal(text.split(from).length, 2, `${part.export}: unique source binding ${from}`); text = text.replace(from, to); };
  if (part.export === 'HomeStockGrid') return text + '{children}</div>';
  if (part.export === 'HomeStockCensusCard') {
    replace('<Card className="@container/card">', '<Card className="@container/card" data-home-agent={props.id} data-census-state={props.state}>');
    replace('Total Revenue', '{props.label}');
    replace('className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">', 'className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl" aria-label={props.totalLabel}>');
    replace('$1,250.00', '{props.total}');
    replace('<Badge variant="outline">', '<Badge variant="outline" aria-label={props.candidatesLabel}>');
    replace('+12.5%', '{props.candidates}');
    replace('Trending up this month', '{props.pinnedLabel}');
    replace('Visitors for the last 6 months', '{props.detail}');
    assert.equal((text.match(/<IconPlaceholder[\s\S]*?\/>/g) ?? []).length, 2);
    text = text.replace(/<IconPlaceholder[\s\S]*?\/>/g, '{props.icon}');
  } else {
    replace(part.export === 'HomeStockHeader' ? '<CardTitle>Default Card' : '<CardTitle>Meeting Notes', part.export === 'HomeStockHeader' ? '<CardTitle id={props.id} role="heading" aria-level={1}>{props.title}' : '<CardTitle>{props.title}');
    replace(part.export === 'HomeStockHeader' ? 'This card uses the default size variant.' : 'Transcript from the meeting with the client.', '{props.description}');
    if (part.export === 'HomeStockNeedsHeader') {
      replace('<Button variant="outline" size="sm">', '<Button variant="outline" size="sm" aria-label={props.closeLabel} onPress={props.onClose}>');
      assert.equal((text.match(/<IconPlaceholder[\s\S]*?\/>/g) ?? []).length, 1);
      text = text.replace(/<IconPlaceholder[\s\S]*?\/>/, '{props.closeIcon}');
      replace('Transcribe', '{props.closeLabel}');
    }
  }
  return text;
}

test('Home stock parts retain exact upstream files, byte ranges, license and complete emitted coverage', () => {
  assert.equal(manifest.upstream.commit, 'b8d7baa15b1dca5716f13153e63795fc3d741f6b');
  const blobs = ['4ee21e780a053f7e5535555afb28f78dcd9fa35b', 'e5185d544ffb67391a33ec81f5eb93f1839202ea', 'fad4d887a681dd49233e5ed01ee2c7a1513089a0'];
  for (const [i, file] of manifest.files.entries()) {
    const bytes = read(file.file);
    assert.equal(bytes.length, file.bytes);
    assert.equal(sha(bytes), file.sha256);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), blobs[i]);
    assert.equal(file.gitBlob, blobs[i]);
  }
  assert.equal(sha(source), manifest.emitted.sha256);
  assert.equal(sha(readFileSync(new URL('../../../' + manifest.consumer.file, here))), manifest.consumer.sha256);
  const actual = parse(source);
  const functions = actual.statements.filter(ts.isFunctionDeclaration);
  assert.deepEqual(functions.map(fn => fn.name.text), manifest.parts.map(part => part.export));
  assert.deepEqual(actual.statements.filter(ts.isImportDeclaration).map(node => node.moduleSpecifier.text), ['react', './badge', './button', './card']);
  assert.equal(actual.statements.length, functions.length + 4, 'no uncovered emitted statements');
  for (const part of manifest.parts) {
    const bytes = read(part.file), lines = bytes.toString('utf8').split(/(?<=\n)/);
    assert.equal(Buffer.byteLength(lines.slice(0, part.lines[0] - 1).join('')), part.startByte);
    assert.equal(Buffer.byteLength(lines.slice(0, part.lines[1]).join('')), part.endByte);
    const range = bytes.subarray(part.startByte, part.endByte);
    assert.equal(sha(range), part.sha256);
    const expected = parse('const part = (' + bind(part, range.toString('utf8')) + ');');
    assert.equal(expected.parseDiagnostics.length, 0);
    const fn = functions.find(fn => fn.name.text === part.export);
    assert.equal(fn.body.statements.length, 1, 'each stock part only returns its measured JSX');
    assert.deepEqual(jsx(fn.body.statements[0].expression), jsx(expected.statements[0].declarationList.declarations[0].initializer), part.export);
  }
  assert.equal(manifest.nativeQualification.state, 'unqualified');
  assert.equal(manifest.nativeQualification.pinChanged, false);
  assert.ok(readFileSync(new URL('src/index.ts', here), 'utf8').includes('export * from "./foundry/studio-home-stock"'));
  const frame = readFileSync(new URL('../../producer/studio/frames/studio-shell/index.tsx', here), 'utf8');
  assert.ok(frame.includes('@container/main'));
});
