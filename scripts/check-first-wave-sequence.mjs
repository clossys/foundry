#!/usr/bin/env node
// First-wave productization sequence.
//
//   node scripts/check-first-wave-sequence.mjs [--json] [<repoRoot>]
//
// Exit 0 = the committed sequence covers every current package exactly once,
// is a topological order of first-party runtime dependencies, keeps the Trio
// prefix, keeps operational integrity ahead of expression, and honours the
// non-runtime closed-loop constraints. Exit 1 = at least one finding. Exit 2
// = the question could not be answered.
//
// WHY THIS EXISTS
// ---------------
// Three live orders in this repository answer three different questions:
//
//   1. governance/release-catalog.json — publication allowlist and historical
//      upload order. Writer and designer sit early there because publisher
//      cannot publish without them. That is not a reason to productize
//      frontend surfaces before operating loops.
//   2. docs/ADOPTION.md — consumer engagement flow. Advisor first, then only
//      justified positions. It does not rank producer backlog.
//   3. this contract — producer productization and first-wave install order:
//      catalogue integrity, engagement, trusted base, operating rules,
//      operating control, agreements, then expression, with publisher before
//      influencer so the expression pipeline actually closes.
//
// Issue #517 still presents itself as the session entry point and tells the
// reader to run a programme gate that no longer exists. Issue #897 audits
// packages by consumer-facing surface area, most-exposed first, which puts
// publisher and designer ahead of advisor. Both are the wrong order for a
// first-wave consumer that needs to install and re-run closed-loop packages.
// This gate holds the order that is the right one, and fails when the
// contract drifts from the manifests' runtime graph.
//
// WHAT THIS DOES NOT CLAIM
// ------------------------
// It does not claim any package is published, adopted, grounded, or closed.
// It does not install anything. It does not grade the productization
// criteria — those are a rubric for backlog routing, not a score. A sequence
// that is internally consistent can still point at packages a consumer
// should not install yet.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const CONTRACT_REL = "docs/contracts/first-wave-sequence.json";
const PACKAGES_REL = "packages";
const SCOPE_PREFIX = "@clossys/";
export const WAVE_KINDS = Object.freeze([
  "catalogue-integrity",
  "engagement",
  "executable-tooling",
  "operational-integrity",
  "frontend-expression",
]);
export const REQUIRED_PRIORITY = Object.freeze([
  "catalogue-integrity",
  "engagement",
  "executable-tooling",
  "operational-integrity",
  "frontend-expression",
]);
export const REQUIRED_TRIO = Object.freeze(["advisor", "starter", "controller"]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value) {
  return typeof value === "string" && value.trim() !== "";
}

class SequenceInputError extends Error {
  constructor(message) {
    super(message);
    this.exitCode = 2;
  }
}

function readJson(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new SequenceInputError(`cannot read ${path}: ${error.code ?? error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new SequenceInputError(`cannot parse ${path}: ${error.message}`);
  }
}

function packageDirectory(name) {
  if (!isText(name) || !name.startsWith(SCOPE_PREFIX)) return null;
  return name.slice(SCOPE_PREFIX.length);
}

/** Pure evaluation over already-read records, so tests need no repository. */
export function evaluateFirstWaveSequence({ contract, manifestsByDirectory }) {
  const findings = [];
  const note = (rule, message, extra = {}) => {
    findings.push({ rule, message, ...extra });
  };

  if (!isRecord(contract) || contract.schemaVersion !== 1) {
    note("invalid-contract", "first-wave sequence contract must be schemaVersion 1");
    return { findings, sequence: [] };
  }

  if (!Array.isArray(contract.priority) || contract.priority.join("\0") !== REQUIRED_PRIORITY.join("\0")) {
    note(
      "priority-drift",
      `priority must be exactly ${REQUIRED_PRIORITY.join(" > ")}; operational integrity stays ahead of frontend expression`,
    );
  }

  if (!Array.isArray(contract.trioPrefix) || contract.trioPrefix.join("\0") !== REQUIRED_TRIO.join("\0")) {
    note("trio-prefix-drift", `trioPrefix must be exactly ${REQUIRED_TRIO.join(", ")}`);
  }

  if (!Array.isArray(contract.waves) || contract.waves.length === 0) {
    note("invalid-contract", "waves must be a nonempty array");
    return { findings, sequence: [] };
  }

  const seenWaveIds = new Set();
  const seenPackages = new Set();
  const sequence = [];
  let seenFrontend = false;
  let seenPackageWave = false;

  for (const [index, wave] of contract.waves.entries()) {
    if (!isRecord(wave) || !isText(wave.id) || !isText(wave.kind) || !isText(wave.job) || !Array.isArray(wave.packages)) {
      note("invalid-wave", `waves[${index}] must have id, kind, job, and packages[]`);
      continue;
    }
    if (!WAVE_KINDS.includes(wave.kind)) {
      note("unknown-wave-kind", `wave ${wave.id} has unknown kind ${wave.kind}`, { wave: wave.id });
    }
    if (seenWaveIds.has(wave.id)) {
      note("duplicate-wave", `wave id ${wave.id} appears more than once`, { wave: wave.id });
    }
    seenWaveIds.add(wave.id);

    if (index === 0 && wave.kind !== "catalogue-integrity") {
      note("catalogue-integrity-not-first", "the first wave must be catalogue-integrity: installability unblocks every later wave");
    }
    if (wave.kind === "frontend-expression") {
      seenFrontend = true;
    } else if (seenFrontend && (wave.kind === "operational-integrity" || wave.kind === "engagement")) {
      note(
        "frontend-before-operations",
        `wave ${wave.id} (${wave.kind}) follows a frontend-expression wave; operational integrity stays ahead of frontend development`,
        { wave: wave.id },
      );
    }

    if (wave.kind === "catalogue-integrity" && wave.packages.length > 0) {
      note("catalogue-integrity-has-packages", "catalogue-integrity is a work wave, not a package wave", { wave: wave.id });
    }

    if (wave.packages.length > 0) {
      if (!seenPackageWave && (wave.kind !== "engagement" || wave.packages[0] !== "advisor" || wave.packages.length !== 1)) {
        note(
          "advisor-not-first-package",
          "the first package-bearing wave must be engagement with advisor alone; Advisor is the engagement decision gate",
          { wave: wave.id },
        );
      }
      seenPackageWave = true;
    }

    for (const directory of wave.packages) {
      if (!isText(directory)) {
        note("invalid-package", `wave ${wave.id} contains a non-string package directory`, { wave: wave.id });
        continue;
      }
      if (seenPackages.has(directory)) {
        note("duplicate-package", `${directory} appears in more than one wave`, { package: directory, wave: wave.id });
      }
      seenPackages.add(directory);
      sequence.push(directory);
    }
  }

  const manifestDirectories = [...manifestsByDirectory.keys()].sort();
  for (const directory of manifestDirectories) {
    if (!seenPackages.has(directory)) {
      note("package-missing-from-sequence", `${directory} exists in packages/ but is not in the first-wave sequence`, {
        package: directory,
      });
    }
  }
  for (const directory of sequence) {
    if (!manifestsByDirectory.has(directory)) {
      note("sequence-names-absent-package", `${directory} is in the first-wave sequence but has no packages/${directory} manifest`, {
        package: directory,
      });
    }
  }

  if (sequence.slice(0, REQUIRED_TRIO.length).join("\0") !== REQUIRED_TRIO.join("\0")) {
    note(
      "trio-prefix-broken",
      `package sequence must start ${REQUIRED_TRIO.join(" -> ")}; that is engagement sequencing plus the trusted-base Trio, not a runtime edge`,
    );
  }

  const indexByDirectory = new Map(sequence.map((directory, index) => [directory, index]));
  for (const [directory, manifest] of manifestsByDirectory) {
    const deps = isRecord(manifest.dependencies) ? manifest.dependencies : {};
    for (const [depName] of Object.entries(deps)) {
      const depDirectory = packageDirectory(depName);
      if (depDirectory === null) continue;
      if (!manifestsByDirectory.has(depDirectory)) {
        note(
          "unknown-runtime-dependency",
          `${directory} depends on ${depName}, which is not a current first-party package`,
          { package: directory, dependency: depDirectory },
        );
        continue;
      }
      const selfIndex = indexByDirectory.get(directory);
      const depIndex = indexByDirectory.get(depDirectory);
      if (selfIndex === undefined || depIndex === undefined) continue;
      if (!(depIndex < selfIndex)) {
        note(
          "runtime-order-violation",
          `${directory} has a first-party runtime dependency on ${depDirectory}, which must appear earlier in the sequence`,
          { package: directory, dependency: depDirectory },
        );
      }
    }
  }

  if (!Array.isArray(contract.nonRuntimeOrder)) {
    note("invalid-contract", "nonRuntimeOrder must be an array");
  } else {
    for (const [index, constraint] of contract.nonRuntimeOrder.entries()) {
      if (!isRecord(constraint) || !isText(constraint.earlier) || !isText(constraint.later) || !isText(constraint.reason)) {
        note("invalid-non-runtime-order", `nonRuntimeOrder[${index}] must have earlier, later, and reason`);
        continue;
      }
      const earlierIndex = indexByDirectory.get(constraint.earlier);
      const laterIndex = indexByDirectory.get(constraint.later);
      if (earlierIndex === undefined || laterIndex === undefined) {
        note(
          "non-runtime-order-unknown-package",
          `nonRuntimeOrder constraint ${constraint.earlier} before ${constraint.later} names a package outside the sequence`,
        );
        continue;
      }
      if (!(earlierIndex < laterIndex)) {
        note(
          "non-runtime-order-violation",
          `${constraint.later} must follow ${constraint.earlier}: ${constraint.reason}`,
          { earlier: constraint.earlier, later: constraint.later },
        );
      }
    }
  }

  if (!Array.isArray(contract.productizationCriteria) || contract.productizationCriteria.length === 0) {
    note("missing-productization-criteria", "productizationCriteria must list the supplier-side closed-loop rubric");
  } else {
    const seenCriteria = new Set();
    for (const [index, criterion] of contract.productizationCriteria.entries()) {
      if (!isRecord(criterion) || !isText(criterion.id) || !isText(criterion.owner) || !isText(criterion.means)) {
        note("invalid-productization-criterion", `productizationCriteria[${index}] must have id, owner, and means`);
        continue;
      }
      if (seenCriteria.has(criterion.id)) {
        note("duplicate-productization-criterion", `productization criterion ${criterion.id} appears more than once`);
      }
      seenCriteria.add(criterion.id);
    }
  }

  if (!Array.isArray(contract.backlogRouting) || contract.backlogRouting.length === 0) {
    note("missing-backlog-routing", "backlogRouting must classify work kinds so the GitHub backlog cannot silently revert to surface-area order");
  }

  return { findings, sequence };
}

export function collectManifests(repoRoot) {
  const packagesDir = join(repoRoot, PACKAGES_REL);
  if (!existsSync(packagesDir)) {
    throw new SequenceInputError(`missing ${PACKAGES_REL}/ at ${repoRoot}`);
  }
  const manifests = new Map();
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    if (!isRecord(manifest) || manifest.private === true) continue;
    if (!isText(manifest.name) || packageDirectory(manifest.name) !== entry.name) {
      throw new SequenceInputError(`${manifestPath} name must be ${SCOPE_PREFIX}${entry.name}`);
    }
    manifests.set(entry.name, manifest);
  }
  return manifests;
}

function defaultRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

export function loadAndEvaluate(repoRoot = defaultRoot()) {
  const contractPath = join(repoRoot, CONTRACT_REL);
  if (isAbsolute(CONTRACT_REL) === false && !existsSync(contractPath)) {
    throw new SequenceInputError(`missing ${CONTRACT_REL}`);
  }
  return evaluateFirstWaveSequence({
    contract: readJson(contractPath),
    manifestsByDirectory: collectManifests(repoRoot),
  });
}

function printText(result) {
  if (result.findings.length === 0) {
    console.log(`first-wave sequence: PASS (${result.sequence.length} packages, ${result.sequence.join(" -> ")})`);
    return;
  }
  console.error(`first-wave sequence: FAIL (${result.findings.length} finding(s))`);
  for (const finding of result.findings) {
    console.error(`- ${finding.rule}: ${finding.message}`);
  }
}

function main(argv) {
  const json = argv.includes("--json");
  const positional = argv.filter((arg) => arg !== "--json" && !arg.startsWith("--"));
  const repoRoot = positional[0] ? positional[0] : defaultRoot();
  const result = loadAndEvaluate(repoRoot);
  if (json) {
    console.log(JSON.stringify({ findings: result.findings, sequence: result.sequence }, null, 2));
  } else {
    printText(result);
  }
  process.exitCode = result.findings.length === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    const exitCode = error instanceof SequenceInputError ? 2 : 1;
    console.error(`first-wave sequence: ${error.message}`);
    process.exitCode = exitCode;
  }
}
