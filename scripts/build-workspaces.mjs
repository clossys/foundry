#!/usr/bin/env node
// build-workspaces — run every workspace's `build` script in dependency order.
//
//   node scripts/build-workspaces.mjs           build all workspaces, dependencies first
//   node scripts/build-workspaces.mjs --print   print the order and exit
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

import { existsSync, readFileSync, readdirSync } from "node:fs";
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

function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--print")) {
    console.error("usage: build-workspaces.mjs [--print]");
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
  for (const workspace of order) {
    if (!workspace.manifest.scripts?.build) continue;
    // Select by name, not path: npm's path filter also selects nested
    // workspaces (packages/designer would pull in packages/designer/ui).
    const result = spawnSync(npm, ["run", "build", `--workspace=${workspace.manifest.name}`], { cwd: root, stdio: "inherit" });
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
