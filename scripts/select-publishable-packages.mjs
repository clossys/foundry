#!/usr/bin/env node
// Select the packages a merged commit is allowed to publish.
//
// A changed package manifest is not automatically a publish request. A
// removal is a lifecycle operation, not an npm publication, and a source-only
// edit must not reuse an existing version. The current manifest is therefore
// read only after proving that it still exists at HEAD.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function packageDirectory(path) {
  const match = /^packages\/([^/]+)\/package\.json$/.exec(path);
  return match?.[1] ?? null;
}

/**
 * Returns newly added package manifests and manifests whose version changed,
 * in first-party dependency order. Deleted manifests are intentionally
 * ignored: there is no current package to publish.
 */
export function selectPublishablePackages({ changedPaths, currentManifest, previousManifest, manifestExists }) {
  const selected = [];

  for (const path of changedPaths) {
    const directory = packageDirectory(path);
    if (directory === null || !manifestExists(path)) continue;

    const current = currentManifest(path);
    let previous;
    try {
      previous = previousManifest(path);
    } catch {
      selected.push({ directory, manifest: current });
      continue;
    }
    if (previous.version !== current.version) selected.push({ directory, manifest: current });
  }

  const manifests = new Map(selected.map(({ directory, manifest }) => [manifest.name, { directory, manifest }]));
  const pending = new Set(manifests.keys());
  const ordered = [];
  while (pending.size > 0) {
    const ready = [...pending]
      .filter((name) => {
        const dependencies = manifests.get(name).manifest.dependencies ?? {};
        return !Object.keys(dependencies).some((dependency) => pending.has(dependency));
      })
      .sort();
    if (ready.length === 0) {
      throw new Error(`cannot publish a cyclic first-party dependency set: ${[...pending].sort().join(", ")}`);
    }
    for (const name of ready) {
      pending.delete(name);
      ordered.push({ package: manifests.get(name).directory });
    }
  }
  return ordered;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function main() {
  const [before, head] = process.argv.slice(2);
  if (!before || !head) {
    throw new Error("usage: select-publishable-packages.mjs <before> <head>");
  }
  const changedPaths = git(["diff", "--name-only", before, head, "--", "packages"])
    .split("\n")
    .filter((path) => packageDirectory(path) !== null);
  const packages = selectPublishablePackages({
    changedPaths,
    manifestExists: existsSync,
    currentManifest: (path) => JSON.parse(readFileSync(path, "utf8")),
    previousManifest: (path) => JSON.parse(git(["show", `${before}:${path}`])),
  });
  process.stdout.write(`${JSON.stringify(packages)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
