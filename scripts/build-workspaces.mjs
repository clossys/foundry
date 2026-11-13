#!/usr/bin/env node
// build-workspaces — run every workspace's `build` script in dependency order.
//
//   node scripts/build-workspaces.mjs           build all workspaces, dependencies first (incremental)
//   node scripts/build-workspaces.mjs --force   drop the build caches and run every workspace's own
//                                               `build` script unchanged (the clean, non-incremental path)
//   node scripts/build-workspaces.mjs --print   print the order and exit
//
// Incremental by default, with byte-identical output: in each workspace's `build` script the
// `tsc -p tsconfig.json` step runs through scripts/tsc-incremental.mjs (tsc --incremental, its
// build info and an emitted-file manifest kept under node_modules/.cache/incremental-build/), and
// publisher's `npm run check:client-boundary` step runs through scripts/check-client-boundary-cached.mjs,
// which re-runs the unchanged check unless every one of its inputs is byte-identical to its last PASS.
// Every other step runs exactly as written. The manifests are not edited (a scripts change there is
// a packed-content change), so the substitution lives here. CLOSSYS_BUILD_FORCE=1 also forces both.
//
// `npm run build --workspaces` visits workspaces in discovery (alphabetical)
// order, so a package that sorts before a first-party dependency compiles
// against declarations that do not exist yet on a fresh clone. A hand-kept
// "build these first" list only holds until the next new edge: designer
// gained an import of @clossys/director and the list built it first anyway.
// This script derives the order from the manifests instead, so it cannot drift.
//
// Edges: any dependencies / devDependencies / peerDependencies /
// optionalDependencies entry naming another workspace. Ties break by
// workspace path, so the order is deterministic. A cycle is an error (exit 2).
// Dependency-free on purpose: it runs before anything is built.

import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/** Expand the root manifest's `workspaces` patterns (`dir/*` or a literal dir). */
export function listWorkspaces(root) {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const patterns = Array.isArray(manifest.workspaces) ? manifest.workspaces : manifest.workspaces?.packages ?? [];
  const dirs = new Set();
  for (const pattern of patterns) {
    if (pattern.endsWith("/*")) {
      const parent = pattern.slice(0, -2);
      if (!existsSync(join(root, parent))) continue;
      for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
        if (entry.isDirectory()) dirs.add(`${parent}/${entry.name}`);
      }
    } else if (pattern.includes("*")) {
      throw new Error(`unsupported workspace pattern: ${pattern}`);
    } else {
      dirs.add(pattern.replace(/\/$/, ""));
    }
  }
  const workspaces = [];
  for (const dir of [...dirs].sort()) {
    const file = join(root, dir, "package.json");
    if (!existsSync(file)) continue;
    workspaces.push({ dir, manifest: JSON.parse(readFileSync(file, "utf8")) });
  }
  return workspaces;
}

/** Kahn's algorithm over first-party edges; ties broken by workspace dir. */
export function buildOrder(workspaces) {
  const byName = new Map();
  for (const workspace of workspaces) {
    if (byName.has(workspace.manifest.name)) throw new Error(`duplicate workspace name: ${workspace.manifest.name}`);
    byName.set(workspace.manifest.name, workspace);
  }
  const pending = new Map();
  const dependents = new Map(workspaces.map((workspace) => [workspace.dir, []]));
  for (const workspace of workspaces) {
    const deps = new Set();
    for (const field of DEPENDENCY_FIELDS) {
      for (const name of Object.keys(workspace.manifest[field] ?? {})) {
        const dep = byName.get(name);
        if (dep && dep !== workspace) deps.add(dep.dir);
      }
    }
    pending.set(workspace.dir, deps.size);
    for (const dep of deps) dependents.get(dep).push(workspace.dir);
  }
  const ready = [...pending].filter(([, count]) => count === 0).map(([dir]) => dir).sort();
  const order = [];
  while (ready.length) {
    const dir = ready.shift();
    order.push(dir);
    for (const next of dependents.get(dir)) {
      pending.set(next, pending.get(next) - 1);
      if (pending.get(next) === 0) {
        ready.push(next);
        ready.sort();
      }
    }
  }
  if (order.length !== workspaces.length) {
    const stuck = [...pending].filter(([, count]) => count > 0).map(([dir]) => dir);
    throw new Error(`workspace dependency cycle among: ${stuck.join(", ")}`);
  }
  const byDir = new Map(workspaces.map((workspace) => [workspace.dir, workspace]));
  return order.map((dir) => byDir.get(dir));
}

/**
 * Workspaces whose `bin` the build makes linkable. `npm install` links a workspace bin only when its
 * target exists, and most targets are build output (the producer's `clossys` is dist/cli/index.js),
 * so on a fresh clone they are missing until they are linked after the build.
 */
export function binsToLink(order) {
  return order.filter((workspace) => workspace.manifest.scripts?.build && workspace.manifest.bin && Object.keys(workspace.manifest.bin).length).map((workspace) => workspace.manifest.name);
}

const TSC_STEP = "tsc -p tsconfig.json";
const BOUNDARY_STEP = /^npm run (check:client-boundary)$/;
const BOUNDARY_SCRIPT = /^node \.\.\/\.\.\/scripts\/check-client-boundary\.mjs( [^&|;]+)$/;

/**
 * The incremental form of a workspace's `build` script, or null when nothing in it has one (the
 * script then runs unchanged through `npm run build`). Only whole `&&` steps that are exactly
 * `tsc -p tsconfig.json`, or `npm run check:client-boundary` whose script is exactly the root
 * check, are replaced; a script with any other shell syntax than `&&` is never rewritten.
 */
export function incrementalBuildScript(manifest, root) {
  const build = manifest.scripts?.build;
  if (typeof build !== "string" || /[|;'"`$()<>\\]|\|\||&(?!&)/.test(build.replace(/&&/g, ""))) return null;
  let replaced = false;
  const steps = build.split("&&").map((step) => step.trim()).map((step) => {
    if (step === TSC_STEP) {
      replaced = true;
      return `node ${JSON.stringify(join(root, "scripts/tsc-incremental.mjs"))}`;
    }
    const boundary = BOUNDARY_STEP.exec(step);
    const check = boundary && BOUNDARY_SCRIPT.exec(manifest.scripts?.[boundary[1]] ?? "");
    if (check) {
      replaced = true;
      return `node ${JSON.stringify(join(root, "scripts/check-client-boundary-cached.mjs"))}${check[1]}`;
    }
    return step;
  });
  return replaced ? steps.join(" && ") : null;
}

function runBuild(npm, root, workspace, force) {
  const script = force ? null : incrementalBuildScript(workspace.manifest, root);
  if (!script) return spawnSync(npm, ["run", "build", `--workspace=${workspace.manifest.name}`], { cwd: root, stdio: "inherit" });
  // What `npm run` itself does: run the script with sh in the workspace, its and the root's .bin first on PATH.
  const cwd = join(root, workspace.dir);
  const PATH = [join(cwd, "node_modules/.bin"), join(root, "node_modules/.bin"), process.env.PATH].join(process.platform === "win32" ? ";" : ":");
  console.log(`\n> ${workspace.manifest.name} build (incremental)\n> ${script}\n`);
  return spawnSync("sh", ["-c", script], { cwd, stdio: "inherit", env: { ...process.env, PATH } });
}

function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--print" && arg !== "--force")) {
    console.error("usage: build-workspaces.mjs [--print | --force]");
    process.exit(2);
  }
  const root = resolve(fileURLToPath(import.meta.url), "../..");
  let order;
  try {
    order = buildOrder(listWorkspaces(root));
  } catch (error) {
    console.error(`build-workspaces: ${error.message}`);
    process.exit(2);
  }
  if (args.includes("--print")) {
    for (const workspace of order) console.log(workspace.dir);
    return;
  }
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const force = args.includes("--force") || process.env.CLOSSYS_BUILD_FORCE === "1";
  if (force) {
    rmSync(join(root, "node_modules/.cache/incremental-build"), { recursive: true, force: true });
    for (const workspace of order) {
      const check = workspace.manifest.scripts?.["check:client-boundary"];
      const report = check && / --report (\S+)$/.exec(check);
      if (report) rmSync(resolve(root, workspace.dir, report[1].replace(/\.json$/, ".stamp.json")), { force: true });
    }
  }
  const started = Date.now();
  for (const workspace of order) {
    if (!workspace.manifest.scripts?.build) continue;
    // Select by name, not path: npm's path filter also selects nested
    // workspaces (packages/designer would pull in packages/designer/ui).
    const begin = Date.now();
    const result = runBuild(npm, root, workspace, force);
    console.log(`build-workspaces: ${workspace.dir} ${result.status === 0 ? "built" : "FAILED"} in ${((Date.now() - begin) / 1000).toFixed(1)}s`);
    if (result.status !== 0) {
      console.error(`build-workspaces: ${workspace.dir} build failed (${result.status ?? result.signal})`);
      process.exit(result.status || 1);
    }
  }
  const link = binsToLink(order);
  if (link.length) {
    // --ignore-scripts: this only links the built bins into node_modules/.bin; it runs no install script.
    const result = spawnSync(npm, ["rebuild", "--ignore-scripts", ...link], { cwd: root, stdio: "inherit" });
    if (result.status !== 0) {
      console.error(`build-workspaces: linking the built bins failed (${result.status ?? result.signal})`);
      process.exit(result.status || 1);
    }
  }
  console.log(`build-workspaces: ${force ? "full" : "incremental"} build done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
