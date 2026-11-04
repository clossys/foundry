#!/usr/bin/env node
/**
 * assemble-only: Publisher only assembles Studio pages. A Studio page is a pinned Publisher page
 * record (frame + a declared page-header section + module sections) that one generic renderer
 * resolves record -> frame -> sections. This check fails when that claim is false in code:
 *
 *   app-route        an `app/**\/page.tsx` does anything but mount `PublishedPage` for a record id
 *   agent-branch     the renderer, its loaders or sections branch on an agent name or slot kind,
 *                    or key copy/loaders by agent, instead of reading record data
 *   provenance       a section's top-level DOM block does not spread the generated `{...provenance}`
 *                    markers (or hand-types a marker), or the renderer
 *                    draws its own DOM blocks between the frame and the sections
 *   explorer         a page renders the retired page-level explorer
 *   hard-coded-route nav, tab or API routes are string literals instead of content-map projections
 *   tabs-projected   a record page has no group-tab page routes projected from the agent's ia.json
 *   page-header      a pinned page record does not declare the page-header section first
 *
 * Usage: node scripts/check-assemble-only.mjs [--root <repository>] [--json]. `--root` checks another
 * repository tree (its packages/producer) instead of this one. Exit 1 on any finding.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const PRODUCER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY_ROOT = path.resolve(PRODUCER_ROOT, '../..');
/** The first line of every route file Publisher installs (`NEXT_ROUTE_MARKER`). */
export const ROUTE_MARKER = '// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.';
/** The page-header section every page record places first. */
export const PAGE_HEADER = 'sections.studio.page-header';
/** The page-tabs section a record with group tabs places. */
export const PAGE_TABS = 'sections.studio.page-tabs';
const AGENT_WORDS = ['designer', 'writer', 'director', 'publisher', 'slot'];
const AGENT_LITERAL = `['"\`](?:${AGENT_WORDS.join('|')})['"\`]`;
const AGENT_BRANCH = [
  new RegExp(`[!=]==?\\s*${AGENT_LITERAL}`),
  new RegExp(`${AGENT_LITERAL}\\s*[!=]==?`),
  new RegExp(`\\bcase\\s+${AGENT_LITERAL}`),
  /\bRecord<\s*Agent\b/,
];
/** Object keys named after agents: an agent-keyed copy or loader map. */
const AGENT_KEY = new RegExp(`^\\s*['"]?(?:${AGENT_WORDS.slice(0, 4).join('|')})['"]?\\s*:`);
/** Route literals that name an agent surface (`'/designer'`, `` `/writer/${x}` ``, legacy library APIs). */
const ROUTE_LITERAL = new RegExp(`['"\`]/(?:api/(?:designer|agents)/|(?:${AGENT_WORDS.slice(0, 4).join('|')})(?:[/'"\`?$]))`);
const EXPLORER = /module-explorer|sections\.module\.explorer|page\.explorer|navigator['"]?\s*:\s*['"]explorer['"]/;

const posix = file => file.split(path.sep).join('/');
function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(file));
    else files.push(file);
  }
  return files.sort();
}
const isSource = file => /\.(?:[cm]?[jt]sx?)$/.test(file) && !/\.test\.|\.provenance\./.test(file);
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** (a) every App Router page mounts PublishedPage for one record and does nothing else. */
function checkAppRoutes(studioRoot) {
  const findings = [];
  for (const file of walk(path.join(studioRoot, 'app')).filter(name => path.basename(name) === 'page.tsx')) {
    const rel = posix(path.relative(studioRoot, file));
    const text = fs.readFileSync(file, 'utf8');
    const why = [];
    if (text.split('\n', 1)[0] !== ROUTE_MARKER) why.push('not installed by Publisher (no route marker)');
    if (!/createElement\(PublishedPage\s*,\s*\{\s*page:/.test(text)) why.push('does not mount PublishedPage for a record id');
    const tree = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    (function visit(node) {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) why.push(`renders JSX at line ${lineOf(text, node.getStart(tree))}`);
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const spec = node.moduleSpecifier.text;
        if (!['react', 'next/navigation'].includes(spec) && !/(?:^|\/)StudioInstalledPage$/.test(spec)) why.push(`imports ${spec}`);
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch') why.push(`fetches at line ${lineOf(text, node.getStart(tree))}`);
      ts.forEachChild(node, visit);
    })(tree);
    for (const detail of [...new Set(why)]) findings.push({ rule: 'app-route', file: rel, detail });
  }
  return findings;
}

/** Files the renderer path owns: the renderer, its loaders, the frame and the sections. */
function rendererFiles(studioRoot) {
  return ['components', 'lib', 'frames', 'sections']
    .flatMap(folder => walk(path.join(studioRoot, folder)))
    .filter(isSource);
}

/** (b) no agent-name or slot-kind branches, no agent-keyed maps; (e) no agent route literals. */
function checkSources(studioRoot) {
  const findings = [];
  for (const file of rendererFiles(studioRoot)) {
    const rel = posix(path.relative(studioRoot, file));
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/^\s*(?:\*|\/\*)/.test(code)) return;
      if (AGENT_BRANCH.some(pattern => pattern.test(code))) findings.push({ rule: 'agent-branch', file: rel, line: index + 1, detail: line.trim().slice(0, 160) });
      else if (AGENT_KEY.test(code)) findings.push({ rule: 'agent-branch', file: rel, line: index + 1, detail: `agent-keyed map: ${line.trim().slice(0, 140)}` });
      if (ROUTE_LITERAL.test(code)) findings.push({ rule: 'hard-coded-route', file: rel, line: index + 1, detail: line.trim().slice(0, 160) });
    });
  }
  return findings;
}

const unwrap = node => { while (node && ts.isParenthesizedExpression(node)) node = node.expression; return node; };
const jsxAttributes = node => ts.isJsxElement(node) ? node.openingElement.attributes : ts.isJsxSelfClosingElement(node) ? node.attributes : undefined;

/** The JSX roots a function returns, not descending into nested functions. */
function returnedRoots(body) {
  const roots = [];
  const take = expression => {
    const node = unwrap(expression);
    if (!node) return;
    if (ts.isConditionalExpression(node)) { take(node.whenTrue); take(node.whenFalse); return; }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) { take(node.right); return; }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) roots.push(node);
  };
  if (!ts.isBlock(body)) { take(body); return roots; }
  (function visit(node) {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) take(node.expression);
    ts.forEachChild(node, visit);
  })(body);
  return roots;
}

/** (c) each section's default export roots spread the generated provenance markers and hand-type none; the renderer draws no DOM of its own. */
function checkProvenance(studioRoot) {
  const findings = [];
  const sections = path.join(studioRoot, 'sections');
  for (const name of fs.existsSync(sections) ? fs.readdirSync(sections).sort() : []) {
    const file = path.join(sections, name, 'index.tsx');
    if (!fs.existsSync(file)) continue;
    const rel = posix(path.relative(studioRoot, file));
    const text = fs.readFileSync(file, 'utf8');
    const tree = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const exported = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.DefaultKeyword));
    if (!exported?.body) { findings.push({ rule: 'provenance', file: rel, detail: 'no default-exported section function' }); continue; }
    const roots = returnedRoots(exported.body);
    if (!roots.length) findings.push({ rule: 'provenance', file: rel, detail: 'the section returns no JSX block' });
    for (const root of roots) {
      const attributes = jsxAttributes(root);
      // The assembly passes data-clossys-slot/candidate/hash, generated from the page record and pins; the root spreads them.
      const tagged = attributes?.properties.some(property => ts.isJsxSpreadAttribute(property) && property.expression.getText(tree) === 'provenance');
      if (!tagged) findings.push({ rule: 'provenance', file: rel, line: lineOf(text, root.getStart(tree)), detail: 'top-level block does not spread the generated {...provenance} markers' });
      const literal = attributes?.properties.find(property => ts.isJsxAttribute(property) && /^data-(?:studio-section|clossys-(?:slot|candidate|hash))$/.test(property.name.getText(tree)));
      if (literal) findings.push({ rule: 'provenance', file: rel, line: lineOf(text, literal.getStart(tree)), detail: `top-level block hand-types ${literal.name.getText(tree)}` });
    }
  }
  const renderer = path.join(studioRoot, 'components', 'StudioPage.tsx');
  if (fs.existsSync(renderer)) {
    const text = fs.readFileSync(renderer, 'utf8');
    const tree = ts.createSourceFile('StudioPage.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    (function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(tree);
        if (/^[a-z]/.test(tag)) findings.push({ rule: 'provenance', file: 'components/StudioPage.tsx', line: lineOf(text, node.getStart(tree)), detail: `the renderer draws a <${tag}> block outside any section` });
      }
      ts.forEachChild(node, visit);
    })(tree);
  }
  return findings;
}

/** The pinned candidate of every publisher page slot. */
function pinnedPages(publisherRoot) {
  if (!fs.existsSync(publisherRoot)) return [];
  return fs.readdirSync(publisherRoot).filter(name => name.startsWith('page.')).sort().flatMap(name => {
    const pinFile = path.join(publisherRoot, name, 'pin.json');
    if (!fs.existsSync(pinFile)) return [];
    const pin = JSON.parse(fs.readFileSync(pinFile, 'utf8'));
    const file = path.join(publisherRoot, name, 'candidates', pin.candidate);
    return [{ slot: name, file, text: fs.readFileSync(file, 'utf8'), record: JSON.parse(fs.readFileSync(file, 'utf8')) }];
  });
}

/** (d) no explorer; (f) page-header first in every record. */
function checkRecords(repositoryRoot, studioRoot) {
  const findings = [];
  const publisherRoot = path.join(repositoryRoot, 'clossys', 'agents', 'publisher');
  const pages = pinnedPages(publisherRoot);
  if (!pages.length) findings.push({ rule: 'page-header', file: 'clossys/agents/publisher', detail: 'no pinned page records' });
  for (const page of pages) {
    const rel = posix(path.relative(repositoryRoot, page.file));
    if (EXPLORER.test(page.text)) findings.push({ rule: 'explorer', file: rel, detail: 'the record places the page-level explorer' });
    if (page.record.sections?.[0] !== PAGE_HEADER) findings.push({ rule: 'page-header', file: rel, detail: `first section is ${page.record.sections?.[0] ?? 'missing'}, not ${PAGE_HEADER}` });
  }
  if (fs.existsSync(path.join(studioRoot, 'sections', 'module-explorer'))) findings.push({ rule: 'explorer', file: 'sections/module-explorer', detail: 'the explorer section still ships' });
  const generated = path.join(studioRoot, 'generated', 'studio-map.json');
  if (fs.existsSync(generated) && EXPLORER.test(fs.readFileSync(generated, 'utf8'))) findings.push({ rule: 'explorer', file: 'generated/studio-map.json', detail: 'the generated map places the explorer' });
  for (const file of rendererFiles(studioRoot)) {
    const text = fs.readFileSync(file, 'utf8');
    const match = text.match(/page\.explorer|ExplorerSection|ExplorerGroup/);
    if (match) findings.push({ rule: 'explorer', file: posix(path.relative(studioRoot, file)), line: lineOf(text, match.index), detail: `explorer code: ${match[0]}` });
  }
  return findings;
}

/** (e) tabs are content-map routes projected from ia.json: every record page that places page-tabs has tab sections. */
function checkTabs(studioRoot) {
  const findings = [];
  const generated = path.join(studioRoot, 'generated', 'studio-map.json');
  if (!fs.existsSync(generated)) return [{ rule: 'tabs-projected', file: 'generated/studio-map.json', detail: 'no generated Studio map' }];
  const { map } = JSON.parse(fs.readFileSync(generated, 'utf8'));
  const groups = map.entries.filter(entry => entry.kind === 'group' && entry.parentId == null && entry.id !== 'home');
  if (!groups.length) findings.push({ rule: 'tabs-projected', file: 'generated/studio-map.json', detail: 'no agent groups at the nav root' });
  for (const group of groups) {
    const records = map.entries.filter(entry => entry.parentId === group.id && entry.kind === 'page');
    if (!records.length) findings.push({ rule: 'tabs-projected', file: 'generated/studio-map.json', detail: `${group.id}: no top-group record pages under the agent` });
    for (const record of records) {
      // A tab is a content-map entry under the record whose path extends the record's path (a group-tab route).
      const tabs = map.entries.filter(entry => entry.parentId === record.id && entry.kind === 'page' && typeof entry.path === 'string' && entry.path.startsWith(`${record.path}/`));
      if (record.source?.sectionIds?.includes(PAGE_TABS) && !tabs.length) findings.push({ rule: 'tabs-projected', file: 'generated/studio-map.json', detail: `${record.id}: places page-tabs but projects no tab routes` });
      if (!record.source?.sectionIds?.includes(PAGE_TABS)) findings.push({ rule: 'tabs-projected', file: 'generated/studio-map.json', detail: `${record.id}: places no page-tabs section` });
    }
  }
  const agents = map.entries.filter(entry => entry.id === 'agents');
  for (const entry of agents) {
    const flat = map.entries.filter(row => row.parentId === entry.id && row.kind === 'page');
    if (flat.length) findings.push({ rule: 'tabs-projected', file: 'generated/studio-map.json', detail: `agents: ${flat.length} agent pages are flat tabs, not agent accordions with top groups` });
  }
  return findings;
}

export function checkAssembleOnly({ producerRoot = PRODUCER_ROOT, repositoryRoot = REPOSITORY_ROOT } = {}) {
  const studioRoot = path.join(producerRoot, 'studio');
  return [
    ...checkAppRoutes(studioRoot),
    ...checkSources(studioRoot),
    ...checkProvenance(studioRoot),
    ...checkRecords(repositoryRoot, studioRoot),
    ...checkTabs(studioRoot),
  ];
}

export function formatFindings(findings) {
  if (!findings.length) return 'assemble-only: ok';
  const counts = findings.reduce((acc, row) => ({ ...acc, [row.rule]: (acc[row.rule] ?? 0) + 1 }), {});
  return [
    ...findings.map(row => `${row.rule}  ${row.file}${row.line ? `:${row.line}` : ''}  ${row.detail}`),
    `assemble-only: ${findings.length} finding(s): ${Object.entries(counts).map(([rule, count]) => `${rule}=${count}`).join(' ')}`,
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--root');
  const repositoryRoot = at > 0 ? path.resolve(process.argv[at + 1] ?? '') : undefined;
  const findings = checkAssembleOnly(repositoryRoot ? { repositoryRoot, producerRoot: path.join(repositoryRoot, 'packages', 'producer') } : {});
  console.log(process.argv.includes('--json') ? JSON.stringify(findings, null, 2) : formatFindings(findings));
  process.exit(findings.length ? 1 : 0);
}
