/**
 * What the review builds and which tests it runs. The build set is the changed packages plus the first-party packages
 * they need built first in a fresh tree (manifest edges and a package's test-dist-closure.json), in dependency order.
 * The test set is every touched test file plus every test file that reaches a changed module through the static
 * import graph, transitively and across packages (`import`, `export ... from`, `import()` and `require()` of a
 * relative path or of a workspace package by name).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix, relative } from "node:path";

export interface Workspace { readonly dir: string; readonly name: string; readonly manifest: Manifest }
export interface Manifest { name?: string; workspaces?: string[] | { packages?: string[] }; scripts?: Record<string, string>; [field: string]: unknown }

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
export const TEST_FILE = /\.test\.(?:ts|tsx|mts|cts|mjs|cjs|js)$/;
export const SOURCE_FILE = /\.(?:ts|tsx|mts|cts|mjs|cjs|js)$/;
/** Type declarations: no runtime code, so no test or mutant covers them (tsc does). */
export const DECLARATION_FILE = /\.d\.(?:ts|mts|cts)$/;
/** A changed file the tests and mutation steps treat as code. */
export const isSource = (file: string) => SOURCE_FILE.test(file) && !TEST_FILE.test(file) && !DECLARATION_FILE.test(file);

const readJson = (file: string): Manifest => JSON.parse(readFileSync(file, "utf8")) as Manifest;

/** The root manifest's workspaces (`dir/*` or literal dirs), sorted by dir. */
export function listWorkspaces(tree: string): Workspace[] {
  if (!existsSync(join(tree, "package.json"))) return [];
  const root = readJson(join(tree, "package.json"));
  const patterns = Array.isArray(root.workspaces) ? root.workspaces : root.workspaces?.packages ?? [];
  const dirs = new Set<string>();
  for (const pattern of patterns) {
    if (pattern.endsWith("/*")) {
      const parent = pattern.slice(0, -2);
      if (existsSync(join(tree, parent))) for (const entry of readdirSync(join(tree, parent), { withFileTypes: true })) if (entry.isDirectory()) dirs.add(`${parent}/${entry.name}`);
    } else dirs.add(pattern.replace(/\/$/, ""));
  }
  return [...dirs].sort().filter(dir => existsSync(join(tree, dir, "package.json"))).map(dir => {
    const manifest = readJson(join(tree, dir, "package.json"));
    return { dir, name: manifest.name ?? dir, manifest };
  });
}

const known = (names: Iterable<string>, byName: Map<string, Workspace>, self: string) => [...names].filter(name => byName.has(name) && name !== self).sort();

/** Manifest edges: the first-party packages a workspace's build needs built first. */
const manifestEdges = (workspace: Workspace, byName: Map<string, Workspace>): string[] => {
  const names = new Set<string>();
  for (const field of DEPENDENCY_FIELDS) for (const name of Object.keys((workspace.manifest[field] as Record<string, string> | undefined) ?? {})) names.add(name);
  return known(names, byName, workspace.name);
};

/** test-dist-closure.json edges: packages whose build output the workspace's tests need; they never order the build. */
const closureEdges = (workspace: Workspace, byName: Map<string, Workspace>, tree: string): string[] => {
  const closure = join(tree, workspace.dir, "test-dist-closure.json");
  if (!existsSync(closure)) return [];
  const requires = (JSON.parse(readFileSync(closure, "utf8")) as { requires?: { builtBy?: string }[] }).requires ?? [];
  return known(requires.map(entry => entry.builtBy?.split(" ")[0] ?? ""), byName, workspace.name);
};

/**
 * The packages to build for targets (package dirs): targets, their manifest dependencies and the packages their tests
 * need built (test-dist-closure.json), each with its own dependencies, in manifest dependency order (as the root
 * topological build orders them: a closure edge adds a package to the set but never orders it).
 */
export function buildSet(tree: string, targets: readonly string[]): { order: Workspace[]; prerequisites: Set<string> } {
  const workspaces = listWorkspaces(tree);
  const byName = new Map(workspaces.map(workspace => [workspace.name, workspace]));
  const byDir = new Map(workspaces.map(workspace => [workspace.dir, workspace]));
  const wanted = new Set<string>();
  const want = (workspace: Workspace) => {
    if (wanted.has(workspace.dir)) return;
    wanted.add(workspace.dir);
    for (const name of [...manifestEdges(workspace, byName), ...closureEdges(workspace, byName, tree)]) want(byName.get(name)!);
  };
  for (const dir of [...targets].sort()) { const workspace = byDir.get(dir); if (workspace) want(workspace); }
  const order: Workspace[] = [], seen = new Set<string>();
  const visit = (workspace: Workspace, stack: Set<string>) => {
    if (seen.has(workspace.dir) || stack.has(workspace.dir)) return;
    stack.add(workspace.dir);
    for (const name of manifestEdges(workspace, byName)) visit(byName.get(name)!, stack);
    stack.delete(workspace.dir);
    seen.add(workspace.dir);
    order.push(workspace);
  };
  for (const dir of [...wanted].sort()) visit(byDir.get(dir)!, new Set());
  const prerequisites = new Set([...wanted].filter(dir => !targets.includes(dir)));
  return { order: order.filter(workspace => workspace.manifest.scripts?.build), prerequisites };
}

/** How one test file runs on its own: vitest for TypeScript tests in a vitest package, else node --test. */
export function testCommand(tree: string, pkg: string, file: string): { cwd: string; argv: string[] } {
  const rel = relative(pkg === "." ? "" : pkg, file);
  const cwd = join(tree, pkg);
  const manifest = existsSync(join(cwd, "package.json")) ? readJson(join(cwd, "package.json")) : {};
  const vitest = /\.(?:ts|tsx|mts|cts)$/.test(file) && JSON.stringify(manifest).includes("\"vitest\"");
  return { cwd, argv: vitest ? ["npx", "vitest", "run", rel] : [process.execPath, "--test", rel] };
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"'\s]+)["']/g;
const STEMS = (target: string) => {
  const stem = target.replace(/\.(?:js|mjs|cjs|jsx)$/, "");
  return [target, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`, `${target}.ts`, `${target}.tsx`, `${target}.js`, `${target}.mjs`, `${target}/index.ts`, `${target}/index.tsx`, `${target}/index.js`, `${target}/index.mjs`];
};
/** A path into build output also names its source: `<pkg>/dist/a/b.js` is `<pkg>/src/a/b.ts` (the tsc rootDir layout). */
const sourceOf = (target: string) => /(^|\/)dist\//.test(target) ? [target, target.replace(/(^|\/)dist\//, "$1src/")] : [target];

/** The export target of a workspace package for a subpath ("." or "./x"): conditions resolve import, default, require. */
export function exportTarget(manifest: Manifest, subpath: string): string | undefined {
  const pick = (entry: unknown): string | undefined => {
    if (typeof entry === "string") return entry;
    if (Array.isArray(entry)) return entry.map(pick).find(Boolean);
    if (entry && typeof entry === "object") {
      const conditions = entry as Record<string, unknown>;
      for (const key of ["import", "node", "default", "require"]) { const found = pick(conditions[key]); if (found) return found; }
    }
    return undefined;
  };
  const exports = manifest.exports as unknown;
  if (exports === undefined) return subpath === "." ? (typeof manifest.main === "string" ? manifest.main : "./index.js") : subpath;
  if (typeof exports === "string" || Array.isArray(exports)) return subpath === "." ? pick(exports) : undefined;
  const map = exports as Record<string, unknown>;
  if (!Object.keys(map).some(key => key.startsWith("."))) return subpath === "." ? pick(map) : undefined;
  if (subpath in map) return pick(map[subpath]);
  for (const [key, entry] of Object.entries(map)) {
    const star = key.indexOf("*");
    if (star < 0 || !subpath.startsWith(key.slice(0, star)) || !subpath.endsWith(key.slice(star + 1))) continue;
    const middle = subpath.slice(star, subpath.length - (key.length - star - 1));
    return pick(entry)?.replace("*", middle);
  }
  return undefined;
}

/** The import graph of a tree's tracked code: who imports each file, and the package nodes of unresolved package imports. */
export interface ImportGraph {
  /** file -> the files that import it; `<pkg dir>/*` -> the files importing that package by a subpath no file resolves. */
  readonly importers: Map<string, Set<string>>;
  readonly files: readonly string[];
}

/**
 * The import graph of tree's tracked source files. extra: files that are gone at the head (deleted or renamed away)
 * but are still graph nodes, so an importer left pointing at one is found.
 */
export function importGraph(tree: string, extra: readonly string[] = []): ImportGraph {
  const listed = spawnSync("git", ["ls-files", "-z"], { cwd: tree, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (listed.status !== 0) throw new Error(`git ls-files: ${String(listed.stderr).trim()}`);
  const files = listed.stdout.split("\0").filter(file => file && SOURCE_FILE.test(file));
  const known = new Set([...files, ...extra]);
  const workspaces = listWorkspaces(tree).sort((a, b) => b.name.length - a.name.length);
  const importers = new Map<string, Set<string>>();
  const edge = (target: string, from: string) => { if (target === from) return; let set = importers.get(target); if (!set) importers.set(target, set = new Set()); set.add(from); };
  const resolveIn = (target: string) => { for (const path of sourceOf(target)) for (const candidate of STEMS(path)) if (known.has(candidate)) return candidate; return undefined; };
  for (const file of files) {
    let text: string;
    try { text = readFileSync(join(tree, file), "utf8"); } catch { continue; }
    for (const match of text.matchAll(SPECIFIER)) {
      const spec = match[1]!;
      if (spec.startsWith("./") || spec.startsWith("../")) {
        const found = resolveIn(posix.normalize(posix.join(posix.dirname(file), spec)));
        if (found) edge(found, file);
        continue;
      }
      const workspace = workspaces.find(item => spec === item.name || spec.startsWith(`${item.name}/`));
      if (!workspace) continue;
      const target = exportTarget(workspace.manifest, spec === workspace.name ? "." : `.${spec.slice(workspace.name.length)}`);
      const found = target === undefined ? undefined : resolveIn(posix.normalize(posix.join(workspace.dir, target)));
      edge(found ?? `${workspace.dir}/*`, file);
    }
  }
  return { importers, files };
}

export interface Covering {
  /** Every test to run: the touched tests and every test reaching a changed or deleted source, sorted. */
  readonly all: string[];
  /** For each changed source at the head: the tests in its own package that reach it, nearest first (mutation runs these). */
  readonly bySource: Map<string, string[]>;
  /** Changed sources at the head that no test reaches, in any package. */
  readonly uncovered: string[];
}

/**
 * The tests covering a change: touched tests, plus every test that reaches a changed source (or a deleted one, through
 * an importer still pointing at it) through the import graph, transitively and across packages. A test reaching a
 * package by a subpath no file resolves counts as reaching every source of that package.
 */
export function coveringTests(tree: string, changes: readonly { readonly path: string; readonly status: string; readonly from?: string }[], packageOf: (file: string) => string): Covering {
  const gone = [...new Set(changes.flatMap(change => [...(change.status === "D" ? [change.path] : []), ...(change.from && change.status === "R" ? [change.from] : [])]))].filter(isSource);
  const graph = importGraph(tree, gone);
  const all = new Set(changes.map(change => change.path).filter(file => TEST_FILE.test(file) && existsSync(join(tree, file))));
  const bySource = new Map<string, string[]>();
  const uncovered: string[] = [];
  const reach = (start: string) => {
    const depth = new Map<string, number>([[start, 0], [`${packageOf(start)}/*`, 0]]);
    const queue = [start, `${packageOf(start)}/*`];
    for (let index = 0; index < queue.length; index++) {
      const node = queue[index]!;
      for (const from of graph.importers.get(node) ?? []) if (!depth.has(from)) { depth.set(from, depth.get(node)! + 1); queue.push(from); }
    }
    return [...depth].filter(([file]) => TEST_FILE.test(file) && file !== start).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  };
  for (const source of gone) for (const [test] of reach(source)) all.add(test);
  for (const change of changes) {
    const source = change.path;
    if (change.status === "D" || !isSource(source) || !existsSync(join(tree, source))) continue;
    const tests = reach(source);
    // A touched test beside the source (foo.ts / foo.test.ts) covers it even when it reaches it indirectly.
    const sibling = source.replace(SOURCE_FILE, match => `.test${match}`);
    if (all.has(sibling) && !tests.some(([test]) => test === sibling)) tests.unshift([sibling, 0]);
    for (const [test] of tests) all.add(test);
    if (!tests.length) uncovered.push(source);
    bySource.set(source, tests.filter(([test]) => packageOf(test) === packageOf(source)).map(([test]) => test));
  }
  return { all: [...all].sort(), bySource, uncovered: uncovered.sort() };
}
