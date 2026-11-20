/**
 * What the review builds and which tests it runs. The build set is the changed packages plus the first-party packages
 * they need built first in a fresh tree (manifest edges and a package's test-dist-closure.json), in dependency order.
 * The test set is every touched test file plus every test file in a changed package that imports a changed module
 * (the static import graph, one level: `import`, `export ... from`, `import()` and `require()` of a relative path).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";

export interface Workspace { readonly dir: string; readonly name: string; readonly manifest: Manifest }
interface Manifest { name?: string; workspaces?: string[] | { packages?: string[] }; scripts?: Record<string, string>; [field: string]: unknown }

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
export const TEST_FILE = /\.test\.(?:ts|tsx|mts|cts|mjs|cjs|js)$/;
export const SOURCE_FILE = /\.(?:ts|tsx|mts|cts|mjs|cjs|js)$/;

const readJson = (file: string): Manifest => JSON.parse(readFileSync(file, "utf8")) as Manifest;

/** The root manifest's workspaces (`dir/*` or literal dirs), sorted by dir. */
export function listWorkspaces(tree: string): Workspace[] {
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

const edges = (workspace: Workspace, byName: Map<string, Workspace>, tree: string): string[] => {
  const names = new Set<string>();
  for (const field of DEPENDENCY_FIELDS) for (const name of Object.keys((workspace.manifest[field] as Record<string, string> | undefined) ?? {})) names.add(name);
  const closure = join(tree, workspace.dir, "test-dist-closure.json");
  if (existsSync(closure)) {
    for (const entry of (JSON.parse(readFileSync(closure, "utf8")) as { requires?: { builtBy?: string }[] }).requires ?? []) {
      const name = entry.builtBy?.split(" ")[0];
      if (name) names.add(name);
    }
  }
  return [...names].filter(name => byName.has(name) && name !== workspace.name);
};

/** The packages to build for targets (package dirs): targets plus their prerequisite closure, dependencies first. */
export function buildSet(tree: string, targets: readonly string[]): { order: Workspace[]; prerequisites: Set<string> } {
  const workspaces = listWorkspaces(tree);
  const byName = new Map(workspaces.map(workspace => [workspace.name, workspace]));
  const byDir = new Map(workspaces.map(workspace => [workspace.dir, workspace]));
  const order: Workspace[] = [], seen = new Set<string>(), prerequisites = new Set<string>();
  const visit = (workspace: Workspace, stack: Set<string>) => {
    if (seen.has(workspace.dir) || stack.has(workspace.dir)) return;
    stack.add(workspace.dir);
    for (const name of edges(workspace, byName, tree).sort()) visit(byName.get(name)!, stack);
    stack.delete(workspace.dir);
    seen.add(workspace.dir);
    order.push(workspace);
  };
  for (const dir of [...targets].sort()) { const workspace = byDir.get(dir); if (workspace) visit(workspace, new Set()); }
  for (const workspace of order) if (!targets.includes(workspace.dir)) prerequisites.add(workspace.dir);
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

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;

/** The repo-relative files a source file imports by relative path (`.js` resolved to the `.ts` beside it). */
export function relativeImports(tree: string, file: string): string[] {
  let text: string;
  try { text = readFileSync(join(tree, file), "utf8"); } catch { return []; }
  const out = new Set<string>();
  for (const match of text.matchAll(SPECIFIER)) {
    const target = posix.normalize(posix.join(posix.dirname(file), match[1]!));
    const stem = target.replace(/\.(?:js|mjs|cjs|jsx)$/, "");
    for (const candidate of [target, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`, `${target}.ts`, `${target}/index.ts`, `${target}/index.js`]) {
      if (existsSync(join(tree, candidate)) && statSync(join(tree, candidate)).isFile()) { out.add(candidate); break; }
    }
  }
  return [...out];
}

/** Every test file under dir (repo-relative), skipping dependencies and build output. */
export function testFiles(tree: string, dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(tree, rel), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
      const path = rel === "." ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) { if (!(rel === "." && entry.name === "packages")) walk(path); }
      else if (TEST_FILE.test(entry.name)) out.push(path);
    }
  };
  if (existsSync(join(tree, dir))) walk(dir);
  return out.sort();
}

/** The tests covering each changed source file: touched tests plus direct importers in the same package. */
export function coveringTests(tree: string, changed: readonly string[], packageOf: (file: string) => string): { all: string[]; bySource: Map<string, string[]> } {
  const all = new Set(changed.filter(file => TEST_FILE.test(file) && existsSync(join(tree, file))));
  const bySource = new Map<string, string[]>();
  const sources = changed.filter(file => SOURCE_FILE.test(file) && !TEST_FILE.test(file) && existsSync(join(tree, file)));
  const imports = new Map<string, string[]>();
  for (const pkg of new Set(sources.map(packageOf))) for (const test of testFiles(tree, pkg)) imports.set(test, relativeImports(tree, test));
  for (const source of sources) {
    const tests = [...imports].filter(([test, targets]) => packageOf(test) === packageOf(source) && targets.includes(source)).map(([test]) => test);
    // A touched test beside the source (foo.ts / foo.test.ts) covers it even when it reaches it indirectly.
    const sibling = source.replace(SOURCE_FILE, match => `.test${match}`);
    if (all.has(sibling) && !tests.includes(sibling)) tests.push(sibling);
    bySource.set(source, tests.sort());
    for (const test of tests) all.add(test);
  }
  return { all: [...all].sort(), bySource };
}

