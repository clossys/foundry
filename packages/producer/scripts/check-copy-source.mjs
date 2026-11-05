#!/usr/bin/env node
/**
 * check-copy-source: every user-visible Studio string comes from a Writer key, and every label from
 * the one label resolver. A sibling of check-studio-template; each rule covers a whole class:
 *
 *   jsx       no JSX text node, and no string literal in a copy attribute (`aria-label`, `title`,
 *             `placeholder`, `label`, `description`, `*Label`), in studio/** or in the Studio frames
 *             Designer ships (designer-ui foundry `studio-*.tsx`). A literal inside a JSX
 *             expression (`{open ? 'Copied' : 'Copy prompt'}`) counts as text.
 *   prop      no string literal that reads as copy (a capital letter or a space) in a copy-named
 *             object property (`label`, `title`, `name`, `description`, ...) in studio/** or in the
 *             server rows Studio shows (src/server/slot-detail.ts and the specimen projections).
 *   record    no literal `label` or `prompt` field in a pinned Publisher page record or publication:
 *             a record holds Writer keys (`studio.<key>`) only.
 *   label     no function that turns an id into a label (humanize, sentence, a capitalised first
 *             letter, `label: id`) outside the one resolver, src/records/slot-labels.ts (read by
 *             src/publish/expand-tabs.ts into the content-map projection).
 *
 * Usage: node packages/producer/scripts/check-copy-source.mjs [--rev <git rev>]
 * With --rev the files are read from that commit (to prove the check fails before a fix).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const revAt = process.argv.indexOf('--rev');
const rev = revAt > 0 ? process.argv[revAt + 1] : undefined;

const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const read = path => {
  if (rev) { try { return git('show', `${rev}:${path}`); } catch { return undefined; } }
  const file = join(repo, path);
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
};
/** Every tracked-or-present file under a directory, repository-relative. */
function walk(dir) {
  if (rev) {
    let out = '';
    try { out = git('ls-tree', '-r', '--name-only', rev, '--', dir); } catch { return []; }
    return out.split('\n').filter(Boolean);
  }
  const root = join(repo, dir);
  if (!existsSync(root)) return [];
  const files = [];
  const visit = (abs, rel) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      if (entry.isDirectory()) visit(join(abs, entry.name), `${rel}/${entry.name}`);
      else files.push(`${rel}/${entry.name}`);
    }
  };
  visit(root, dir);
  return files.sort();
}

const STUDIO = 'packages/producer/studio';
const SERVER = 'packages/producer/src/server';
const RESOLVER = new Set(['packages/producer/src/records/slot-labels.ts']);
const TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const findings = [];
const fail = (rule, where, message) => findings.push({ rule, where, message });

/** Studio sources that render or feed what renders: not tests, checks or generated output. */
const studioSources = walk(STUDIO).filter(file => /\.(?:tsx?|mjs)$/.test(file) && !TEST.test(file) && !file.endsWith('.d.ts')
  && !file.startsWith(`${STUDIO}/checks/`) && !file.startsWith(`${STUDIO}/generated/`));
const designerFrames = walk('packages/designer/ui/src/foundry').filter(file => /\/studio-[^/]*\.tsx$/.test(file) && !TEST.test(file));
const serverRows = [`${SERVER}/slot-detail.ts`, `${SERVER}/slot-gallery.ts`, `${SERVER}/writer-specimen-kinds.ts`];

const parse = (file, text) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const lineOf = (source, node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
const COPY_ATTRIBUTE = name => /^(?:aria-label|aria-description|title|placeholder|label|description|alt)$/.test(name) || /Label$/.test(name);
const COPY_PROPERTY = new Set(['label', 'title', 'name', 'description', 'placeholder', 'heading', 'empty', 'summary', 'plan', 'email', 'initials', 'badge', 'detail', 'message', 'loading', 'text', 'openLabel', 'statusLabel', 'emptyTitle']);
/** A literal that reads as copy: it has a letter and either a capital or a space. */
const reads = value => /[A-Za-z]/.test(value) && (/[A-Z]/.test(value) || /\s/.test(value.trim()));
/** The string literals an expression yields directly (through conditionals, parentheses and ?? / ||). */
function literals(node) {
  if (!node) return [];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node];
  if (ts.isTemplateExpression(node)) return [node];
  if (ts.isParenthesizedExpression(node)) return literals(node.expression);
  if (ts.isConditionalExpression(node)) return [...literals(node.whenTrue), ...literals(node.whenFalse)];
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)) return [...literals(node.left), ...literals(node.right)];
  return [];
}
const literalText = node => ts.isTemplateExpression(node) ? [node.head.text, ...node.templateSpans.map(span => span.literal.text)].join(' ') : node.text;

/* jsx + prop */
for (const file of [...studioSources, ...designerFrames, ...serverRows]) {
  const text = read(file);
  if (text === undefined || !/\.(?:tsx?|mjs)$/.test(file)) continue;
  const source = parse(file, text);
  const jsx = file.endsWith('.tsx');
  const visit = node => {
    if (jsx && ts.isJsxText(node) && /[A-Za-z]/.test(node.text)) fail('jsx', `${file}:${lineOf(source, node)}`, `JSX text "${node.text.trim().slice(0, 48)}"`);
    if (jsx && ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      for (const literal of literals(node.expression)) if (reads(literalText(literal))) fail('jsx', `${file}:${lineOf(source, literal)}`, `JSX text "${literalText(literal).slice(0, 48)}"`);
    }
    if (jsx && ts.isJsxAttribute(node) && COPY_ATTRIBUTE(node.name.getText(source)) && node.initializer) {
      const value = ts.isJsxExpression(node.initializer) ? literals(node.initializer.expression) : literals(node.initializer);
      for (const literal of value) if (/[A-Za-z]/.test(literalText(literal))) fail('jsx', `${file}:${lineOf(source, literal)}`, `${node.name.getText(source)}="${literalText(literal).slice(0, 48)}"`);
    }
    if (ts.isPropertyAssignment(node) && COPY_PROPERTY.has(node.name.getText(source).replace(/^["']|["']$/g, ''))) {
      for (const literal of literals(node.initializer)) if (reads(literalText(literal))) fail('prop', `${file}:${lineOf(source, literal)}`, `${node.name.getText(source)}: "${literalText(literal).slice(0, 48)}"`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/* record */
{
  const KEY = /^studio\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
  const publisher = 'clossys/agents/publisher';
  const slots = [...new Set(walk(publisher).map(file => file.slice(publisher.length + 1).split('/')[0]).filter(name => /^(?:page|publication)\./.test(name)))];
  for (const slot of slots) {
    const pin = JSON.parse(read(`${publisher}/${slot}/pin.json`) ?? 'null');
    if (!pin) continue;
    const bytes = read(`${publisher}/${slot}/candidates/${pin.candidate}`);
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== pin.sha256) continue;
    const visit = (value, path) => {
      if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${path}[${index}]`));
      else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
        if ((key === 'label' || key === 'prompt') && typeof item === 'string' && !KEY.test(item)) fail('record', `${slot}/${pin.candidate} ${path}.${key}`, `literal ${key} "${item.slice(0, 48).replace(/\n/g, ' ')}" (a record holds Writer keys only)`);
        else visit(item, `${path}.${key}`);
      }
    };
    visit(JSON.parse(bytes), '$');
  }
}

/* label */
{
  const PATTERNS = [
    [/\bhumani[sz]e\s*\(/, 'humanize()'],
    [/\bsentence\s*\(/, 'sentence()'],
    [/\.charAt\(0\)\.toUpperCase\(\)/, 'charAt(0).toUpperCase()'],
    [/\.replace\(\s*\/\^\\w\/[^)]*\)?[^;\n]*toUpperCase/, "replace(/^\\w/, toUpperCase)"],
    [/\b(?:label|name|title)\s*:\s*(?:id|row\.key|detail\.id|card\.id|leaf\.slug)\b(?!\s*[.(\[])/, 'an id used as the label'],
    [/\?\?\s*(?:card\.id|detail\.id|leaf\.slug|card\.slug)\b/, 'an id as the label fallback'],
  ];
  const files = [...studioSources, ...designerFrames, ...walk('packages/producer/src').filter(file => /\.tsx?$/.test(file) && !TEST.test(file))];
  for (const file of new Set(files)) {
    if (RESOLVER.has(file)) continue;
    const text = read(file);
    if (text === undefined) continue;
    text.split('\n').forEach((line, index) => {
      for (const [pattern, name] of PATTERNS) if (pattern.test(line)) fail('label', `${file}:${index + 1}`, `${name} turns an id into a label outside the resolver`);
    });
  }
}

const rules = ['jsx', 'prop', 'record', 'label'];
for (const rule of rules) {
  const rows = findings.filter(row => row.rule === rule);
  console.log(`${rows.length ? 'FAIL' : 'ok  '} ${rule}${rows.length ? ` (${rows.length})` : ''}`);
  for (const row of process.argv.includes('--all') ? rows : rows.slice(0, 12)) console.log(`     ${row.where}: ${row.message}`);
  if (!process.argv.includes('--all') && rows.length > 12) console.log(`     ... ${rows.length - 12} more`);
}
console.log(findings.length ? `check-copy-source: ${findings.length} findings${rev ? ` at ${rev}` : ''}` : `check-copy-source: every rule holds${rev ? ` at ${rev}` : ''}`);
process.exit(findings.length ? 1 : 0);
