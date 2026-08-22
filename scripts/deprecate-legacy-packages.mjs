#!/usr/bin/env node
// Apply the one-way registry deprecation notices for every package name this
// repository has renamed or retired.
//
//   node scripts/deprecate-legacy-packages.mjs --mode=dry-run|apply
//
// Its only caller-selected value is whether it reports or applies. The PLAN
// itself is not a caller input and is not a list maintained here: it is
// derived from docs/contracts/package-lifecycle.json's own "deprecated"
// entries and their declared `replacement`.
//
// WHY THE PLAN IS DERIVED AND NOT HARD-CODED
// ------------------------------------------
// It used to be a frozen five-entry array pointing at `governance` subpaths,
// written when exactly five compatibility packages existed. Decision 9's recut
// then renamed eight more names and retired those five, and every one of the
// hard-coded five pointed at a package that no longer exists — so running this
// script would have written a registry notice directing consumers to a name
// they cannot install. A one-way, irreversible action derived from a stale
// literal is the worst shape available: it fails closed nowhere and publishes
// a wrong answer permanently.
//
// The lifecycle document already had to be correct for `check:package-governance`
// to pass, so it is the one source that cannot silently drift from reality.
// Deriving from it means a future rename needs no edit here at all.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LIFECYCLE_PATH = "docs/contracts/package-lifecycle.json";

/**
 * Build the deprecation plan from the lifecycle document.
 *
 * Every "deprecated" entry must name a `replacement`; one that does not is a
 * hard error rather than a skipped row, because a deprecation notice with no
 * migration target is precisely the "blocked forever, nobody told" state this
 * repository keeps rediscovering.
 *
 * An EMPTY plan is valid and returns `[]`. This guard used to throw on it, on
 * the reasoning that "an empty apply is never intended" -- true of an apply
 * that was MEANT to do something, but it conflated two different states. Zero
 * deprecated entries is now reachable, and is in fact the desired steady state:
 * it means nothing is mid-supersession. Foundry reached it the day the last
 * five donors retired, and this script immediately failed `npm run check` for
 * every contributor, on a green tree, for being in the state it wanted.
 *
 * The distinction the guard actually needed is document-level, and is enforced
 * above: a contract that cannot be read, or that declares no packages at all,
 * is a misconfiguration. A readable contract with real entries and none of them
 * deprecated is a finished migration.
 */
export function deprecationPlanFrom(lifecycle, scope) {
  if (!/^@[a-z0-9][a-z0-9._-]*$/.test(scope)) {
    throw new Error("legacy deprecation: package-scope.json must contain an npm scope");
  }
  if (!lifecycle || !Array.isArray(lifecycle.packages)) {
    throw new Error(`legacy deprecation: ${LIFECYCLE_PATH} does not have the expected { packages: [...] } shape`);
  }
  // An empty `packages` array is a misconfiguration: this repository always
  // ships packages, so a document that declares none was not read from the
  // contract this script means to read. Zero DEPRECATED entries among real
  // ones is a different thing entirely -- see deprecationPlanFrom's header.
  if (lifecycle.packages.length === 0) {
    throw new Error(`legacy deprecation: ${LIFECYCLE_PATH} declares no packages at all — refusing to treat an empty contract as "nothing to deprecate"`);
  }
  const plan = [];
  for (const entry of lifecycle.packages) {
    if (!entry || entry.status !== "deprecated") continue;
    const packageName = entry.name;
    if (typeof packageName !== "string" || !packageName.startsWith(`${scope}/`)) {
      throw new Error(`legacy deprecation: deprecated entry ${JSON.stringify(packageName)} is not in scope ${scope}`);
    }
    const replacement = entry.replacement?.name;
    if (typeof replacement !== "string" || replacement.length === 0) {
      throw new Error(
        `legacy deprecation: ${packageName} is deprecated with no replacement.name — refusing to write a registry notice ` +
          `that tells a consumer something is deprecated without telling them what to use instead.`,
      );
    }
    plan.push({
      directory: packageName.slice(scope.length + 1),
      packageName,
      replacement,
      message: `Deprecated: use ${replacement} instead.`,
    });
  }
  return plan.sort((left, right) => left.packageName.localeCompare(right.packageName, "en"));
}

/**
 * A replacement must be a package this repository actually ships now.
 *
 * The predecessor of this check asserted the OLD package's directory still
 * existed as a compatibility wrapper. That is the wrong end to check once a
 * rename removes the old directory entirely: what a consumer needs is for the
 * name the notice points AT to be real.
 */
export function assertReplacementIsShipped(entry, catalogNames) {
  if (!catalogNames.has(entry.replacement)) {
    throw new Error(
      `legacy deprecation: ${entry.packageName}'s replacement ${entry.replacement} is not a package in this workspace — ` +
        `refusing to publish a permanent notice pointing at a name that does not ship.`,
    );
  }
}

/**
 * The package names this workspace actually ships right now, read from
 * packages/ rather than from any document that claims to describe it.
 */
export function shippedPackageNames(root = ".") {
  const names = new Set();
  const dir = `${root}/packages`;
  if (!existsSync(dir)) return names;
  for (const child of readdirSync(dir, { withFileTypes: true })) {
    if (!child.isDirectory()) continue;
    const manifestPath = `${dir}/${child.name}/package.json`;
    if (!existsSync(manifestPath)) continue;
    const name = JSON.parse(readFileSync(manifestPath, "utf8")).name;
    if (typeof name === "string" && name.length > 0) names.add(name);
  }
  return names;
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
  const lifecycle = JSON.parse(readFileSync(LIFECYCLE_PATH, "utf8"));
  const plan = deprecationPlanFrom(lifecycle, scope);
  if (plan.length === 0) {
    console.log(`legacy deprecation: ${LIFECYCLE_PATH} declares no deprecated packages — nothing to deprecate`);
    return;
  }
  const shipped = shippedPackageNames();
  for (const entry of plan) assertReplacementIsShipped(entry, shipped);
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
