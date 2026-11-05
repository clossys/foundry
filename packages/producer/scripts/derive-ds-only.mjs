#!/usr/bin/env node
/**
 * derive-ds-only — the next candidate of a pinned Studio frame or section, composed of Designer
 * components without restyling them (R-DS-ONLY), generated from the pinned candidate, never typed.
 *
 * The pinned item's code files are read with the TypeScript AST and only the attributes the
 * ds-only rule refuses are dropped (the same rule `designer-views.ds-only.test.ts` applies):
 *   - `style` and `dangerouslySetInnerHTML` on any element;
 *   - a `className` on a Designer component, except the caller's own `className={className}`
 *     (H-PROPS), an icon glyph sized with one stock `size-N` class, or the exact
 *     `<Tag> <className>` pair the reference blocks of the pinned lineage carry.
 * Raw-element markup is left to the rule (it is reported, not rewritten). Every other byte of every
 * file is kept, so the candidate is the pinned item with restyle hunks removed: variants and tokens only.
 *
 * Lineage is preserved and extended: `meta.source.ref` keeps every reference row of the pinned item
 * and appends the parent (`{ version, hash }`). `--lineage registry/item@version[,...]` replaces the
 * reference rows (not the parent) with exact rows of the trusted references manifest, for a pinned
 * item whose recorded source is not a trusted registry; `--frame-markers` makes a frame's root carry
 * the generated `data-clossys-*` provenance props it is given. A `composition` keeps its parts, and
 * `meta.element.deps.elements` is recomputed from the current pins (derive-element-deps).
 *
 *   node scripts/derive-ds-only.mjs <slot> [--lineage ...] [--frame-markers] [--by <unit>] [--write] [--root <repo>]
 *
 * Without `--write` it prints the attributes it would drop. Nothing is pinned here; `clossys pin` decides.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pinned } from './check-generated-derived.mjs';
import { computedElementDeps } from './derive-element-deps.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('typescript');
const CODE = /\.(?:tsx|jsx)$/;
const MARKER_TYPE = '{ [marker: `data-clossys-${string}`]: string }';

const filesUnder = root => readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? filesUnder(join(root, entry.name)) : [join(root, entry.name)]);
const classAttribute = node => node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText() === 'className');

/** `<tag> <className>` pairs of the raw and component elements in one reference block's source files. */
function referenceMarkup(root, pairs = new Set()) {
  for (const file of filesUnder(root).filter(path => path.endsWith('.tsx'))) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = node => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const value = classAttribute(node)?.initializer;
        if (value && ts.isStringLiteral(value)) pairs.add(`${node.tagName.getText(source)} ${value.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return pairs;
}

const parseRefs = refs => (Array.isArray(refs) ? refs : []).flatMap(value => {
  if (typeof value !== 'string' || !value.startsWith('{')) return [];
  try { return [JSON.parse(value)]; } catch { return []; }
});

/** The reference markup the ds-only rule admits for these lineage rows: exact shadcn manifest rows only. */
export function lineageMarkup(refs, references) {
  const manifest = JSON.parse(readFileSync(join(references, 'manifest.json'), 'utf8'));
  const pairs = new Set();
  for (const ref of parseRefs(refs)) {
    if (ref.registry !== 'shadcn' || !manifest.items.some(row => row.registry === ref.registry && row.name === ref.item && row.version === ref.version && row.hash === ref.hash)) continue;
    const root = join(references, 'shadcn', `${ref.item}@${ref.version}`, 'registry');
    if (existsSync(root)) referenceMarkup(root, pairs);
  }
  return pairs;
}

const iconSize = (tag, value) => /^(?:[A-Z][A-Za-z0-9]*)?Icon$/.test(tag) && !!value && ts.isStringLiteral(value) && /^size-(?:[0-9]+(?:\.5)?)$/.test(value.text);
const passthrough = attribute => !!attribute.initializer && ts.isJsxExpression(attribute.initializer) && !!attribute.initializer.expression
  && ts.isIdentifier(attribute.initializer.expression) && attribute.initializer.expression.text === 'className';

/** The restyle attributes of one code file and the file with them removed. */
export function stripRestyles(path, text, blockMarkup) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const drops = [];
  const visit = node => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const value = classAttribute(node)?.initializer;
      const block = !!value && ts.isStringLiteral(value) && blockMarkup.has(`${tag} ${value.text}`);
      const raw = /^[a-z][a-z0-9-]*$/.test(tag);
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue;
        const name = attribute.name.getText(source);
        const restyle = name === 'style' || name === 'dangerouslySetInnerHTML'
          || (!raw && name === 'className' && !(block || passthrough(attribute) || iconSize(tag, value)));
        if (restyle) drops.push({ start: attribute.getFullStart(), end: attribute.getEnd(), label: `<${tag} ${name}>`, line: source.getLineAndCharacterOfPosition(attribute.getStart(source)).line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  let out = text;
  for (const drop of [...drops].sort((a, b) => b.start - a.start)) out = out.slice(0, drop.start) + out.slice(drop.end);
  return { text: out, drops };
}

/** A frame's default export receives the generated provenance props and puts them on its root. */
export function markFrameRoot(text) {
  const head = /export default function (\w+)\(props: (\w+)\) \{\n/;
  const match = head.exec(text);
  if (!match) throw new Error('frame markers: no `export default function <Name>(props: <Props>)` to mark');
  const [line, name, type] = match;
  let body = text.slice(match.index + line.length);
  const ret = /^(\s*)return (<[A-Z][\s\S]*?)(;\n\})/m.exec(body);
  if (!ret) throw new Error('frame markers: no single returned root element');
  body = body.slice(0, ret.index) + `${ret[1]}return <div {...provenance}>${ret[2]}</div>${ret[3]}` + body.slice(ret.index + ret[0].length);
  const opener = `export default function ${name}({ ...given }: ${type} & ${MARKER_TYPE}) {\n`
    + `  const provenance = Object.fromEntries(Object.entries(given).filter(([key]) => key.startsWith('data-clossys-'))) as ${MARKER_TYPE};\n`
    + `  const props = Object.fromEntries(Object.entries(given).filter(([key]) => !key.startsWith('data-clossys-'))) as unknown as ${type};\n`;
  return text.slice(0, match.index) + opener + body;
}

const contentHash = files => `sha256:${createHash('sha256').update(JSON.stringify(files.map(file => [file.path, file.content]))).digest('hex')}`;

/** Exact trusted manifest rows for `registry/item@version` names. */
export function manifestRows(names, references) {
  const manifest = JSON.parse(readFileSync(join(references, 'manifest.json'), 'utf8'));
  return names.map(name => {
    const m = /^([^/]+)\/(.+)@([^@]+)$/.exec(name);
    if (!m || !manifest.registries?.[m[1]]) throw new Error(`--lineage ${name}: not a trusted registry row`);
    const row = manifest.items.find(item => item.registry === m[1] && item.name === m[2] && item.version === m[3]);
    if (!row) throw new Error(`--lineage ${name}: not in references/manifest.json`);
    return JSON.stringify({ registry: row.registry, item: row.name, version: row.version, hash: row.hash, ...(row.url || row.sourceUrl ? { url: row.url ?? row.sourceUrl } : {}) });
  });
}

/** The next candidate item for a pinned slot. */
export function nextItem(item, { lineage, frameMarkers, by, references, at = new Date().toISOString() }) {
  const parentVersion = Number(/-v(\d+)\.json$/.exec(item.__candidate)?.[1]);
  const kept = (item.meta.source.ref ?? []).filter(ref => { try { return !!JSON.parse(ref).registry; } catch { return false; } });
  const refs = lineage ? manifestRows(lineage, references) : kept;
  const markup = lineageMarkup(refs, references);
  const drops = [];
  const files = item.files.map(file => {
    if (!CODE.test(file.path)) return file;
    const stripped = stripRestyles(file.path, file.content, markup);
    drops.push(...stripped.drops.map(drop => ({ file: file.path, ...drop })));
    const content = frameMarkers && file.path === 'index.tsx' ? markFrameRoot(stripped.text) : stripped.text;
    return { ...file, content };
  });
  const next = structuredClone(item);
  delete next.__candidate;
  next.files = files;
  const source = next.meta.source;
  if (source.kind !== 'composition') {
    source.kind = 'derived';
    source.ref = [...refs, JSON.stringify({ version: parentVersion, hash: item.meta.source.hash })];
    source.hash = contentHash(files);
  }
  const element = next.meta.element;
  element.creator = { agent: 'claude', model: 'claude-opus-5-5', by };
  element.createdAt = at;
  element.reason = `${by} (R-DS-ONLY): v${parentVersion} with the restyle attributes the ds-only rule refuses removed (${drops.length}: ${[...new Set(drops.map(drop => drop.label))].join(', ') || 'none'}); Designer components keep their variants and theme tokens only.`
    + (lineage ? ` Lineage re-derived from the trusted reference rows ${lineage.join(', ')}.` : '')
    + (frameMarkers ? ' The frame root carries the generated data-clossys-* provenance props it is given.' : '');
  return { next, drops };
}

async function main(argv) {
  const slot = argv[0];
  if (!slot || slot.startsWith('--')) { console.error('usage: derive-ds-only.mjs <slot> [--lineage a,b] [--frame-markers] [--by <unit>] [--write] [--root <repo>]'); return 2; }
  const flag = name => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined; };
  const root = resolve(flag('--root') ?? join(here, '..', '..', '..'));
  const clossys = join(root, 'clossys'), references = join(root, 'packages/designer/references');
  const entry = pinned(clossys, 'designer', slot);
  if (!entry?.item) { console.error(`derive-ds-only: ${slot} has no intact pin`); return 2; }
  const { next, drops } = nextItem({ ...entry.item, __candidate: entry.candidate }, {
    lineage: flag('--lineage')?.split(','), frameMarkers: argv.includes('--frame-markers'), by: flag('--by') ?? 'DS-ONLY', references,
  });
  // The sections it composes are re-read from the current pins, so a re-pinned dependency is declared at its new version.
  const computed = computedElementDeps(clossys, slot);
  if (computed && (computed.deps.length || next.meta.element.deps?.elements)) next.meta.element.deps = { ...(next.meta.element.deps ?? {}), elements: computed.deps };
  for (const drop of drops) console.log(`derive-ds-only: ${slot} ${drop.file}:${drop.line} drops ${drop.label}`);
  if (!argv.includes('--write')) return 0;
  const { writeCandidate } = await import(pathToFileURL(join(root, 'packages/producer/dist/records/index.js')).href);
  const out = writeCandidate(clossys, 'designer', slot, next.name, next);
  console.log(`derive-ds-only: wrote ${slot}/${out.name} (from ${entry.candidate}); pin it with clossys pin designer/${slot} ${out.name.replace(/\.json$/, '')}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = 2; });
