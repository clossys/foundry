#!/usr/bin/env node
// check-fleet-coverage — the collector #395/#504 need: walks a set of REAL
// repository checkouts, builds the caller-supplied input
// `@clossys/observer`'s `gradeFleetCoverage` requires (its own package.json
// declares `observer-coverage-check` as a bin, but that CLI performs no
// fetching or manifest parsing of its own -- it grades a document a caller
// already assembled), and reports this fleet's package x repository coverage
// matrix.
//
//   node scripts/check-fleet-coverage.mjs --packages <path.json> [--format text|json]
//     [<checkout-dir> ...] [--repo <id>=<path> ...] [--inventory <path> --root <dir>]
//
// Exit 0 = every cell resolved and clean (satisfied). Exit 1 = at least one
// repository is both installed and declared-absent for the same package
// (violated). Exit 2 = at least one cell is unclassified, or an installed
// cell's own repository declaration failed validation, or the matrix was
// empty (zero packages x zero repositories, or either alone), or this
// command's OWN arguments could not be understood -- this package's usual
// gate ternary (see `@clossys/observer`'s `fleetCoverageVerdictToExitCode`),
// applied to a real fleet.
//
// WHY THIS LIVES OUTSIDE `@clossys/observer`, NOT INSIDE IT
// -----------------------------------------------------------------------
// `packages/observer/src/coverage.ts`'s own header states the rule this
// script exists to honor, not to work around: the installed inventory and
// each repository's raw declaration payload are CALLER-SUPPLIED, and
// observer itself performs zero I/O to get them -- no manifest parsing, no
// filesystem walk, no HTTP GET. Something has to actually do that reading,
// for a real fleet, and this script is that something. It lives in this
// repository's own scripts/ rather than inside the package for the same
// reason `scripts/gate-run-history.mjs` does (a `RunHistoryReader`
// implementation for a port @clossys/observer ships zero implementations of
// on purpose): a collector against real infrastructure is a caller's
// concern, not the measurer's.
//
// "INSTALLED" MEANS ANY MANIFEST, NOT ONLY A ROOT ONE (#395, decided
// 2026-09-21)
// -----------------------------------------------------------------------
// #395's own 2026-08-21 comment measured two repositories where a
// root-manifest-only sweep and an any-manifest sweep disagreed about the
// same cell, and neither measurement was wrong -- they answered different
// questions. The owner decision this script implements: a pin in ANY
// manifest anywhere in the repository counts as installed, because a
// monorepo consumer legitimately pins a role inside a workspace package
// rather than at the root. `collectInstalledInventory` below therefore
// walks the WHOLE checkout (skipping vendor/output directories -- see
// IGNORED_DIRECTORIES), not just the root `package.json`, and records every
// manifest path that carries each fleet package's pin in
// `FleetInstalledPackage.manifestPaths` -- never discarding placement once
// the installed/not-installed question is answered. See
// docs/contracts/coverage-declaration-contract.json's `installedDefinition`
// for the decision text and reason this script's own behavior must match.
//
// EVERY DEPENDENCY BLOCK, NOT JUST `dependencies`
// -----------------------------------------------------------------------
// Issue #504's own owner comment states the parsing bar this fleet's
// adoption grading depends on: "every dependency block parsed rather than
// grepped ... including overrides and resolutions". `DEPENDENCY_FIELDS`
// below reads `dependencies`, `devDependencies`, `optionalDependencies`,
// `peerDependencies`, `overrides`, and `resolutions`. `overrides` and
// `resolutions` are read only where they hold a DIRECT string pin (the
// common case for pinning one package's own version); a nested override
// object (npm's conditional per-parent override shape) is a materially
// larger surface this script does not attempt to interpret and is skipped,
// not misread as absent -- a repository relying on a nested override to
// pin a fleet role should declare that role's placement itself, the same
// way any other genuinely ambiguous placement gets a human decision rather
// than a guess.
//
// NEVER LEARNS OR NAMES A COMPETING PACKAGE
// -----------------------------------------------------------------------
// This script searches each manifest ONLY for the fleet's own declared
// package catalog (`--packages`) -- it never enumerates a manifest's other
// dependencies, never reports what else is installed, and never inspects
// or prints the CONTENTS of a repository's `.clossys/coverage-declaration.json`
// beyond what `@clossys/observer`'s own parser already exposes (`package`
// and `reason` -- see `renderCellDetail` below). A declared-absent cell's own
// `reason` is the declaring repository's own prose, which this script
// prints verbatim and does not inspect; it is never a second package name
// this script itself computed or discovered. That is the mechanism issue
// #504's owner decision depends on: "this repository never learns or names
// which competing package they use."
//
// ZERO REPOSITORIES IS NEVER A VACUOUS PASS
// -----------------------------------------------------------------------
// Supplying no checkout at all is not treated as "nothing to check, exit
// 0" -- `repositories` is simply an empty array, handed to
// `gradeFleetCoverage` exactly like any other input. `packages.length *
// repositories.length === 0` is `coverage.ts`'s own empty-matrix rule
// (issue #338: a run that evaluated nothing must never report satisfied),
// and this script deliberately does not special-case around it.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gradeFleetCoverage, fleetCoverageVerdictToExitCode } from "@clossys/observer";

const COMMAND = "check-fleet-coverage";

export const USAGE = `Usage: node scripts/check-fleet-coverage.mjs --packages <path.json> [options] [<checkout-dir> ...]

  --packages <path>       Required. A JSON file: either a bare array of package names, or an
                           object { "packages": [...] }. This is the fleet's own catalog under
                           measurement -- never discovered from a manifest.
  <checkout-dir>          Zero or more local repository checkout directories. Each one's
                           repository id defaults to the directory's own basename; use
                           --repo <id>=<path> to assign an explicit id instead (for example when
                           two checkouts would otherwise collide on the same basename).
  --repo <id>=<path>       Adds one repository checkout under an explicit id. Repeatable.
  --inventory <path> --root <dir>
                           Alternative to positional checkout-dirs / --repo: reads a hub
                           inventory document (schemaVersion 1, { "repositories": [{ "id": ... }] },
                           the same shape @clossys/launcher writes to .clossys/inventory.json) and
                           resolves each listed id to <root>/<id>. Mutually exclusive with
                           positional checkout-dirs and --repo.
  --format <text|json>    Output format. Defaults to text.
  --help                  Print this message and exit 0.

Supplying zero repository checkouts is NOT a no-op: the run still proceeds through
gradeFleetCoverage with an empty repository list, which resolves the matrix to
indeterminate (see coverage.ts's own issue #338 rule) rather than a vacuous pass.

Exit codes: 0 = satisfied. 1 = violated (a repository is both installed and declared-absent for
the same package). 2 = indeterminate (at least one cell unclassified, an installed cell's
declaration failed validation, the matrix was empty, or these arguments could not be understood).
`;

export class CliInputError extends Error {}

// Directories a real checkout may contain that are never a repository's own
// declared manifest surface -- vendored, generated, or version-control
// internals. Skipped by directory NAME at any depth, not by full path, so
// this works identically regardless of where a checkout sits on disk.
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  "vendor",
  ".pnpm",
]);

// The dependency-ish fields read from every manifest. Order matters only in
// that it fixes which field's version wins when a name is (unusually)
// pinned in more than one field of the SAME manifest -- production intent
// (dependencies) wins over a dev/optional/peer declaration, and a direct
// overrides/resolutions pin wins over all of them, mirroring
// `@clossys/integrator`'s own `declaredRanges` precedence rule
// (packages/integrator's own inventory reader) without importing it.
const DEPENDENCY_FIELDS = ["peerDependencies", "optionalDependencies", "devDependencies", "dependencies", "resolutions", "overrides"];

// .clossys/ -- the same consumer-facing directory @clossys/launcher already
// writes to (workspace.json, inventory.json), never a second dotfolder
// named after this supplier repository's own internal name.
const DECLARATION_REL_PATH = ".clossys/coverage-declaration.json";

/** Parses argv into structured options. Exported so its edge cases are testable without a process. */
export function parseArgs(argv) {
  let packagesPath;
  let format = "text";
  let help = false;
  let inventoryPath;
  let root;
  const checkouts = []; // { id, path }
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--help":
      case "-h":
        help = true;
        break;
      case "--packages": {
        const value = argv[++index];
        if (value === undefined) throw new CliInputError("--packages requires a value");
        packagesPath = value;
        break;
      }
      case "--format": {
        const value = argv[++index];
        if (value !== "text" && value !== "json") throw new CliInputError(`--format must be "text" or "json", got ${JSON.stringify(value)}`);
        format = value;
        break;
      }
      case "--repo": {
        const value = argv[++index];
        if (value === undefined) throw new CliInputError("--repo requires a value shaped <id>=<path>");
        const splitAt = value.indexOf("=");
        if (splitAt <= 0 || splitAt === value.length - 1) {
          throw new CliInputError(`--repo must be shaped <id>=<path>, got ${JSON.stringify(value)}`);
        }
        checkouts.push({ id: value.slice(0, splitAt), path: value.slice(splitAt + 1) });
        break;
      }
      case "--inventory": {
        const value = argv[++index];
        if (value === undefined) throw new CliInputError("--inventory requires a value");
        inventoryPath = value;
        break;
      }
      case "--root": {
        const value = argv[++index];
        if (value === undefined) throw new CliInputError("--root requires a value");
        root = value;
        break;
      }
      default:
        if (arg.startsWith("-") && arg !== "-") throw new CliInputError(`unknown flag ${JSON.stringify(arg)}`);
        positional.push(arg);
        break;
    }
  }

  if (help) return { help: true, format, packagesPath, checkouts: [], positional: [] };

  if (inventoryPath !== undefined || root !== undefined) {
    if (inventoryPath === undefined || root === undefined) {
      throw new CliInputError("--inventory and --root must be supplied together");
    }
    if (checkouts.length > 0 || positional.length > 0) {
      throw new CliInputError("--inventory/--root is mutually exclusive with positional checkout-dirs and --repo");
    }
  }

  return { help: false, format, packagesPath, checkouts, positional, inventoryPath, root };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Loads the fleet's own package catalog from --packages. Never discovered from a manifest. */
function loadPackageCatalog(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new CliInputError(`could not read --packages file ${path}: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CliInputError(`--packages file ${path} is not valid JSON: ${error.message}`);
  }
  const list = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.packages) ? parsed.packages : undefined;
  if (list === undefined) {
    throw new CliInputError(`--packages file ${path} must be a JSON array of package names, or { "packages": [...] }`);
  }
  if (list.length === 0) throw new CliInputError(`--packages file ${path} names zero packages -- the fleet catalog must be non-empty`);
  if (!list.every((entry) => typeof entry === "string" && entry.trim() !== "")) {
    throw new CliInputError(`--packages file ${path}: every entry must be a non-empty string`);
  }
  return list;
}

/** Reads a hub inventory document (schemaVersion 1, { repositories: [{ id }] }) and returns every id. */
function loadInventoryIds(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new CliInputError(`could not read --inventory file ${path}: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CliInputError(`--inventory file ${path} is not valid JSON: ${error.message}`);
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.repositories)) {
    throw new CliInputError(`--inventory file ${path} is not readable inventory JSON (schemaVersion 1, repositories array)`);
  }
  return parsed.repositories.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.trim() === "") {
      throw new CliInputError(`--inventory file ${path}: repositories[${index}] has no valid "id"`);
    }
    return entry.id;
  });
}

/** Resolves the final { id, path } checkout list from every source parseArgs accepted. */
function resolveCheckouts(options) {
  const entries = [];
  for (const positionalPath of options.positional) {
    entries.push({ id: basename(resolve(positionalPath)), path: positionalPath });
  }
  for (const explicit of options.checkouts) {
    entries.push(explicit);
  }
  if (options.inventoryPath !== undefined && options.root !== undefined) {
    for (const id of loadInventoryIds(options.inventoryPath)) {
      entries.push({ id, path: join(options.root, id) });
    }
  }
  const seen = new Set();
  for (const entry of entries) {
    if (entry.id.trim() === "") throw new CliInputError("a repository id cannot be empty");
    if (seen.has(entry.id)) throw new CliInputError(`duplicate repository id ${JSON.stringify(entry.id)} -- every checkout needs a unique id`);
    seen.add(entry.id);
  }
  return entries;
}

// -------------------------------------------------------- manifest walking

function walkManifests(root) {
  const found = [];
  const stack = [{ dir: root, depth: 0 }];
  const MAX_DEPTH = 8;
  while (stack.length > 0) {
    const { dir, depth } = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable directory: skip it, do not abort the whole walk
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".clossys") continue; // dotfiles/dirs other than the declaration's own home
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        if (depth >= MAX_DEPTH) continue;
        stack.push({ dir: join(dir, entry.name), depth: depth + 1 });
      } else if (entry.isFile() && entry.name === "package.json") {
        found.push(join(dir, entry.name));
      }
    }
  }
  return found;
}

/** Reads every string-valued dependency-ish pin for `catalog`'s packages out of one manifest. Never throws -- an unreadable manifest contributes nothing rather than aborting the repository's whole scan. */
function readManifestPins(manifestPath, catalog) {
  let raw;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch {
    return new Map();
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return new Map();
  }
  if (!isRecord(manifest)) return new Map();
  const pins = new Map(); // package name -> version string
  for (const field of DEPENDENCY_FIELDS) {
    const block = manifest[field];
    if (!isRecord(block)) continue;
    for (const name of catalog) {
      const value = block[name];
      if (typeof value === "string" && value.trim() !== "") pins.set(name, value);
    }
  }
  return pins;
}

function manifestSortKey(relativePath) {
  // "package.json" (the repository root) sorts first, everything else
  // alphabetically after it -- so a root pin is the recorded representative
  // `installedVersion` when the same package is pinned in more than one
  // manifest, while EVERY carrying path still lands in `manifestPaths`.
  return relativePath === "package.json" ? `\u0000${relativePath}` : relativePath;
}

/**
 * Walks one checkout and returns its `FleetInstalledInventory`, or
 * `undefined` when the checkout itself could not be read at all (the
 * directory does not exist / is not a directory) -- distinct from a real,
 * readable checkout that simply has zero manifests, which returns `{
 * packages: [] }`.
 */
function collectInstalledInventory(checkoutPath, catalog) {
  let stat;
  try {
    stat = statSync(checkoutPath);
  } catch {
    return undefined;
  }
  if (!stat.isDirectory()) return undefined;

  const manifestPaths = walkManifests(checkoutPath)
    .map((absolute) => relative(checkoutPath, absolute).split(sep).join("/")) // always "/"-joined in the recorded/reported path, regardless of platform
    .sort((a, b) => (manifestSortKey(a) < manifestSortKey(b) ? -1 : manifestSortKey(a) > manifestSortKey(b) ? 1 : 0));

  const byPackage = new Map(); // name -> { installedVersion, manifestPaths: string[] }
  for (const relativeManifestPath of manifestPaths) {
    const absolute = join(checkoutPath, relativeManifestPath);
    const pins = readManifestPins(absolute, catalog);
    for (const [name, version] of pins) {
      const existing = byPackage.get(name);
      if (existing === undefined) {
        byPackage.set(name, { installedVersion: version, manifestPaths: [relativeManifestPath] });
      } else {
        existing.manifestPaths.push(relativeManifestPath);
      }
    }
  }

  return {
    packages: [...byPackage.entries()].map(([name, value]) => ({
      name,
      installedVersion: value.installedVersion,
      manifestPaths: value.manifestPaths,
    })),
  };
}

function readDeclaration(checkoutPath) {
  const declarationPath = join(checkoutPath, DECLARATION_REL_PATH);
  if (!existsSync(declarationPath)) return undefined;
  try {
    // The raw string, unparsed -- exactly the shape a real unauthenticated
    // raw-content GET against this same fixed path returns (see
    // docs/contracts/coverage-declaration-contract.json's declaredLocation).
    // @clossys/observer's parseCoverageDeclaration accepts this directly.
    return readFileSync(declarationPath, "utf8");
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------- rendering

function escapeCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * Renders one cell's own "detail" column. Deliberately narrow per cell
 * state -- see this file's own header on never printing a competing
 * package name: a declared-absent cell contributes only its `reason`,
 * nothing this script itself discovered about what else is installed.
 */
function renderCellDetail(cell) {
  if (cell.state === "declared-absent") return cell.reason;
  if (cell.state === "unclassified") return cell.detail ? `${cell.reason} — ${cell.detail}` : cell.reason;
  const parts = [];
  if (cell.installedVersion) parts.push(cell.installedVersion);
  if (cell.manifestPaths && cell.manifestPaths.length > 0) parts.push(`via ${cell.manifestPaths.join(", ")}`);
  return parts.join(" ");
}

function renderReport(report) {
  const lines = ["## check-fleet-coverage", "", "| package | repository | state | detail |", "| --- | --- | --- | --- |"];
  for (const cell of report.cells) {
    lines.push(`| ${escapeCell(cell.package)} | ${escapeCell(cell.repository)} | ${escapeCell(cell.state)} | ${escapeCell(renderCellDetail(cell))} |`);
  }
  lines.push(
    "",
    `Counts: installed=${report.countsByState.installed} declared-absent=${report.countsByState.declaredAbsent} unclassified=${report.countsByState.unclassified}`,
  );
  if (report.contradictions.length > 0) {
    lines.push("", "Contradictions (installed AND declared-absent for the same package):");
    for (const contradiction of report.contradictions) {
      lines.push(`- ${contradiction.package} in ${contradiction.repository}`);
    }
  }
  if (report.unverifiedInstalledCells.length > 0) {
    lines.push("", "Unverified (installed, but this repository's own declaration failed validation):");
    for (const entry of report.unverifiedInstalledCells) {
      lines.push(`- ${entry.package} in ${entry.repository}`);
    }
  }
  const overallLabel = report.result.verdict === "satisfied" ? "SATISFIED" : report.result.verdict === "violated" ? "VIOLATED" : "INDETERMINATE";
  lines.push("", `Overall: ${overallLabel} (exit ${fleetCoverageVerdictToExitCode(report.result)})`);
  if (report.result.verdict === "indeterminate") lines.push("", `Reason: ${report.result.reason} -- ${report.result.detail}`);
  return `${lines.join("\n")}\n`;
}

// ------------------------------------------------------------------ main

export function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${COMMAND}: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  let catalog;
  let checkouts;
  try {
    if (options.packagesPath === undefined) throw new CliInputError("--packages is required");
    catalog = loadPackageCatalog(resolve(options.packagesPath));
    checkouts = resolveCheckouts(options);
  } catch (error) {
    process.stderr.write(`${COMMAND}: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }

  const repositories = checkouts.map(({ id, path }) => {
    const checkoutPath = resolve(path);
    return {
      repository: id,
      declaration: readDeclaration(checkoutPath),
      installed: collectInstalledInventory(checkoutPath, catalog),
    };
  });

  let report;
  try {
    report = gradeFleetCoverage({ packages: catalog, repositories });
  } catch (error) {
    process.stderr.write(`${COMMAND}: the run did not complete, so nothing has been established: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  process.stdout.write(options.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderReport(report));
  return fleetCoverageVerdictToExitCode(report.result);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
