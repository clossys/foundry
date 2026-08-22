#!/usr/bin/env node
// check-package-programs — fail when a package is declared further along its
// lifecycle than its evidence supports.
//
//   node scripts/check-package-programs.mjs [contractPath] [--json]
//
// docs/LIFECYCLE.md states seven states and one rule: a package's state is
// DERIVED FROM EVIDENCE, NEVER DECLARED. This gate is that rule made
// mechanical. Without it the document does not obey itself — every position
// in its table was measured by hand, once, and drifts the moment it is not
// re-measured (issue #466).
//
// Exit 0 = every declared position is supported, or its shortfall is
// acknowledged with a reason and an issue. Exit 1 = at least one position
// runs ahead of its evidence, or an acknowledgement is missing, malformed,
// or stale. Exit 2 = the check could not run — an unreadable contract, an
// unreadable workspace, an unparseable manifest. Same three-state contract
// every gate here uses: a check that cannot run must fail, never pass.
//
// WHY THIS GATE EXISTS
// ---------------------
// On 2026-08-22 three of the six operation packages had cleared every check
// this repository runs — a lifecycle entry, a visibility declaration, README
// parity, clean contamination classes, and between 76 and 171 test cases
// each — and had never been executed against a real tree by anything,
// including this repository. locksmith, integrator and observer each had
// ZERO executable invocation sites here. Nothing reported it, because every
// check in the chain graded a declaration rather than a use.
//
// The four expression packages were then measured the same way and are in
// the identical position: strategist, writer, designer and publisher have
// zero dist-path invocation sites, while this repository's own
// `check:contrast` still runs `packages/ui/dist/...` — the DEPRECATED donor
// designer replaces. The author's repository stages the package it is
// retiring and not the one it ships.
//
// WHY A SHORTFALL IS ACKNOWLEDGED, NOT BASELINED
// -----------------------------------------------
// The states are a ladder, and this repository published ten packages before
// the ladder existed. A gate that simply refused every position unsupported
// below it would report ten-plus violations on its first run and could never
// be wired as blocking, which makes it decorative.
//
// The alternative taken here is the one @vespeneventures/integrator already
// ships for exactly this shape: every opt-out carries a REQUIRED REASON. A
// shortfall must be declared, with prose saying what is actually missing and
// an issue tracking it. An UNACKNOWLEDGED shortfall is a violation. So the
// gate blocks the thing it exists to catch — a package quietly claiming a
// state it never reached — while the known, named backlog stays visible and
// countable rather than hidden in a baseline file nobody reads.
//
// A `gaps` entry for a state that now HAS evidence is itself a violation
// (`stale-gap`). The countdown must go down when the work lands; an
// acknowledgement that outlives its reason is how the five compatibility
// packages sat deprecated with nothing noticing.
//
// WHAT IS DERIVED AND WHAT IS NOT
// --------------------------------
// Derived here, from this repository's own tree:
//   implemented — the package directory exists and carries a manifest.
//   staged      — the count of DIST-PATH invocation sites across
//                 package.json scripts, scripts/, and .github/workflows/.
//   published   — the package's status in the lifecycle contract.
//
// Not derivable here, and therefore requiring a declaration with a pointer
// rather than defaulting to satisfied:
//   designed    — needs the loop-declaration grammar (#445). Not graded yet.
//   staged      — ALSO needs a recorded run in which the gate failed on a
//                 real defect. Invocation sites prove a gate RUNS; only a red
//                 run proves it WORKS. The absence of a failure is not
//                 evidence of success, so sites alone never satisfy staged.
//   adopted     — needs the consumer's tree: whether the gate is wired in
//                 blocking position, and whether the hand-written equivalent
//                 was deleted. Absence is what has to be proven, and only the
//                 consumer can prove it.
//   grounded    — needs observer's efficacy output. Currently zero for every
//                 package, because observer has no input.
//   closed      — needs the close condition to read satisfied.
//
// BIN-NAME INVOCATION IS NOT A SITE
// ----------------------------------
// A gate invoked by bin name rather than dist path has already been left
// silently unreachable in this fleet — the bin resolves to whatever the
// installer happened to link, which is not necessarily the package under
// test. Bin-name invocations are reported separately and never counted as
// evidence of staging.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const STATES = ["designed", "implemented", "staged", "published", "adopted", "grounded", "closed"];

/** States this gate can derive from the author's own repository. */
export const DERIVABLE_STATES = new Set(["implemented", "staged", "published"]);

/** Lifecycle statuses that mean "the registry can resolve this name". */
const PUBLISHED_STATUSES = new Set(["active", "incubating", "published", "qualified", "adopted", "deprecated"]);

// Supersession runs in PARALLEL with the ladder, not as a stage on it (see
// docs/LIFECYCLE.md). A retired package has left the ladder: it was published,
// its versions stay reserved, and it is now deliberately absent from the
// registry. Grading it against `published` would report a package as running
// ahead of its evidence for having been retired on purpose, which inverts the
// meaning of the finding.
//
// This is read from the LIFECYCLE contract rather than re-declared here. One
// concept declared in two contracts agrees only by luck, and the luck runs out
// exactly when the two are edited by different people at the same time --
// which is the situation this rule was written during.
const RETIRED_STATUS = "retired";

const SEARCH_ROOTS = ["scripts", ".github/workflows"];
const SEARCH_EXTENSIONS = new Set([".mjs", ".js", ".ts", ".yml", ".yaml", ".json", ".sh"]);
const MAX_FILE_BYTES = 2_000_000;

export function stateIndex(state) {
  return STATES.indexOf(state);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bareName(name) {
  const slash = name.indexOf("/");
  return slash === -1 ? name : name.slice(slash + 1);
}

function finding(rule, subject, message) {
  return { rule, severity: "error", subject, message };
}

function note(rule, subject, message) {
  return { rule, severity: "note", subject, message };
}

/** Every readable text file under the repository's own automation surface. */
function automationFiles(repoRoot) {
  const files = [join(repoRoot, "package.json")];
  for (const root of SEARCH_ROOTS) {
    const absolute = join(repoRoot, root);
    let entries;
    try {
      entries = readdirSync(absolute, { withFileTypes: true, recursive: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const dot = entry.name.lastIndexOf(".");
      if (dot === -1 || !SEARCH_EXTENSIONS.has(entry.name.slice(dot))) continue;
      files.push(join(entry.parentPath ?? entry.path ?? absolute, entry.name));
    }
  }
  return files;
}

/**
 * Scan the author's own automation for executable use of each package.
 *
 * Deliberately searches for the THING rather than enumerating where it is
 * expected to live: a conventional-path scan has already missed real
 * manifests, real override blocks, and a real gate in this fleet. Every file
 * under the automation surface is read and matched, and the caller is handed
 * the sites so a zero can be argued with rather than trusted.
 */
export function scanInvocationSites(repoRoot, packageNames, { readFile = (p) => readFileSync(p, "utf8") } = {}) {
  const distSites = new Map();
  const binSites = new Map();
  for (const name of packageNames) {
    distSites.set(name, []);
    binSites.set(name, []);
  }

  const binOwners = new Map();
  for (const name of packageNames) {
    let manifest;
    try {
      manifest = JSON.parse(readFile(join(repoRoot, "packages", bareName(name), "package.json")));
    } catch {
      continue;
    }
    for (const bin of Object.keys(manifest.bin ?? {})) binOwners.set(bin, name);
  }

  for (const file of automationFiles(repoRoot)) {
    let text;
    try {
      if (statSync(file).size > MAX_FILE_BYTES) continue;
      text = readFile(file);
    } catch {
      continue;
    }
    const where = relative(repoRoot, file);
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("#")) continue;
      for (const name of packageNames) {
        // TWO forms of executable use, because looking for only one is the
        // mistake this whole gate exists to catch -- and the mistake this
        // scanner itself made on its first extension. A CI step invokes a gate
        // by dist path; a caller script imports the package by name. Counting
        // only the first reported `observer` at zero sites while two files in
        // scripts/ imported it.
        const usesDistPath = line.includes(`packages/${bareName(name)}/dist`);
        // An IMPORT, not any quoted occurrence. A package name also appears as
        // ordinary test-fixture data -- `entry("auth", "@vespeneventures/auth",
        // "0.2.4")` -- and counting those reported six invocation sites for a
        // package nothing here invokes. `from`/`require(`/`import(` is what
        // separates using a package from naming one.
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const importsByName = new RegExp(`(from|require\\(|import\\()\\s*["']${escaped}(/[^"']*)?["']`).test(line);
        if (usesDistPath || importsByName) {
          distSites.get(name).push(`${where}:${i + 1}`);
        }
      }
      for (const [bin, owner] of binOwners) {
        if (new RegExp(`(^|[\\s"'\`/])${bin}([\\s"'\`]|$)`).test(line) && !line.includes(`packages/${bareName(owner)}/dist`)) {
          binSites.get(owner).push(`${where}:${i + 1}`);
        }
      }
    }
  }
  return { distSites, binSites };
}

/** Lifecycle status per package name, from the lifecycle contract. */
export function readLifecycleStatuses(document) {
  const statuses = new Map();
  if (!isRecord(document) || !Array.isArray(document.packages)) return statuses;
  for (const entry of document.packages) {
    if (isRecord(entry) && typeof entry.name === "string" && typeof entry.status === "string") {
      statuses.set(entry.name, entry.status);
    }
  }
  return statuses;
}

/**
 * Grade every declared position against the observations collected for it.
 *
 * Pure: takes a parsed contract and caller-collected observations, returns
 * findings. Every I/O decision — which files were read, which packages exist
 * on disk — belongs to the caller, so the judgment is testable without a
 * filesystem and a disputed verdict is re-checkable offline from the same
 * observation set.
 */
export function evaluatePrograms({ contract, distSites, binSites, lifecycleStatuses, workspacePackages }) {
  const findings = [];
  const results = [];

  if (!isRecord(contract)) {
    return { findings: [finding("unreadable-contract", "(contract)", "the contract is not an object")], results };
  }
  if (!isRecord(contract.programs)) {
    return { findings: [finding("unreadable-contract", "(contract)", "`programs` must be an object")], results };
  }
  if (!Array.isArray(contract.packages)) {
    return { findings: [finding("unreadable-contract", "(contract)", "`packages` must be an array")], results };
  }

  const declaredNames = new Set();
  const membership = new Map();
  for (const [programId, program] of Object.entries(contract.programs)) {
    if (!isRecord(program) || !Array.isArray(program.packages)) {
      findings.push(finding("unreadable-contract", programId, "a program must declare a `packages` array"));
      continue;
    }
    // A donor a programme is retiring is as much a member of it as the role
    // that replaces it. Supersession runs in parallel with the ladder rather
    // than after it, so a donor must not fall out of the picture the moment
    // its replacement ships -- that is exactly how five compatibility
    // packages sat deprecated with nothing noticing.
    for (const [role, names] of [["role", program.packages], ["donor", program.donors ?? []]]) {
      if (!Array.isArray(names)) {
        findings.push(finding("unreadable-contract", programId, "`donors` must be an array when present"));
        continue;
      }
      for (const name of names) {
        if (membership.has(name)) {
          findings.push(finding("package-in-two-programs", name, `declared by both "${membership.get(name).program}" and "${programId}"`));
        }
        membership.set(name, { program: programId, role });
      }
    }
  }

  for (const entry of contract.packages) {
    if (!isRecord(entry) || typeof entry.name !== "string") {
      findings.push(finding("unreadable-contract", "(packages)", "every package entry needs a string `name`"));
      continue;
    }
    const { name } = entry;
    declaredNames.add(name);

    if (!membership.has(name)) {
      findings.push(finding("package-in-no-program", name, "declared a state but belongs to no program"));
    }
    if (typeof entry.state !== "string" || stateIndex(entry.state) === -1) {
      findings.push(finding("unknown-state", name, `state must be one of: ${STATES.join(", ")}`));
      continue;
    }

    const reached = stateIndex(entry.state);
    const sites = distSites.get(name) ?? [];
    const bins = binSites.get(name) ?? [];
    const lifecycleStatus = lifecycleStatuses.get(name);

    // A retired package has left the ladder. Report where it stopped; do not
    // grade it for failing to go further, and do not require its `gaps` to be
    // maintained for states it will never reach.
    if (lifecycleStatus === RETIRED_STATUS) {
      if ((entry.gaps ?? []).length > 0) {
        findings.push(
          finding(
            "gap-on-a-retired-package",
            name,
            "the lifecycle contract records this name as retired, so it has left the ladder — remove its `gaps`, which now track work that will never be done",
          ),
        );
      }
      results.push({
        package: name,
        program: membership.get(name)?.program ?? null,
        role: membership.get(name)?.role ?? null,
        state: entry.state,
        supersession: RETIRED_STATUS,
        invocationSites: sites.length,
        binInvocations: bins.length,
        acknowledgedGaps: [],
      });
      continue;
    }

    // What the tree actually supports, independent of what was declared.
    const evidence = new Map();
    evidence.set("implemented", workspacePackages.has(name));
    // Sites prove the gate RUNS. Only a recorded red run proves it WORKS, and
    // that cannot be derived here — so staged is never satisfied by scan alone.
    evidence.set("staged", sites.length > 0 && isRecord(entry.stagedBy));
    evidence.set("published", PUBLISHED_STATUSES.has(lifecycleStatus ?? ""));

    const gaps = new Map();
    for (const gap of entry.gaps ?? []) {
      if (!isRecord(gap) || typeof gap.state !== "string" || stateIndex(gap.state) === -1) {
        findings.push(finding("unreadable-gap", name, "every gap needs a `state` drawn from the seven"));
        continue;
      }
      if (typeof gap.reason !== "string" || gap.reason.trim().length < 20) {
        findings.push(finding("gap-without-reason", name, `the gap at "${gap.state}" needs a reason saying what is actually missing`));
        continue;
      }
      if (!Number.isInteger(gap.issue)) {
        findings.push(finding("gap-without-issue", name, `the gap at "${gap.state}" needs an integer \`issue\` tracking it`));
        continue;
      }
      if (gaps.has(gap.state)) {
        findings.push(finding("duplicate-gap", name, `two gaps declared at "${gap.state}"`));
        continue;
      }
      gaps.set(gap.state, gap);
    }

    // Every state at or below the declared one must be supported or acknowledged.
    for (let i = 0; i <= reached; i += 1) {
      const state = STATES[i];
      const derivable = DERIVABLE_STATES.has(state);
      const supported = derivable ? evidence.get(state) === true : gaps.has(state) === false && state === "designed";

      if (derivable && supported) {
        if (gaps.has(state)) {
          findings.push(
            finding(
              "stale-gap",
              name,
              `the gap at "${state}" is acknowledged but the evidence now exists` +
                (state === "staged" ? ` (${sites.length} invocation site(s), and a stagedBy record)` : "") +
                ` — remove the gap and close its issue`,
            ),
          );
        }
        continue;
      }
      if (!derivable && state !== "designed") {
        // Not gradeable here. It must be acknowledged, never assumed.
        if (!gaps.has(state)) {
          findings.push(
            finding(
              "state-ahead-of-evidence",
              name,
              `declared "${entry.state}", which is at or above "${state}", but "${state}" cannot be derived in this repository ` +
                `and no evidence pointer or acknowledged gap declares it`,
            ),
          );
        }
        continue;
      }
      if (!supported && !gaps.has(state)) {
        const why =
          state === "staged"
            ? sites.length === 0
              ? `zero dist-path invocation sites in this repository` +
                (bins.length > 0 ? `, and ${bins.length} bin-name invocation(s), which are not evidence` : "")
              : `${sites.length} invocation site(s) but no \`stagedBy\` record naming a run in which it failed on a real defect`
            : state === "published"
              ? `the lifecycle contract records status "${lifecycleStatus ?? "(absent)"}"`
              : `no package directory found in the workspace`;
        findings.push(finding("state-ahead-of-evidence", name, `declared "${entry.state}" but "${state}" is unsupported: ${why}`));
      }
    }

    if (bins.length > 0 && sites.length === 0) {
      findings.push(
        note("invocation-by-bin-name", name, `invoked by bin name at ${bins.slice(0, 3).join(", ")} — a bin resolves to whatever the installer linked, so it is not evidence of staging`),
      );
    }

    results.push({
      package: name,
      program: membership.get(name)?.program ?? null,
      role: membership.get(name)?.role ?? null,
      state: entry.state,
      supersession: lifecycleStatus === "deprecated" ? "deprecated" : null,
      invocationSites: sites.length,
      binInvocations: bins.length,
      acknowledgedGaps: [...gaps.keys()],
    });
  }

  for (const name of workspacePackages) {
    if (!declaredNames.has(name)) {
      findings.push(finding("undeclared-package", name, "exists in the workspace but declares no lifecycle state"));
    }
  }

  return { findings, results };
}

export function isFailureFinding(f) {
  return f.severity === "error";
}

export function readWorkspacePackages(repoRoot) {
  const names = new Set();
  let entries;
  try {
    entries = readdirSync(join(repoRoot, "packages"), { withFileTypes: true });
  } catch {
    return names;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = JSON.parse(readFileSync(join(repoRoot, "packages", entry.name, "package.json"), "utf8"));
      if (typeof manifest.name === "string") names.add(manifest.name);
    } catch {
      // A directory with no readable manifest is not a package. Empty
      // directories are left behind locally by retirements and git does not
      // track them, so their absence from this set is correct, not a miss.
    }
  }
  return names;
}

function die(message) {
  console.error(`check-package-programs: ${message}`);
  process.exit(2);
}

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const positional = argv.filter((a) => !a.startsWith("--"));
  const repoRoot = resolve(positional[1] ?? ".");
  const contractPath = resolve(positional[0] ?? join(repoRoot, "docs/contracts/package-programs.json"));

  let contract;
  try {
    contract = JSON.parse(readFileSync(contractPath, "utf8"));
  } catch (error) {
    die(`could not read ${contractPath}: ${error?.message ?? error}`);
  }

  let lifecycleStatuses;
  try {
    lifecycleStatuses = readLifecycleStatuses(JSON.parse(readFileSync(join(repoRoot, "docs/contracts/package-lifecycle.json"), "utf8")));
  } catch (error) {
    die(`could not read the lifecycle contract: ${error?.message ?? error}`);
  }

  const workspacePackages = readWorkspacePackages(repoRoot);
  if (workspacePackages.size === 0) die(`no readable packages under ${join(repoRoot, "packages")} — refusing to grade an empty workspace`);

  const declared = (contract.packages ?? []).map((p) => p?.name).filter((n) => typeof n === "string");
  const { distSites, binSites } = scanInvocationSites(repoRoot, [...new Set([...declared, ...workspacePackages])]);

  const { findings, results } = evaluatePrograms({ contract, distSites, binSites, lifecycleStatuses, workspacePackages });

  if (json) {
    console.log(JSON.stringify({ results, findings }, null, 2));
  } else {
    for (const r of results) {
      console.log(
        `  [${String(r.state).padEnd(11)}] ${r.package.padEnd(32)} ${String(r.role ?? "?").padEnd(5)} sites=${String(r.invocationSites).padStart(2)}` +
          (r.acknowledgedGaps.length > 0 ? `  gaps: ${r.acknowledgedGaps.join(", ")}` : ""),
      );
    }
    console.log("");
    for (const f of findings) console.log(`  ${f.severity === "error" ? "FAIL" : "NOTE"}  ${f.rule}  ${f.subject} — ${f.message}`);
  }

  const errors = findings.filter(isFailureFinding);
  if (!json) {
    console.log("");
    console.log(
      errors.length === 0
        ? `PACKAGE PROGRAMS OK — ${results.length} package(s) graded; every declared position is supported by evidence or acknowledged with a reason and an issue.`
        : `PACKAGE PROGRAMS FAIL — ${errors.length} position(s) run ahead of their evidence. See docs/LIFECYCLE.md for what each state requires; a shortfall that is real and tracked belongs in the package's \`gaps\` with a reason and an issue, not left implicit.`,
    );
  }
  process.exit(errors.length === 0 ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => die(`unexpected error: ${error?.stack ?? error}`));
}
