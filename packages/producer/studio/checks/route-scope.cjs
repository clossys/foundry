'use strict';
// Which Studio routes the final checks render and screenshot (owner, clossys/workspace#46
// issuecomment-6840407560). studio:check renders every route once (desktop light) and Designer slot
// pages in every variant; capture shoots Designer slot pages plus routes whose inputs changed since
// the last green capture. Inputs: the records and candidates a route uses, plus the Studio build.
// No last green state, or a changed build, frame or checker, selects everything. Check semantics
// (what fails, scanners, allowlists, baselines) are not decided here; only the set of routes.

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = 'clossys.studio-route-inputs/1';
/** Top-level entries of packages/producer/studio that are not Studio build source. */
const NOT_BUILD = new Set(['.next', 'node_modules', 'checks', 'compile.lock.json', 'tsconfig.tsbuildinfo', 'next-env.d.ts']);
/** Build output and installed packages are never source, at any depth. */
const NOT_SOURCE = new Set(['.next', 'node_modules']);
function buildPaths(repositoryRoot) {
  let entries = [];
  try { entries = fs.readdirSync(path.join(repositoryRoot, 'packages/producer/studio')); } catch {}
  return [...entries.filter(name => !NOT_BUILD.has(name)).map(name => `packages/producer/studio/${name}`), 'packages/producer/src', 'packages/producer/package.json', 'package-lock.json'];
}

/** A Designer slot page: a leaf under /designer/** (one slot's candidates and specimens). */
function isDesignerSlotRoute(route, leaves) {
  return route.startsWith('/designer/') && leaves.has(route);
}

/**
 * The studio:check render matrix. Every route once at desktop light; Designer slot pages at every
 * viewport and theme. `full` restores every route at every viewport and theme.
 */
function studioCheckMatrix(routes, { leaves = [], variants, themes = ['light', 'dark'], full = false } = {}) {
  const leafSet = new Set(leaves);
  const jobs = [];
  for (const variant of variants) for (const theme of themes) for (const route of routes) {
    const first = variant === variants[0] && theme === themes[0];
    if (first || full || isDesignerSlotRoute(route, leafSet)) jobs.push({ route, variant, theme });
  }
  return jobs;
}

function walk(root, out = [], base = root, skip = new Set()) {
  let items;
  try { items = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
    if (skip.has(item.name) || item.isSymbolicLink()) continue;
    const file = path.join(root, item.name);
    if (item.isDirectory()) walk(file, out, base, skip);
    else if (item.isFile()) out.push(file);
  }
  return out;
}
/** sha256 over sorted (relative path, bytes); a missing path digests as its absence. */
function digestPaths(repositoryRoot, paths, skip = NOT_SOURCE) {
  const hash = createHash('sha256');
  for (const entry of [...new Set(paths)].sort()) {
    const absolute = path.join(repositoryRoot, entry);
    const files = fs.existsSync(absolute) ? (fs.statSync(absolute).isDirectory() ? walk(absolute, [], absolute, skip) : [absolute]) : [];
    hash.update(`${entry}\0${files.length}\0`);
    for (const file of files) hash.update(`${path.relative(repositoryRoot, file)}\0`).update(fs.readFileSync(file)).update('\0');
  }
  return hash.digest('hex');
}
function slotDir(repositoryRoot, agents, route, slot) {
  const own = route.split('/')[1];
  for (const agent of [own, ...agents.filter(name => name !== own)]) {
    const dir = `clossys/agents/${agent}/${slot}`;
    if (agent && fs.existsSync(path.join(repositoryRoot, dir))) return dir;
  }
  return undefined;
}

/**
 * Per-route input digests and the global digests (build, frame, checker) for a Studio map. A route
 * whose inputs cannot be resolved gets `null` and is always selected.
 */
function routeInputs({ repositoryRoot, map, checker = [] }) {
  let agents = [];
  try { agents = fs.readdirSync(path.join(repositoryRoot, 'clossys/agents')).sort(); } catch {}
  const pages = new Map((map.pages ?? []).map(page => [page.id, page]));
  const byPath = new Map((map.pages ?? []).map(page => [page.path, page]));
  const leavesOf = new Map();
  for (const leaf of map.leaves ?? []) leavesOf.set(leaf.page, [...(leavesOf.get(leaf.page) ?? []), leaf]);
  const sources = new Map();
  const pageSources = (page, seen = new Set()) => {
    if (!page || seen.has(page.id)) return [];
    seen.add(page.id);
    const loader = page.data?.loader;
    if (loader === 'home') return ['clossys/agents'];
    if (loader === 'pipeline') return ['clossys/agents', 'packages/producer/pipeline'];
    if (loader !== 'slot-groups' && loader !== 'empty') return null;
    const list = [];
    for (const slot of [page.frameId, ...(page.sectionIds ?? [])].filter(Boolean)) {
      const dir = slotDir(repositoryRoot, agents, '/designer', slot);
      if (!dir) return null;
      list.push(dir);
    }
    for (const leaf of leavesOf.get(page.id) ?? []) {
      const dir = slotDir(repositoryRoot, agents, leaf.path, leaf.slug);
      if (!dir) return null;
      list.push(dir);
    }
    // A group page lands on its first tab and shows that tab.
    const landing = map.landings?.[page.id];
    if (landing && landing !== page.path) {
      const more = pageSources(byPath.get(landing), seen);
      if (!more) return null;
      list.push(...more);
    }
    return list;
  };
  for (const route of map.routes ?? []) sources.set(route.path, pageSources(byPath.get(route.path) ?? pages.get(route.instanceId)));
  for (const leaf of map.leaves ?? []) {
    if (sources.has(leaf.path)) continue;
    const dir = slotDir(repositoryRoot, agents, leaf.path, leaf.slug);
    sources.set(leaf.path, dir ? [dir] : null);
  }
  const routes = {};
  for (const [route, list] of sources) routes[route] = list ? digestPaths(repositoryRoot, list) : null;
  const frames = [...new Set((map.pages ?? []).map(page => page.frameId).filter(Boolean))].map(frame => slotDir(repositoryRoot, agents, '/designer', frame) ?? `clossys/agents/designer/${frame}`);
  return {
    schema: SCHEMA,
    global: {
      build: digestPaths(repositoryRoot, buildPaths(repositoryRoot), NOT_SOURCE),
      frame: digestPaths(repositoryRoot, frames),
      checker: digestPaths(repositoryRoot, checker),
    },
    routes,
  };
}

/**
 * Routes whose inputs changed since `last` (the last green state). Everything is changed when there
 * is no last state, or its schema, build, frame or checker differs.
 */
function changedRoutes(current, last, routes) {
  if (!last || last.schema !== current.schema) return { all: true, reason: 'no previous green run', changed: [...routes] };
  for (const key of ['build', 'frame', 'checker']) if (last.global?.[key] !== current.global[key]) return { all: true, reason: `${key} changed`, changed: [...routes] };
  const changed = routes.filter(route => current.routes[route] == null || last.routes?.[route] !== current.routes[route]);
  return { all: false, reason: 'inputs compared with the last green run', changed };
}

/** Changed routes first, each group in its given order; failure semantics are unaffected. */
function changedFirst(routes, changed) {
  const set = new Set(changed);
  return [...routes.filter(route => set.has(route)), ...routes.filter(route => !set.has(route))];
}

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
}

module.exports = { SCHEMA, isDesignerSlotRoute, studioCheckMatrix, routeInputs, changedRoutes, changedFirst, digestPaths, readState };
