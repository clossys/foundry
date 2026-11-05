#!/usr/bin/env node
/**
 * routes-published: every Studio route, nav link, breadcrumb, tab and landing comes from the Publisher
 * projection (`studio/generated/studio-map.json`, written by generate-studio-map from the pinned
 * publication). The served app and the projection must agree both ways:
 *
 *   route-unpublished   an installed `app/**\/page.tsx` mounts an id that is no published page record,
 *                       or sits at a path other than its record's path
 *   leaf-unpublished    a leaf template lists a slug whose `<tab path>/<slug>` is no published leaf
 *   record-unserved     a published page record has no installed route file at its path, or a tab
 *                       with published leaves has no installed leaf template
 *   link-unpublished    a nav link, command, breadcrumb, tab, landing or redirect target is no
 *                       published page or leaf path
 *   not-projected       breadcrumbs (trails), tabs or landings are missing from the projection, or a
 *                       served page has no projected trail: the Studio would derive them by hand
 *   shell-unpublished   the publication's root layout or a state file (`loading`, `not-found`, `error`,
 *                       `global-error`) is missing, not installed by Publisher, mounts anything but the
 *                       publication's document or that state, or is not in the projection's shell
 *   route-unpublished   (also) any other App Router file (a nested layout, template or state, a route
 *                       handler): no publication installs it
 *
 * Usage: node scripts/check-routes-published.mjs [--root <repository>] [--json]. `--root` checks another
 * repository tree (its packages/producer/studio) instead of this one. Exit 1 on any finding.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectCommands, projectNavigation } from '@clossys/publisher/content-map';
import { NEXT_DOCUMENT_EXPORT, NEXT_ROUTE_MARKER, NEXT_SHELL_FILES, NEXT_STATE_EXPORT } from '@clossys/publisher/install';

const PRODUCER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY_ROOT = path.resolve(PRODUCER_ROOT, '../..');

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

/** The installed route files: their served path, the record id they mount and, for a leaf template, its listed slugs. */
export function installedRoutes(studioRoot) {
  const app = path.join(studioRoot, 'app');
  return walk(app).filter(file => path.basename(file) === 'page.tsx').map(file => {
    const rel = posix(path.relative(studioRoot, file));
    const dirs = posix(path.relative(app, path.dirname(file))).split('/').filter(segment => segment && segment !== '.');
    const text = fs.readFileSync(file, 'utf8');
    const id = /createElement\(PublishedPage\s*,\s*\{\s*page:\s*"([^"]+)"/.exec(text)?.[1];
    const leaf = dirs.at(-1) === '[slug]';
    const base = `/${(leaf ? dirs.slice(0, -1) : dirs).join('/')}`;
    const slugs = leaf ? [...text.matchAll(/\{\s*slug:\s*"([^"]+)"\s*\}/g)].map(match => match[1]) : [];
    return { file: rel, path: base, id, leaf, slugs };
  });
}

/** Every App Router file name that serves a route, a layout or a state. */
const APP_ROUTER_FILE = /^(?:page|route|default|layout|template|loading|error|global-error|not-found)\.[cm]?[jt]sx?$/;
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** What an installed shell file mounts: the document for the root layout, else its own state. */
const shellMount = shell => shell.state === 'document'
  ? new RegExp(`createElement\\(${NEXT_DOCUMENT_EXPORT}\\s*,`)
  : new RegExp(`createElement\\(${NEXT_STATE_EXPORT}\\s*,\\s*\\{\\s*state:\\s*"${escape(shell.state)}"\\s*\\}\\)`);

/** The App Router files under app/ that are not `page.tsx`: the publication's shell, and anything else. */
export function installedAppFiles(studioRoot) {
  const app = path.join(studioRoot, 'app');
  return walk(app).filter(file => APP_ROUTER_FILE.test(path.basename(file)) && path.basename(file) !== 'page.tsx')
    .map(file => ({ file: posix(path.relative(studioRoot, file)), name: posix(path.relative(app, file)), text: fs.readFileSync(file, 'utf8') }));
}

/** Every finding for one repository tree. */
export function checkRoutesPublished(root = REPOSITORY_ROOT) {
  const studioRoot = path.join(root, 'packages/producer/studio');
  const projectionFile = path.join(studioRoot, 'generated/studio-map.json');
  const findings = [];
  const add = (rule, where, message) => findings.push({ rule, where, message });
  if (!fs.existsSync(projectionFile)) { add('not-projected', 'studio/generated/studio-map.json', 'no Publisher projection: run generate-studio-map'); return { findings, routes: 0, links: 0 }; }
  const projection = JSON.parse(fs.readFileSync(projectionFile, 'utf8'));
  const pages = new Map((projection.pages ?? []).map(page => [page.id, page]));
  const leaves = projection.leaves ?? [];
  const published = new Set([...[...pages.values()].map(page => page.path), ...leaves.map(leaf => leaf.path)]);

  // The served app against the records.
  const routes = installedRoutes(studioRoot);
  const served = new Set(), templates = new Set();
  for (const route of routes) {
    const record = route.id === undefined ? undefined : pages.get(route.id);
    if (!record) { add('route-unpublished', route.file, `mounts ${route.id ?? 'no record id'}, which is no published page record`); continue; }
    if (record.path !== route.path) { add('route-unpublished', route.file, `serves ${route.path}, but record ${route.id} is published at ${record.path}`); continue; }
    if (route.leaf) {
      templates.add(route.id);
      for (const slug of route.slugs) if (!leaves.some(leaf => leaf.page === route.id && leaf.slug === slug)) add('leaf-unpublished', route.file, `lists ${slug}, which is no published leaf of ${route.id}`);
    } else served.add(route.id);
  }
  // The publication's shell: every shell file installed, mounting its document or state, and projected.
  const shellFiles = new Map(NEXT_SHELL_FILES.map(shell => [shell.file, shell]));
  const others = installedAppFiles(studioRoot);
  for (const other of others) {
    const shell = shellFiles.get(other.name);
    if (!shell) { add('route-unpublished', other.file, 'is an App Router file no publication installs'); continue; }
    if (other.text.split('\n', 1)[0] !== NEXT_ROUTE_MARKER) add('shell-unpublished', other.file, `the publication's ${shell.state} is not installed by Publisher`);
    else if (!shellMount(shell).test(other.text)) add('shell-unpublished', other.file, `mounts something other than the publication's ${shell.state}`);
  }
  const projected = new Set((projection.shell ?? []).map(row => row.state));
  for (const shell of NEXT_SHELL_FILES) {
    if (!others.some(other => other.name === shell.file)) add('shell-unpublished', `app/${shell.file}`, `the publication's ${shell.state} has no installed file, so Next's built-in one renders`);
    if (!projected.has(shell.state)) add('not-projected', `projection.shell.${shell.state}`, `the publication's ${shell.state} is not in the Publisher projection`);
  }

  for (const page of pages.values()) if (!served.has(page.id)) add('record-unserved', page.id, `published at ${page.path}, but no installed route serves it`);
  for (const id of new Set(leaves.map(leaf => leaf.page))) if (!templates.has(id)) add('record-unserved', id, `publishes leaves under ${pages.get(id)?.path ?? id}, but no installed leaf template serves them`);

  // Every link the Studio shows, against the published paths.
  const missing = ['trails', 'tabs', 'landings'].filter(key => projection[key] === undefined);
  for (const key of missing) add('not-projected', `projection.${key}`, `${key === 'trails' ? 'breadcrumbs' : key} are not in the Publisher projection, so the Studio derives them by hand`);
  const links = [];
  try {
    const nav = projectNavigation(projection.map, projection.homeId);
    (function visit(nodes) { for (const node of nodes) { if (node.href) links.push(['nav', node.id, node.href]); visit(node.children ?? []); } })(nav.tree);
    for (const group of projectCommands(projection.map)) for (const item of group.items) if (item.href) links.push(['command', item.id, item.href]);
  } catch (error) { add('not-projected', 'projection.map', `the Publisher refuses the content map, so no nav or commands project: ${error.message}`); }
  for (const [id, trail] of Object.entries(projection.trails ?? {})) for (const crumb of trail) if (crumb.href) links.push(['breadcrumb', `${id} > ${crumb.id}`, crumb.href]);
  for (const tab of projection.tabs ?? []) links.push(['tab', tab.id, tab.path]);
  for (const [id, href] of Object.entries(projection.landings ?? {})) links.push(['landing', id, href]);
  for (const redirect of projection.redirects ?? []) links.push(['redirect', redirect.source, redirect.destination]);
  for (const [kind, id, href] of links) if (!published.has(href.split(/[?#]/)[0])) add('link-unpublished', id, `${kind} links ${href}, which is no published page or leaf`);
  if (projection.trails !== undefined) {
    for (const page of pages.values()) if (!projection.trails[page.id]) add('not-projected', page.id, `served at ${page.path} with no projected trail`);
    for (const leaf of leaves) if (!projection.trails[`${leaf.page}:${leaf.slug}`]) add('not-projected', `${leaf.page}:${leaf.slug}`, `served at ${leaf.path} with no projected trail`);
  }
  return { findings, routes: routes.length + others.length, links: links.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--root');
  const root = at >= 0 ? path.resolve(args[at + 1]) : REPOSITORY_ROOT;
  const result = checkRoutesPublished(root);
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    for (const finding of result.findings) console.log(`${finding.rule}  ${finding.where}  ${finding.message}`);
    console.log(result.findings.length ? `routes-published: ${result.findings.length} finding(s)` : `routes-published: OK (${result.routes} installed routes, ${result.links} links, all published)`);
  }
  process.exit(result.findings.length ? 1 : 0);
}
