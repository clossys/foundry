#!/usr/bin/env node
// Apply the one-way registry notices for the package-process consolidation.
// This has no package-name, message, version, or registry command-line
// options: its only caller-selected value is whether it reports or applies the
// reviewed, fixed plan below.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const LEGACY_DEPRECATIONS = Object.freeze([
  { directory: "catalog", subpath: "catalog" },
  { directory: "gates", subpath: "gates" },
  { directory: "release", subpath: "release" },
  { directory: "repository", subpath: "repository" },
  { directory: "review", subpath: "review" },
]);

export function legacyDeprecationPlan(scope) {
  if (!/^@[a-z0-9][a-z0-9._-]*$/.test(scope)) {
    throw new Error("legacy deprecation: package-scope.json must contain an npm scope");
  }
  return LEGACY_DEPRECATIONS.map(({ directory, subpath }) => ({
    directory,
    packageName: `${scope}/${directory}`,
    message: `Deprecated: use ${scope}/governance/${subpath} instead.`,
  }));
}

export function deprecationTarget(packageName, version) {
  if (typeof version !== "string" || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)) {
    throw new Error(`legacy deprecation: registry returned an unsafe version for ${packageName}`);
  }
  return `${packageName}@${version}`;
}

function npm(args, { allowEmpty = false } = {}) {
  const output = execFileSync("npm", args, {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
  if (!allowEmpty && output.length === 0) {
    throw new Error(`legacy deprecation: npm ${args[0]} returned no output`);
  }
  return output;
}

function versionsFor(packageName, registry) {
  const parsed = JSON.parse(npm(["view", packageName, "versions", "--json", `--registry=${registry}`]));
  const versions = (Array.isArray(parsed) ? parsed : [parsed]).sort((left, right) => left.localeCompare(right, "en"));
  if (versions.length === 0 || versions.some((version) => typeof version !== "string" || version.length === 0)) {
    throw new Error(`legacy deprecation: registry returned no usable versions for ${packageName}`);
  }
  return versions;
}

function deprecationFor(packageName, version, registry) {
  return npm(["view", `${packageName}@${version}`, "deprecated", `--registry=${registry}`], { allowEmpty: true });
}

function assertCompatibilityManifest(directory, scope) {
  const manifest = JSON.parse(readFileSync(`packages/${directory}/package.json`, "utf8"));
  const expectedName = `${scope}/${directory}`;
  if (manifest.name !== expectedName || manifest.dependencies?.[`${scope}/governance`] !== "^0.2.0") {
    throw new Error(`legacy deprecation: ${directory} is not the reviewed ${expectedName} compatibility wrapper`);
  }
}

function readRegistryState(plan, registry) {
  return plan.map((entry) => ({
    ...entry,
    versions: versionsFor(entry.packageName, registry).map((version) => ({
      version,
      deprecated: deprecationFor(entry.packageName, version, registry),
    })),
  }));
}

function assertSafeToApply(state) {
  for (const entry of state) {
    for (const version of entry.versions) {
      if (version.deprecated.length > 0 && version.deprecated !== entry.message) {
        throw new Error(`legacy deprecation: refusing to replace ${entry.packageName}@${version.version}'s existing notice`);
      }
    }
  }
}

function assertApplied(state) {
  for (const entry of state) {
    for (const version of entry.versions) {
      if (version.deprecated !== entry.message) {
        throw new Error(`legacy deprecation: ${entry.packageName}@${version.version} did not report the expected notice after apply`);
      }
    }
  }
}

function printState(label, state) {
  for (const entry of state) {
    for (const version of entry.versions) {
      console.log(`${label} ${entry.packageName}@${version.version}: ${version.deprecated || "<none>"}`);
    }
  }
}

export function parseMode(argv) {
  const [argument] = argv;
  if (!argument?.startsWith("--mode=")) {
    throw new Error("usage: deprecate-legacy-packages.mjs --mode=dry-run|apply");
  }
  const mode = argument.slice("--mode=".length);
  if ((mode !== "dry-run" && mode !== "apply") || argv.length !== 1) {
    throw new Error("usage: deprecate-legacy-packages.mjs --mode=dry-run|apply");
  }
  return mode;
}

function main() {
  const mode = parseMode(process.argv.slice(2));
  const { scope, registry } = JSON.parse(readFileSync("package-scope.json", "utf8"));
  if (typeof registry !== "string" || new URL(registry).protocol !== "https:") {
    throw new Error("legacy deprecation: package-scope.json must contain an HTTPS registry");
  }
  const plan = legacyDeprecationPlan(scope);
  for (const entry of plan) assertCompatibilityManifest(entry.directory, scope);
  const before = readRegistryState(plan, registry);
  assertSafeToApply(before);
  printState("before", before);
  if (mode === "dry-run") {
    console.log("dry-run: no registry metadata changed");
    return;
  }
  for (const entry of before) {
    for (const { version } of entry.versions) {
      npm(["deprecate", deprecationTarget(entry.packageName, version), entry.message, `--registry=${registry}`], { allowEmpty: true });
    }
  }
  const after = readRegistryState(plan, registry);
  assertApplied(after);
  printState("after", after);
  console.log("legacy deprecation: all registry notices verified");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
