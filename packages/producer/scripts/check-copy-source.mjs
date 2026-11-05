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
 *   record    no literal `label`, `prompt`, `title` or `message` field, and no literal `name` in a
 *             publication `tree`, in a pinned Publisher page record or publication: a record holds
 *             Writer keys (`studio.<key>`) only.
 *   label     no function that turns an id into a label (humanize, sentence, a capitalised first
 *             letter, `label: id`) outside the one resolver, src/records/slot-labels.ts (read by
 *             src/publish/expand-tabs.ts into the content-map projection).
 *   names     every slot and every IA node, group and layer of every agent has its Writer name in
 *             the pinned `strings.names` (the resolver throws on a missing one at render).
 *   keys      every Writer key the Studio and Producer sources and the Publisher records name
 *             (`studioCopy('studio.x')`, `StudioCopyError(...)`, `copyRef(...)`, `copy: '...'`, a
 *             record field) is a record of the pinned Writer copy; a key built from a template
 *             names a prefix some pinned key has.
 *   message   Studio never shows a thrown or served message: no `.message`/`.error` read of a caught
 *             error, a rejection, or a served JSON value in studio/** outside lib/studio-copy.ts
 *             (whose `errorText` shows a StudioCopyError's Writer text, or a Writer fallback). This is
 *             what keeps the Producer's JSON error strings (src/server) from ever rendering.
 *   lang      the document's `<html lang>` is the Writer's source locale (an expression), not a literal.
 *   row       a server row Studio shows never composes words from a finding: no string or template
 *             literal with letters pushed into a row list (`issues.push('...')`), and a finding's
 *             `.message` or `.code` is read only as a Writer copy value (`copyRef(key, { message })`)
 *             or into a thrown Error (which the message rule keeps from rendering), never joined
 *             into text (`${issue.code}: ${issue.message}`).
 *
 * Usage: node packages/producer/scripts/check-copy-source.mjs [--root <repository>] [--rev <git rev>] [--all]
 *   --root  check another repository-shaped tree (a fixture) instead of this repository
 *   --rev   check that commit of this repository (to prove the check fails before a fix)
 * Each finding prints as `<rule> <where>: <message>`. Exit 0 when every rule holds, 1 on a finding.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { listSlots, readIa } from '../dist/records/slots.js';
import { iaNameKey, pinnedNames, slotNameKey } from '../dist/records/slot-labels.js';
import { WRITER_KEY, writerCopy } from '../dist/records/writer-copy.js';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const flag = name => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : undefined; };
const rev = flag('--rev');
/** The tree checked: --root, a snapshot of --rev (the paths this check reads), or this repository. */
let repo = resolve(flag('--root') ?? here);
if (rev) {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'check-copy-source-')));
  process.on('exit', () => rmSync(repo, { recursive: true, force: true }));
  const paths = ['clossys', 'packages/producer/studio', 'packages/producer/src', 'packages/designer/ui/src/foundry'];
  const present = paths.filter(path => { try { execFileSync('git', ['-C', here, 'cat-file', '-e', `${rev}:${path}`]); return true; } catch { return false; } });
  execFileSync('/bin/sh', ['-c', 'git -C "$1" archive "$2" -- "${@:4}" | tar -x -C "$3"', 'sh', here, rev, repo, ...present]);
}
const read = path => {
  const file = join(repo, path);
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
};
/** Every present file under a directory, repository-relative. */
function walk(dir) {
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
const COPY_ATTRIBUTE = name => /^(?:aria-(?:label|description|roledescription|valuetext|placeholder|braillelabel|brailleroledescription)|title|placeholder|label|description|alt)$/.test(name) || /Label$/.test(name);
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
const KEY = WRITER_KEY;
const publisherKeys = [];
{
  const publisher = 'clossys/agents/publisher';
  const COPY_FIELD = new Set(['label', 'prompt', 'title', 'message']);
  const slots = [...new Set(walk(publisher).map(file => file.slice(publisher.length + 1).split('/')[0]).filter(name => /^(?:page|publication)\./.test(name)))];
  for (const slot of slots) {
    const pin = JSON.parse(read(`${publisher}/${slot}/pin.json`) ?? 'null');
    if (!pin) continue;
    const bytes = read(`${publisher}/${slot}/candidates/${pin.candidate}`);
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== pin.sha256) continue;
    const visit = (value, path, tree) => {
      if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${path}[${index}]`, tree));
      else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
        const copy = COPY_FIELD.has(key) || (tree && key === 'name');
        if (copy && typeof item === 'string') {
          if (KEY.test(item)) publisherKeys.push({ key: item, where: `${slot}/${pin.candidate} ${path}.${key}` });
          else fail('record', `${slot}/${pin.candidate} ${path}.${key}`, `literal ${key} "${item.slice(0, 48).replace(/\n/g, ' ')}" (a record holds Writer keys only)`);
        } else visit(item, `${path}.${key}`, tree || key === 'tree');
      }
    };
    visit(JSON.parse(bytes), '$', false);
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

const consumer = join(repo, 'clossys');
const AGENTS = ['director', 'designer', 'writer', 'publisher', 'producer'];

/* names */
if (existsSync(join(consumer, 'agents'))) {
  const names = pinnedNames(consumer);
  const need = (context, where) => { if (!names.has(context)) fail('names', where, `no Writer name for ${context} (pinned writer/strings.names)`); };
  for (const agent of AGENTS) {
    let ia;
    try { ia = readIa(consumer, agent); } catch (error) { fail('names', `clossys/agents/${agent}/ia.json`, `unreadable IA: ${error.message}`); continue; }
    if (!ia) continue;
    for (const node of ia.nodes) { need(iaNameKey(agent, node.id), `${agent} IA node ${node.id}`); for (const child of node.children) need(iaNameKey(agent, child.id), `${agent} IA group ${child.id}`); }
    for (const layer of ia.layers ?? []) need(iaNameKey(agent, layer.id), `${agent} IA layer ${layer.id}`);
    for (const entry of listSlots(consumer, agent)) {
      need(slotNameKey(agent, entry.id), `${agent} slot ${entry.id}`);
      if (!ia.layers) need(iaNameKey(agent, entry.position.l0 ?? agent), `${agent} slot ${entry.id} layer`);
    }
  }
}

/* keys */
{
  let copy;
  try { copy = writerCopy(consumer); } catch (error) { fail('keys', 'clossys/agents/writer', `the pinned Writer copy does not load: ${error.message}`); }
  if (copy) {
    const held = copy.ids;
    const sources = new Set([...studioSources, ...walk('packages/producer/src').filter(file => /\.tsx?$/.test(file) && !TEST.test(file) && !file.endsWith('.d.ts'))]);
    const CALL = /^(?:studioCopy|StudioCopyError|copyRef|copyText)$/;
    const named = [...publisherKeys];
    const prefixes = [];
    for (const file of sources) {
      const text = read(file);
      if (text === undefined) continue;
      const source = parse(file, text);
      const visit = node => {
        const callee = ts.isCallExpression(node) || ts.isNewExpression(node) ? node.expression : undefined;
        const name = callee && (ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '');
        const argument = name && (CALL.test(name) || (name === 'text' && ts.isPropertyAccessExpression(callee))) ? node.arguments?.[0] : undefined;
        const property = ts.isPropertyAssignment(node) && node.name.getText(source).replace(/^["']|["']$/g, '') === 'copy' ? node.initializer : undefined;
        for (const value of [argument, property]) {
          if (!value) continue;
          for (const literal of literals(value)) {
            if (ts.isTemplateExpression(literal)) { if (literal.head.text.startsWith('studio.')) prefixes.push({ prefix: literal.head.text, where: `${file}:${lineOf(source, literal)}` }); }
            else if (KEY.test(literal.text)) named.push({ key: literal.text, where: `${file}:${lineOf(source, literal)}` });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    if (process.argv.includes('--counts')) console.log(`keys: ${named.length} named, ${prefixes.length} prefixes, ${held.length} held`);
    for (const row of named) if (!copy.has(row.key)) fail('keys', row.where, `${row.key} is no record of the pinned Writer copy`);
    for (const row of prefixes) if (!held.some(id => id.startsWith(row.prefix))) fail('keys', row.where, `no pinned Writer key starts with ${row.prefix}`);
  }
}

/* message */
{
  const ALLOWED = new Set([`${STUDIO}/lib/studio-copy.ts`]);
  const SERVED = /^(?:value|json|body|data|payload|response|result|parsed|reply)$/;
  const ERROR = /^(?:error|err|e|cause|reason|failure|exception|rejection)$/;
  // Build configuration (`*.config.mjs`) runs at build time and renders nothing.
  for (const file of studioSources.filter(path => !/\/[^/]+\.config\.[cm]?[jt]s$/.test(path))) {
    if (ALLOWED.has(file)) continue;
    const text = read(file);
    if (text === undefined) continue;
    const source = parse(file, text);
    const caught = new Set();
    const visit = node => {
      if (ts.isCatchClause(node) && node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name)) caught.add(node.variableDeclaration.name.text);
      const bare = expression => ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isSatisfiesExpression(expression) ? bare(expression.expression) : expression;
      if (ts.isPropertyAccessExpression(node) && (node.name.text === 'message' || node.name.text === 'error') && ts.isIdentifier(bare(node.expression))) {
        const receiver = bare(node.expression).text;
        if (caught.has(receiver) || ERROR.test(receiver) || SERVED.test(receiver)) fail('message', `${file}:${lineOf(source, node)}`, `${receiver}.${node.name.text} shows a thrown or served message (use errorText / a Writer key)`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}

/* lang */
for (const file of studioSources.filter(file => file.endsWith('.tsx'))) {
  const text = read(file);
  if (text === undefined) continue;
  const source = parse(file, text);
  const visit = node => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'html') {
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'lang' && attribute.initializer && (ts.isStringLiteral(attribute.initializer) || (ts.isJsxExpression(attribute.initializer) && literals(attribute.initializer.expression).length)))
          fail('lang', `${file}:${lineOf(source, attribute)}`, 'a literal <html lang>: the document language is the Writer source locale');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/* row */
for (const file of serverRows) {
  const text = read(file);
  if (text === undefined) continue;
  const source = parse(file, text);
  const call = (node, test) => ts.isCallExpression(node) && test(ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : '');
  // A finding's words reach Studio only as a copyRef value or a thrown Error.
  const carried = node => {
    for (let at = node.parent; at && !ts.isSourceFile(at); at = at.parent) {
      if (ts.isNewExpression(at) && ts.isIdentifier(at.expression) && /Error$/.test(at.expression.text)) return true;
      if (call(at, name => name === 'copyRef') && at.arguments.length > 1 && at.arguments.slice(1).some(argument => argument.pos <= node.pos && node.end <= argument.end)) return true;
      if (ts.isFunctionLike(at)) return false;
    }
    return false;
  };
  // A lookup or a comparison reads the value as an id, not as words.
  const lookup = node => (ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node)
    || (ts.isBinaryExpression(node.parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.parent.operatorToken.kind));
  const visit = node => {
    if (call(node, name => name === 'push')) {
      for (const argument of node.arguments) for (const literal of literals(argument)) if (/[A-Za-z]/.test(literalText(literal))) fail('row', `${file}:${lineOf(source, literal)}`, `a row pushes the literal "${literalText(literal).slice(0, 48)}" (push a Writer copy reference)`);
    }
    if (ts.isPropertyAccessExpression(node) && (node.name.text === 'message' || node.name.text === 'code') && !ts.isPropertyAccessExpression(node.parent) && !lookup(node) && !carried(node)) {
      fail('row', `${file}:${lineOf(source, node)}`, `${node.getText(source).slice(0, 48)} becomes row text (pass it as a Writer copy value)`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const rules = ['jsx', 'prop', 'record', 'label', 'names', 'keys', 'message', 'lang', 'row'];
for (const rule of rules) {
  const rows = findings.filter(row => row.rule === rule);
  console.log(`${rows.length ? 'FAIL' : 'ok  '} ${rule}${rows.length ? ` (${rows.length})` : ''}`);
  for (const row of process.argv.includes('--all') ? rows : rows.slice(0, 12)) console.log(`${rule.padEnd(8)} ${row.where}: ${row.message}`);
  if (!process.argv.includes('--all') && rows.length > 12) console.log(`         ... ${rows.length - 12} more`);
}
console.log(findings.length ? `check-copy-source: ${findings.length} findings${rev ? ` at ${rev}` : ''}` : `check-copy-source: every rule holds${rev ? ` at ${rev}` : ''}`);
process.exit(findings.length ? 1 : 0);
