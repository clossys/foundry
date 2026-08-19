#!/usr/bin/env node
// scripts/observation-bundle.mjs -- this repository publishes its own
// observation bundle per the transport its own builder package ships
// (packages/builder's `writeObservationBundle`), evaluated with its own
// controller package's repository-profile runner
// (`runRepositoryProfileCheck`, packages/controller/src/repository/run.ts).
//
// IN-WORKSPACE CONSUMPTION. This repository IS the producer of both
// packages, so this script consumes them the same way
// scripts/check-neutrality.mjs already established for a root-level script
// consuming a workspace package's compiled output: dynamically importing
// the BUILT `dist/` entry by relative path (never a registry install of
// this repository's own published packages, and never a bare
// `@vespeneventures/*` specifier -- root scripts here read a package's
// shipped artifact directly, the same artifact a real consumer receives).
//
// DISCOVERY IS THIS SCRIPT'S OWN JOB. `runRepositoryProfileCheck` performs
// zero I/O of its own (see its own header comment: "discovery is injected,
// not performed here") -- every consumer writes its own discovery glue.
// This mirrors exactly the discovery `check:repository-profile`'s own CLI
// wrapper (packages/controller/src/repository/cli.ts, via
// packages/controller/src/repository/locate.ts) already performs for the
// SAME declaration (governance/repository-profile.json), adapted to feed
// the richer three-state runner instead of the lighter validateRepositoryProfile
// boolean that CLI uses -- so the bundle's gate result carries the runner's
// full GateResult ternary, including a real machine-readable indeterminate
// reason, rather than reshaping a boolean.
//
// This is NOT a replacement for `check:repository-profile` (still this
// repository's own required gate, unchanged, still running
// packages/controller/dist/repository/bin.js in ci.yml's `build` job) --
// it is a second, richer evaluation of the SAME committed declaration,
// through the shared package's own newer, three-state runner.
//
// Only the canonical declaration location is considered here: a
// declaration parked anywhere else reads as `not-found` rather than a
// distinct non-canonical-location finding -- a simplification this
// script's own discovery makes deliberately, unlike
// packages/controller/src/repository/locate.ts's own fuller search.
//
// Zero clock reads: `producedAt` is always caller-supplied (a CLI flag),
// never `new Date()` inside this module.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = dirname(dirname(scriptPath));

// This plane's own id for foundry in vespeneventures/workspace's
// governance/repositories.json (the fleet registry vespeneventures/
// workspace#59's aggregator reads bundle `repository.id` against). Bare,
// no owner prefix -- matching every other entry in that registry, and kept
// bare here specifically so this file never reads as naming any other
// account or repository (this repository is a public, neutral producer;
// see scripts/check-foreign-references.mjs).
const DEFAULT_REPOSITORY_ID = "foundry";

const DECLARATION_RELATIVE_PATH = "governance/repository-profile.json";

function distEntryPath(repositoryRoot, packageRelativePath) {
  return join(repositoryRoot, packageRelativePath);
}

/**
 * Dynamically imports one package's built `dist/` entry by relative path,
 * matching scripts/check-neutrality.mjs's own established pattern for
 * consuming a workspace package's compiled artifact from a root script.
 * Fails loudly (never silently falls back to source) when the package has
 * not been built -- the same discipline check-neutrality.mjs documents in
 * its own header for the identical situation.
 */
async function importDistEntry(repositoryRoot, packageRelativePath, buildHint) {
  const distEntry = distEntryPath(repositoryRoot, packageRelativePath);
  if (!existsSync(distEntry)) {
    throw new Error(`${packageRelativePath} is missing -- build ${buildHint} first (npm run build). This script deliberately runs the built artifact rather than the source.`);
  }
  return import(pathToFileURL(distEntry).href);
}

function readDeclarationState(repositoryRoot) {
  const absolutePath = resolve(repositoryRoot, DECLARATION_RELATIVE_PATH);
  if (!existsSync(absolutePath)) {
    return { kind: "not-found" };
  }
  let text;
  try {
    text = readFileSync(absolutePath, "utf8");
  } catch (error) {
    return { kind: "unreadable", detail: error instanceof Error ? error.message : String(error) };
  }
  try {
    return { kind: "parsed", path: DECLARATION_RELATIVE_PATH, canonical: true, value: JSON.parse(text) };
  } catch (error) {
    return { kind: "invalid-json", detail: error instanceof Error ? error.message : String(error) };
  }
}

/** Direct tracked children of the repository root, mirroring the tracked-tree discovery scripts/check-neutrality.mjs's sibling gates already use (git, not a raw directory listing, so a gitignored/untracked entry is never mistaken for a real root entry). */
function discoverTrackedRootEntries(repositoryRoot) {
  const output = execFileSync("git", ["ls-tree", "--name-only", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" });
  return output.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

function discoverGitVersion() {
  try {
    return execFileSync("git", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

function discoverPackageManagerName(repositoryRoot, rootManifest) {
  if (typeof rootManifest.packageManager === "string") {
    return rootManifest.packageManager.split("@")[0];
  }
  return existsSync(resolve(repositoryRoot, "package-lock.json")) ? "npm" : undefined;
}

/**
 * Builds `RepositoryRequirementObservation[]` for exactly the three
 * requirement ids this repository's own governance/repository-profile.json
 * declares (runtime.node, tool.git: machine-scoped; tool.package-manager:
 * repository-scoped, hence carrying `source`). Real observations, not a
 * fixture -- each value is read from this checkout's own runtime and
 * toolchain, matching this repository's own declared requirement scopes
 * exactly.
 */
function buildRequirementObservations(repositoryRoot, declarationSource) {
  const observations = [];

  observations.push({ id: "runtime.node", scope: "machine", state: "observed", value: process.versions.node.split(".")[0] });

  const gitVersion = discoverGitVersion();
  observations.push(
    gitVersion
      ? { id: "tool.git", scope: "machine", state: "observed", value: gitVersion }
      : { id: "tool.git", scope: "machine", state: "absent" },
  );

  let packageManagerName;
  try {
    const rootManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8"));
    packageManagerName = discoverPackageManagerName(repositoryRoot, rootManifest);
  } catch {
    packageManagerName = undefined;
  }
  observations.push(
    packageManagerName
      ? { id: "tool.package-manager", scope: "repository", source: declarationSource, state: "observed", value: packageManagerName }
      : { id: "tool.package-manager", scope: "repository", source: declarationSource, state: "absent" },
  );

  return observations;
}

/**
 * Runs `runRepositoryProfileCheck` (packages/controller, in-workspace) over
 * this repository's own governance/repository-profile.json. Returns the
 * real `GateResult` the runner produces -- no shape decisions happen in
 * this function beyond assembling its inputs.
 */
export async function buildRepositoryProfileGateResult({ repositoryRoot = defaultRepositoryRoot } = {}) {
  const controllerRepository = await importDistEntry(repositoryRoot, "packages/controller/dist/repository/index.js", "packages/controller");
  const { runRepositoryProfileCheck, REPOSITORY_PROFILE_RUN_DECLARATION_SOURCE } = controllerRepository;

  const declaration = readDeclarationState(repositoryRoot);
  let rootObservedEntries;
  try {
    rootObservedEntries = discoverTrackedRootEntries(repositoryRoot);
  } catch {
    rootObservedEntries = undefined;
  }
  const requirementObservations = buildRequirementObservations(repositoryRoot, REPOSITORY_PROFILE_RUN_DECLARATION_SOURCE);

  return runRepositoryProfileCheck({ declaration, requirementObservations, rootObservedEntries });
}

/**
 * Builds and serializes this repository's own `ObservationBundle`. Pure
 * given its inputs -- `producedAt` and `ref` are caller-supplied, and
 * `gateResult` may be injected directly (for hermetic tests), bypassing
 * `buildRepositoryProfileGateResult`'s dist import and discovery I/O
 * entirely.
 */
export async function buildObservationBundle({
  repositoryId = DEFAULT_REPOSITORY_ID,
  ref,
  producedAt,
  repositoryRoot = defaultRepositoryRoot,
  gateResult,
} = {}) {
  if (typeof producedAt !== "string" || producedAt.trim() === "") {
    throw new Error(
      "buildObservationBundle: producedAt is required (the caller's own clock, e.g. the CI run's timestamp) -- this module never reads a clock itself.",
    );
  }
  const builder = await importDistEntry(repositoryRoot, "packages/builder/dist/index.js", "packages/builder");
  const resolvedGateResult = gateResult ?? (await buildRepositoryProfileGateResult({ repositoryRoot }));
  return builder.writeObservationBundle({
    repository: ref ? { id: repositoryId, ref } : { id: repositoryId },
    producedAt,
    gates: [{ gateId: "repository-profile", result: resolvedGateResult }],
  });
}

function parseArguments(argv) {
  const options = { repositoryId: DEFAULT_REPOSITORY_ID };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--produced-at") options.producedAt = argv[++index];
    else if (argument === "--ref") options.ref = argv[++index];
    else if (argument === "--repository-id") options.repositoryId = argv[++index];
    else if (argument === "--repository-root") options.repositoryRoot = argv[++index];
    else if (argument === "--out") options.out = argv[++index];
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (!options.producedAt) {
    throw new Error("--produced-at is required (ISO 8601; supply the CI run's own clock reading, never guessed here)");
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const repositoryRoot = options.repositoryRoot ? resolve(process.cwd(), options.repositoryRoot) : defaultRepositoryRoot;

  const serialized = await buildObservationBundle({
    repositoryId: options.repositoryId,
    ref: options.ref,
    producedAt: options.producedAt,
    repositoryRoot,
  });

  if (options.out) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(resolve(process.cwd(), options.out), `${serialized}\n`);
  } else {
    process.stdout.write(`${serialized}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
