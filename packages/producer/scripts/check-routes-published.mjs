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
 * The site template (`--surface site-template`) is checked over its installed output: the template
 * is installed for the fixture consumer (site-template-install.mjs, the template's own publish:site
 * install), and the installed site must agree with the projection that install wrote
 * (`clossys/publication.json`) both ways, with the same rules: an `app/**\/page.tsx` mounting no
 * projected page or off its route, a leaf template (a bound site serves pages only), a projected page
 * with no route or no marked page module, a page module no projected page owns, a root layout or state
 * file that is missing, unmarked or mounts anything else, any other App Router file (a route handler,
 * a nested layout, robots, sitemap, an icon or OG image), and a page module linking a path that is no
 * projected route. Paths are `site/<file>`; an install Publisher refuses leaves the template as shipped.
 *
 * Usage: node scripts/check-routes-published.mjs [--root <repository>] [--surface studio|site-template]
 * [--json]. `--root` checks another repository tree (its packages/producer/studio and
 * packages/publisher/templates/site) instead of this one. Both surfaces run unless `--surface` names
 * one. Exit 1 on any finding.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectCommands, projectNavigation } from '@clossys/publisher/content-map';
import { NEXT_DOCUMENT_EXPORT, NEXT_ROUTE_MARKER, NEXT_SHELL_FILES, NEXT_STATE_EXPORT } from '@clossys/publisher/install';
import { installSiteTemplate, SITE_TEMPLATE, walk as walkRelative } from './site-template-install.mjs';

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

/** Every App Router file a site could serve: route, layout and state names, plus name-served metadata files (icons, OG images, robots, sitemap, manifest). */
const SITE_ROUTER_FILE = file => APP_ROUTER_FILE.test(path.posix.basename(file)) || /^(?:icon|apple-icon|opengraph-image|twitter-image|favicon|robots|sitemap|manifest)\d*\.[a-z0-9]+$/.test(path.posix.basename(file));

/** Every finding for the site template, read from a fresh install of it (or the template as shipped, when Publisher refuses it). */
export async function checkSiteTemplateRoutesPublished({ root = REPOSITORY_ROOT, consumer } = {}) {
  const template = path.join(root, SITE_TEMPLATE);
  const findings = [];
  const add = (rule, where, message) => findings.push({ rule, where, message });
  if (!fs.existsSync(template)) { add('record-unserved', 'site', `${SITE_TEMPLATE} does not exist, so no route serves the site's records`); return { findings, routes: 0, links: 0 }; }
  const install = await installSiteTemplate({ template, ...(consumer ? { consumer } : {}) });
  try {
    const site = install.site;
    const at = file => `site/${file}`;
    const projectionFile = path.join(site, 'clossys/publication.json');
    let projection = { pages: [] };
    if (!fs.existsSync(projectionFile)) {
      const refused = install.result.findings.filter(finding => finding.severity !== 'info').map(finding => finding.detail);
      add('not-projected', at('clossys/publication.json'), `no Publisher projection: the install wrote none${refused.length ? ` (${refused.join('; ')})` : ''}`);
    } else projection = JSON.parse(fs.readFileSync(projectionFile, 'utf8'));
    const pages = new Map((projection.pages ?? []).map(page => [page.id, page]));
    const routesServed = new Set([...pages.values()].map(page => page.route));

    const routes = installedRoutes(site);
    const served = new Set();
    for (const route of routes) {
      const record = route.id === undefined ? undefined : pages.get(route.id);
      if (!record) { add('route-unpublished', at(route.file), `mounts ${route.id ?? 'no record id'}, which is no projected page`); continue; }
      if (route.leaf) { add('leaf-unpublished', at(route.file), 'a bound site serves pages only: no projected leaf backs this template'); continue; }
      if (record.route !== route.path) { add('route-unpublished', at(route.file), `serves ${route.path}, but page ${route.id} is projected at ${record.route}`); continue; }
      served.add(route.id);
    }
    for (const page of pages.values()) {
      if (!served.has(page.id)) add('record-unserved', page.id, `projected at ${page.route}, but no installed route serves it`);
      const module = path.join(site, page.module ?? '');
      if (!page.module || !fs.existsSync(module) || fs.readFileSync(module, 'utf8').split('\n', 1)[0] !== NEXT_ROUTE_MARKER) add('record-unserved', page.id, `its page module ${page.module ?? '(none)'} is missing or not installed by Publisher`);
    }
    const modules = new Set([...pages.values()].map(page => page.module));
    if (projection.state?.module) modules.add(projection.state.module); else if (fs.existsSync(projectionFile)) add('not-projected', 'projection.state', 'the states module mounts no projected state page');
    for (const file of walkRelative(path.join(site, 'clossys/pages'))) if (!modules.has(`clossys/pages/${file}`)) add('route-unpublished', at(`clossys/pages/${file}`), 'is a page module no projected page owns');

    // The shell: the root layout and every state, installed and mounting the publication's document or state.
    const shellFiles = new Map(NEXT_SHELL_FILES.map(shell => [shell.file, shell]));
    const others = walkRelative(path.join(site, 'app')).filter(file => SITE_ROUTER_FILE(file) && path.posix.basename(file) !== 'page.tsx');
    for (const name of others) {
      const shell = shellFiles.get(name);
      const text = fs.readFileSync(path.join(site, 'app', name), 'utf8');
      if (!shell) { add('route-unpublished', at(`app/${name}`), 'is an App Router file no publication installs'); continue; }
      if (text.split('\n', 1)[0] !== NEXT_ROUTE_MARKER) add('shell-unpublished', at(`app/${name}`), `the publication's ${shell.state} is not installed by Publisher`);
      else if (!shellMount(shell).test(text)) add('shell-unpublished', at(`app/${name}`), `mounts something other than the publication's ${shell.state}`);
    }
    for (const shell of NEXT_SHELL_FILES) if (!others.includes(shell.file)) add('shell-unpublished', at(`app/${shell.file}`), `the publication's ${shell.state} has no installed file, so Next's built-in one renders`);

    // Every path a page module links, against the projected routes.
    let links = 0;
    for (const module of modules) {
      const file = path.join(site, module);
      if (!fs.existsSync(file)) continue;
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/"href":\s*"(\/[^"]*)"/g)) {
        links += 1;
        if (!routesServed.has(match[1].split(/[?#]/)[0])) add('link-unpublished', at(module), `links ${match[1]}, which is no projected route`);
      }
    }
    return { findings, routes: routes.length + others.length, links };
  } finally {
    fs.rmSync(install.scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--root');
  const root = at >= 0 ? path.resolve(args[at + 1]) : REPOSITORY_ROOT;
  const surfaceAt = args.indexOf('--surface');
  const surface = surfaceAt >= 0 ? args[surfaceAt + 1] : 'all';
  if (!['all', 'studio', 'site-template'].includes(surface)) throw new Error(`routes-published: --surface is studio or site-template, not ${surface}`);
  const results = {};
  if (surface !== 'site-template') results.studio = checkRoutesPublished(root);
  if (surface !== 'studio') results['site-template'] = await checkSiteTemplateRoutesPublished({ root });
  const findings = Object.values(results).flatMap(result => result.findings);
  if (args.includes('--json')) console.log(JSON.stringify(surface === 'studio' ? results.studio : results, null, 2));
  else {
    for (const finding of findings) console.log(`${finding.rule}  ${finding.where}  ${finding.message}`);
    for (const [name, result] of Object.entries(results)) if (!result.findings.length) console.log(`routes-published: ${name} OK (${result.routes} installed routes, ${result.links} links, all published)`);
    if (findings.length) console.log(`routes-published: ${findings.length} finding(s)`);
  }
  process.exit(findings.length ? 1 : 0);
}
