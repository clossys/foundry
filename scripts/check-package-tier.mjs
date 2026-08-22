#!/usr/bin/env node
// check-package-tier — does every live package under packages/ appear exactly
// once in docs/contracts/package-tier.json?
//
//   node scripts/check-package-tier.mjs [--json] [--tier <path>] [--lifecycle <path>]
//
// Exit 0 = every non-deprecated package on disk is classified exactly once —
// in a program, in the primitive tier, or in `awaitingProgram` — and every
// name the declaration lists is a real package here. Exit 1 = at least one
// finding (an unclassified package, a name classified twice, a declared name
// with no package directory, or a malformed entry). Exit 2 = the check could
// not be run at all (an unreadable or unparseable contract file, a contract
// missing the keys this gate reads, or an empty scan). Same three-way split
// every gate in this repo uses — see the identical contract in
// check-workspace-links.mjs's own header.
//
// WHAT THIS GATE DELIBERATELY DOES NOT CHECK
// -------------------------------------------
// docs/DECISIONS.md 11 states a stronger rule than this gate enforces: a
// package in a program ships a gate behind a `bin`, and a primitive declares
// that it ships none. The mechanical form of that rule — every non-primitive
// package.json exposes a `bin` — cannot run today. `auth`, `comms` and
// `consent` are published, belong to no program yet, and ship no gate because
// nobody has built one. Wired now, that check would fail on three
// known-missing gates rather than on drift, and a gate whose first act is to
// go red on a state its own decision already records is a gate someone
// switches off.
//
// So this gate enforces the half that can pass today and still fails on the
// thing that actually goes wrong: someone adds a package and classifies it
// nowhere. That is the drift the declaration exists to prevent, and it is
// exactly what turns a contract file into decoration — see
// docs/contracts/package-retention.json, whose own header makes the same
// argument about an absence with no declared reason. The `bin` half follows
// the packages that can satisfy it.
//
// WHY DEPRECATED PACKAGES ARE NOT REQUIRED
// -----------------------------------------
// A package whose docs/contracts/package-lifecycle.json status is
// "deprecated" or "retired" is a donor kept live for consumers already
// pinned to it, declared with its own reason and `reviewBy` in
// package-retention.json. Requiring it to also claim a program would ask it
// to state a membership it is on its way out of. Such a package MAY still be
// listed here (it then has to be unique and real, like anything else); it is
// simply not required to be.
//
// A `private: true` manifest is not a package this repository publishes at
// all, and is skipped for the same reason every other gate here skips it.
//
// EMPTY SCAN
// ----------
// Discovering zero packages, or a contract that classifies zero names, is
// exit 2 — never a clean 0. A check that passes because it checked nothing
// is indistinguishable from a check that cannot fail (see
// check-workspace-links.mjs's own EMPTY SCAN section, and commit 01bd520,
// which is where this repository learned that the expensive way).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TIER_PATH = "docs/contracts/package-tier.json";
const DEFAULT_LIFECYCLE_PATH = "docs/contracts/package-lifecycle.json";
const EXCLUDED_LIFECYCLE_STATUSES = new Set(["deprecated", "retired"]);

// ------------------------------------------------------------------- input

// Returns { data } or { error }. Never throws, and never treats a missing
// file as an empty one: a contract this gate cannot read is exit 2, because
// "there is nothing to check" and "I could not look" are different answers.
function readJson(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return { error: `could not read ${path}: ${error.message}` };
  }
  try {
    return { data: JSON.parse(raw) };
  } catch (error) {
    return { error: `${path} is not valid JSON: ${error.message}` };
  }
}

// Resolved against the current working directory, not this script's own
// location — every caller runs this from the repository root, the same
// convention check-workspace-links.mjs's discoverPackages() follows.
function discoverPackages(cwd = process.cwd()) {
  const packagesDir = join(cwd, "packages");
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(packagesDir, d.name))
    .filter((dir) => existsSync(join(dir, "package.json")))
    .sort();
}

// An unreadable or unparseable manifest is returned as an error result the
// caller reports, never a silent skip.
function loadManifests(pkgDirs) {
  return pkgDirs.map((pkgDir) => {
    const manifestPath = join(pkgDir, "package.json");
    const { data, error } = readJson(manifestPath);
    if (error) return { pkgDir, error };
    if (typeof data.name !== "string" || data.name.length === 0) {
      return { pkgDir, error: `${manifestPath} has no valid "name" field` };
    }
    return { pkgDir, name: data.name, private: data.private === true };
  });
}

function lifecycleStatuses(lifecycle) {
  const statuses = new Map();
  const entries = Array.isArray(lifecycle?.packages) ? lifecycle.packages : [];
  for (const entry of entries) {
    if (entry && typeof entry.name === "string" && typeof entry.status === "string") {
      statuses.set(entry.name, entry.status);
    }
  }
  return statuses;
}

// ------------------------------------------------------- declaration model

// Flattens the contract's three classification surfaces into one list of
// { name, where } claims. A name appearing in two of them — or twice in one —
// survives this flattening as two entries, which is what makes the duplicate
// check below possible at all.
function collectClaims(tier) {
  const claims = [];
  const malformed = [];

  const programs = Array.isArray(tier?.programs) ? tier.programs : [];
  for (const [index, program] of programs.entries()) {
    const label = typeof program?.name === "string" ? `program "${program.name}"` : `programs[${index}]`;
    if (!program || typeof program.name !== "string" || program.name.length === 0) {
      malformed.push(`${label} has no "name"`);
      continue;
    }
    if (typeof program.addresses !== "string" || program.addresses.length === 0) {
      malformed.push(`${label} declares no "addresses" — a program is identified by its addressee`);
    }
    if (!Array.isArray(program.packages)) {
      malformed.push(`${label} has no "packages" array (use [] for a program that is not cut)`);
      continue;
    }
    for (const name of program.packages) {
      if (typeof name !== "string" || name.length === 0) {
        malformed.push(`${label} lists a package that is not a non-empty string`);
        continue;
      }
      claims.push({ name, where: label });
    }
  }

  const primitives = Array.isArray(tier?.primitives) ? tier.primitives : [];
  for (const [index, primitive] of primitives.entries()) {
    const label = typeof primitive?.name === "string" ? `primitive "${primitive.name}"` : `primitives[${index}]`;
    if (!primitive || typeof primitive.name !== "string" || primitive.name.length === 0) {
      malformed.push(`${label} has no "name"`);
      continue;
    }
    if (primitive.shipsGate !== false) {
      malformed.push(`${label} must declare "shipsGate": false — that declaration is the whole point of the tier`);
    }
    if (typeof primitive.reason !== "string" || primitive.reason.length === 0) {
      malformed.push(`${label} declares no "reason" — a primitive says it ships no gate AND why`);
    }
    claims.push({ name: primitive.name, where: label });
  }

  const awaiting = Array.isArray(tier?.awaitingProgram) ? tier.awaitingProgram : [];
  for (const [index, entry] of awaiting.entries()) {
    const label = typeof entry?.name === "string" ? `awaitingProgram "${entry.name}"` : `awaitingProgram[${index}]`;
    if (!entry || typeof entry.name !== "string" || entry.name.length === 0) {
      malformed.push(`${label} has no "name"`);
      continue;
    }
    if (entry.shipsGate !== false) {
      malformed.push(`${label} must declare "shipsGate": false — this state exists for a gate nobody has built yet`);
    }
    if (typeof entry.reason !== "string" || entry.reason.length === 0) {
      malformed.push(`${label} declares no "reason"`);
    }
    if (typeof entry.resolvedBy !== "string" || entry.resolvedBy.length === 0) {
      malformed.push(
        `${label} declares no "resolvedBy" — an unclassified package with no named resolution is the ` +
          "standing exemption with no expiry that docs/contracts/package-retention.json refuses",
      );
    }
    claims.push({ name: entry.name, where: label });
  }

  return { claims, malformed };
}

// --------------------------------------------------------------- evaluation

// `manifests` is loadManifests()'s output; `statuses` is lifecycleStatuses()'s.
// Returns a flat result list using the same {status, detail} shape every gate
// here prints and aggregates.
function evaluate({ manifests, statuses, tier }) {
  const results = [];
  const { claims, malformed } = collectClaims(tier);

  for (const detail of malformed) {
    results.push({ check: "shape", package: "(contract)", status: "finding", detail });
  }

  const claimedBy = new Map();
  for (const claim of claims) {
    if (!claimedBy.has(claim.name)) claimedBy.set(claim.name, []);
    claimedBy.get(claim.name).push(claim.where);
  }

  const onDisk = new Map();
  for (const m of manifests) {
    if (m.error) {
      results.push({ check: "manifest", package: m.pkgDir, status: "error", detail: m.error });
      continue;
    }
    if (m.private) continue;
    onDisk.set(m.name, m);
  }

  // Direction 1 — every live package on disk is classified exactly once.
  for (const [name] of [...onDisk].sort(([a], [b]) => a.localeCompare(b))) {
    const status = statuses.get(name);
    const excluded = status !== undefined && EXCLUDED_LIFECYCLE_STATUSES.has(status);
    const where = claimedBy.get(name) ?? [];

    if (where.length > 1) {
      results.push({
        check: "tier",
        package: name,
        status: "finding",
        detail: `classified ${where.length} times (${where.join(", ")}) — a package belongs to exactly one of a program, the primitive tier, or awaitingProgram`,
      });
      continue;
    }
    if (where.length === 1) {
      results.push({ check: "tier", package: name, status: "pass", detail: `classified once, in ${where[0]}` });
      continue;
    }
    if (excluded) {
      results.push({
        check: "tier",
        package: name,
        status: "pass",
        detail: `lifecycle status "${status}" — a donor on its way out is not required to claim a program (declared instead in docs/contracts/package-retention.json)`,
      });
      continue;
    }
    results.push({
      check: "tier",
      package: name,
      status: "finding",
      detail:
        `is not classified in ${DEFAULT_TIER_PATH}. Every live package belongs to a program (and ships a gate ` +
        "behind a `bin`), to the primitive tier (and declares that it ships none, and why), or to " +
        "awaitingProgram (published, no program yet, gate known-missing, with a named resolution). See " +
        "docs/DECISIONS.md#11-a-gate-behind-a-bin-or-a-declared-primitive.",
    });
  }

  // Direction 2 — every name the declaration claims is a real package here.
  // Without this, a rename leaves the contract describing a tree that no
  // longer exists while direction 1 still reports a clean pass.
  for (const [name, where] of [...claimedBy].sort(([a], [b]) => a.localeCompare(b))) {
    if (onDisk.has(name)) continue;
    results.push({
      check: "declared",
      package: name,
      status: "finding",
      detail: `declared in ${where.join(", ")} but no package under packages/ has that name`,
    });
  }

  return { results, claimCount: claims.length };
}

// ------------------------------------------------------------------- main

function parseArgs(argv) {
  const args = { json: false, tier: DEFAULT_TIER_PATH, lifecycle: DEFAULT_LIFECYCLE_PATH };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--tier") args.tier = argv[++i];
    else if (arg === "--lifecycle") args.lifecycle = argv[++i];
    else return { error: `unrecognised argument: ${arg}` };
  }
  if (!args.tier || !args.lifecycle) return { error: "--tier and --lifecycle each need a path" };
  return { args };
}

function fail(message, json) {
  if (json) console.log(JSON.stringify({ error: message, results: [] }, null, 2));
  else console.error(`check-package-tier: ${message}`);
  process.exit(2);
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) fail(parsed.error, false);
  const { json, tier: tierPath, lifecycle: lifecyclePath } = parsed.args;

  const tierRead = readJson(resolve(tierPath));
  if (tierRead.error) fail(tierRead.error, json);
  const tier = tierRead.data;
  if (!Array.isArray(tier?.programs) || !Array.isArray(tier?.primitives)) {
    fail(`${tierPath} has no "programs" and "primitives" arrays — not a tier contract this gate can read`, json);
  }

  const lifecycleRead = readJson(resolve(lifecyclePath));
  if (lifecycleRead.error) fail(lifecycleRead.error, json);
  if (!Array.isArray(lifecycleRead.data?.packages)) {
    fail(`${lifecyclePath} has no "packages" array — cannot tell a live package from a donor`, json);
  }
  const statuses = lifecycleStatuses(lifecycleRead.data);

  const pkgDirs = discoverPackages();
  if (pkgDirs.length === 0) {
    fail("found no packages under packages/ — refusing to report a clean pass on an empty scan", json);
  }

  const manifests = loadManifests(pkgDirs);
  const { results, claimCount } = evaluate({ manifests, statuses, tier });
  if (claimCount === 0) {
    fail(
      `${tierPath} classifies no package names at all — refusing to report a clean pass on an empty declaration`,
      json,
    );
  }

  if (json) {
    console.log(JSON.stringify({ results }, null, 2));
  } else {
    const labels = { pass: "PASS ", finding: "FIND ", error: "ERROR" };
    console.log(`check-package-tier: ${pkgDirs.length} package(s) on disk, ${claimCount} classification(s) declared`);
    for (const r of results) {
      console.log(`  [${labels[r.status]}] [${r.check}] ${r.package} — ${r.detail}`);
    }
  }

  // Worst-of-three, the same aggregation check-workspace-links.mjs uses.
  const worst = results.reduce((acc, r) => (r.status === "error" ? 2 : r.status === "finding" && acc !== 2 ? 1 : acc), 0);

  if (!json) {
    console.log("");
    console.log(
      worst === 0
        ? "PACKAGE TIER OK — every live package is classified exactly once, and every declared name is a real package."
        : worst === 2
          ? "PACKAGE TIER ERROR — could not evaluate at least one package (see ERROR lines above)."
          : "PACKAGE TIER FAIL — classify each FIND line in docs/contracts/package-tier.json: a program, the primitive tier, or awaitingProgram. An unclassified package is indistinguishable from one whose gate nobody remembered to build.",
    );
  }
  process.exit(worst);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

export { collectClaims, discoverPackages, evaluate, lifecycleStatuses, loadManifests, parseArgs, readJson };
