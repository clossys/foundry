#!/usr/bin/env node
// check-package-evidence — fail when a package is declared further along its
// lifecycle than its evidence supports.
//
//   node scripts/check-package-evidence.mjs [contractPath] [--json]
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
// The alternative taken here is the one @clossys/integrator already
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
//   implemented — the current package directory exists and carries a
//                 manifest. A published predecessor outside the current
//                 workspace scope also retains this lower-rung evidence:
//                 publication could not have occurred without an
//                 implementation, and a namespace transition must not erase
//                 that historical fact merely because current source moved.
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
//
// THE GATE RULE (docs/DECISIONS.md 11)
// -------------------------------------
// Separate from the ladder, and graded here because this is the file that
// already knows every package's lifecycle status: every active package ships
// a gate behind a `bin`. A package with no role-shaped question does not
// belong in the active package set.
//
// The rule turns an absent `bin` from an absence into a decision. Before it,
// `domain`, `auth`, `comms`, and `consent` (published packages whose role gate
// nobody had built) were
// indistinguishable from outside: all four simply had no `bin`. The second
// case is why `packages/comms/src/dispatcher.ts` can treat an unwired policy
// as `allow` with no CLI anywhere that could fail on it.
//
// A declaration therefore requires an integer `issue`: it is a countdown,
// exactly like `gaps`. No active package may claim a permanent exemption. A
// package that ships a `bin` and still declares `shipsNoGate` is a stale
// declaration and fails, for the same reason a `gaps` entry that outlived its
// reason does. Retired packages are exempt: they have left the ladder.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  currentQualificationJoins,
  parseStrictJson,
  qualificationPath,
  qualificationRecordHistory,
  validateCandidateQualification,
  validateTrioPublicationClosure,
} from "./lib/candidate-qualification.mjs";
import { TRIO_PUBLICATION_PATH, validateTrioFirstPublication } from "./lib/release-publication-cohort.mjs";
import { TRIO_COHORT_PATH, TRIO_CONTROL_TAIL_AUTHORIZATION_PATH } from "./lib/release-qualification-trio.mjs";
import { readValidatedLaterPublishedPackages } from "./lib/release-later-publication.mjs";

export const STATES = ["designed", "implemented", "staged", "published", "adopted", "grounded", "closed"];
export const LIFECYCLE_POSITION_START = "<!-- lifecycle-position-table:start -->";
export const LIFECYCLE_POSITION_END = "<!-- lifecycle-position-table:end -->";

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
const STARTER_PACKAGE = "@clossys/starter";
const STARTER_ADAPTER_PATH = "governance/release-qualification-adapters/starter/current-direct.json";

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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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
        // ordinary test-fixture data -- `entry("auth", "@example/auth",
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

/**
 * Recognize the one data-driven staging site that an ordinary source scan
 * cannot see: Starter's package-authentic current-direct qualification.
 *
 * The generic qualification runner executes the installed dist CLI from an
 * adapter, so neither the adapter nor its transcript contains a static source
 * import for scanInvocationSites to count. Crediting every qualification JSON
 * would recreate the declaration-as-evidence bug this gate exists to prevent.
 * This helper therefore admits only the exact current @clossys/starter
 * identity, the exact retained adapter bytes, and a fully validated v2 or v3
 * transcript whose raw package-authentic cases cover native 0/1/2 outcomes.
 */
export function packageAuthenticStarterQualificationSite({ packageName, manifestVersion, adapterBytes, record, expected }) {
  if (packageName !== STARTER_PACKAGE || typeof manifestVersion !== "string") return null;

  let adapter;
  try {
    adapter = parseStrictJson(adapterBytes);
  } catch {
    return null;
  }
  if (
    adapter?.schemaVersion !== 1 ||
    adapter?.package !== packageName ||
    adapter?.archetype !== "current-direct" ||
    adapter?.retainRawCaseEvidence !== true ||
    sha256(adapterBytes) !== record?.candidate?.adapterSha256
  ) {
    return null;
  }

  const validation = validateCandidateQualification(record, expected ? { expected } : undefined);
  const transcript = record?.transcript;
  const rawTranscript = (transcript?.schema === "foundry-candidate-qualification-transcript-v2" && transcript?.version === 2)
    || (transcript?.schema === "foundry-candidate-qualification-transcript-v3" && transcript?.version === 3);
  const caseObservations = Array.isArray(transcript?.observations)
    ? transcript.observations.filter((observation) => observation?.kind === "case")
    : [];
  const adapterExits = Array.isArray(adapter?.cases) ? [...new Set(adapter.cases.map((item) => item?.exitCode))].sort() : [];
  const transcriptExits = [...new Set(caseObservations.map((item) => item?.observedExitCode))].sort();
  if (
    validation.length > 0 ||
    record?.timing !== "pre-publication" ||
    record?.candidate?.name !== packageName ||
    record?.candidate?.version !== manifestVersion ||
    !rawTranscript ||
    transcript?.candidate?.name !== packageName ||
    transcript?.candidate?.version !== manifestVersion ||
    transcript?.archetype !== "current-direct" ||
    transcript?.ok !== true ||
    transcript?.coverage?.installedManifestSha256 !== record?.candidate?.packageManifestSha256 ||
    JSON.stringify(adapterExits) !== JSON.stringify([0, 1, 2]) ||
    JSON.stringify(transcriptExits) !== JSON.stringify([0, 1, 2]) ||
    caseObservations.some((observation) => !isRecord(observation.rawCaseEvidence))
  ) {
    return null;
  }

  return `governance/release-qualifications/clossys-starter-${manifestVersion}.json#transcript:current-direct`;
}

/** Resolve Starter's site from exact retained repository evidence, fail closed. */
export function readPackageAuthenticQualificationSites(repoRoot) {
  const sites = new Map([[STARTER_PACKAGE, []]]);
  try {
    const manifest = parseStrictJson(readFileSync(join(repoRoot, "packages/starter/package.json"), "utf8"));
    if (manifest?.name !== STARTER_PACKAGE || typeof manifest?.version !== "string") return sites;
    const candidate = { name: manifest.name, version: manifest.version };
    const recordPath = qualificationPath(repoRoot, candidate);
    const record = parseStrictJson(readFileSync(join(repoRoot, recordPath), "utf8"));
    const history = qualificationRecordHistory(repoRoot, recordPath, candidate);
    if (history.introducedRecordSha256 !== history.retainedRecordSha256) return sites;
    const expected = { name: candidate.name, version: candidate.version, ...currentQualificationJoins(repoRoot, candidate, history.introductionCommit) };
    const adapterBytes = readFileSync(join(repoRoot, STARTER_ADAPTER_PATH), "utf8");
    const site = packageAuthenticStarterQualificationSite({
      packageName: candidate.name,
      manifestVersion: candidate.version,
      adapterBytes,
      record,
      expected,
    });
    if (site) sites.set(STARTER_PACKAGE, [site]);
  } catch {
    // Absence, malformed evidence, or unverifiable Git history earns no site.
    // The ordinary lifecycle comparison then reports the unsupported rung.
  }
  return sites;
}

/**
 * Derive current-scope publication only from the exact validated first-publication
 * record. Lifecycle status alone predates publication and cannot prove it.
 */
export function readValidatedPublishedPackages(repoRoot) {
  try {
    const publication = parseStrictJson(readFileSync(join(repoRoot, TRIO_PUBLICATION_PATH), "utf8"));
    const cohortBytes = readFileSync(join(repoRoot, TRIO_COHORT_PATH), "utf8");
    const cohort = parseStrictJson(cohortBytes);
    const records = new Map();
    const recordBytes = new Map();
    const validatedRecordPaths = new Set();

    for (const member of publication.members ?? []) {
      const path = member?.qualification?.path;
      if (typeof path !== "string") return new Set();
      const bytes = readFileSync(join(repoRoot, path), "utf8");
      const record = parseStrictJson(bytes);
      const history = qualificationRecordHistory(repoRoot, path, record.candidate);
      if (history.introducedRecordSha256 !== history.retainedRecordSha256) return new Set();
      const expected = {
        name: record.candidate?.name,
        version: record.candidate?.version,
        ...currentQualificationJoins(repoRoot, record.candidate, history.introductionCommit),
      };
      if (validateCandidateQualification(record, { expected }).length > 0) return new Set();
      records.set(path, record);
      recordBytes.set(path, bytes);
      validatedRecordPaths.add(path);
    }

    if (validateTrioFirstPublication(publication, { cohort, cohortBytes, records, recordBytes, validatedRecordPaths }).length > 0) return new Set();
    const controlTailAuthorization = parseStrictJson(readFileSync(join(repoRoot, TRIO_CONTROL_TAIL_AUTHORIZATION_PATH), "utf8"));
    if (validateTrioPublicationClosure(publication, {
      root: repoRoot,
      trioRecords: [...records.values()],
      cohortBytes,
      controlTailAuthorization,
    }).length > 0) return new Set();
    const sealed = publication.members.map((member) => records.get(member.qualification.path)?.candidate?.name).filter(Boolean);
    return new Set([...sealed, ...readValidatedLaterPublishedPackages(repoRoot)]);
  } catch {
    return new Set();
  }
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

/** The two origins a recorded red run can have. Both are acceptable; being unable to tell them apart is not. */
/** A local run stands in for a URL only if it carries enough for a reader to reproduce it. */
const MIN_REPRODUCTION_LENGTH = 60;

export const DEFECT_ORIGINS = new Set(["injected", "natural"]);
/**
 * `role` is the historical default. Explicit executable tooling has a
 * runnable contract but does not invent a job, metric, mode, or position in
 * the role-loop charter.
 */
export const PACKAGE_CATEGORIES = new Set(["role", "executable-tooling"]);

/**
 * Validate a `stagedBy` record — the one piece of evidence on this ladder that
 * cannot be derived from the tree.
 *
 * This gate checks the PRESENCE of the record, never the truth of it: no scan
 * can confirm that a linked run really went red for the reason claimed. That
 * is exactly why the required fields are what they are — each names something
 * a reader can go and check, so the record is a pointer to evidence rather
 * than a summary of it.
 *
 * `control` is required, and it is the field most likely to be left out. A
 * gate that fails on ANY input is not a working gate, and a red run alone
 * cannot distinguish the two, so a record with no control names a failure
 * nobody can interpret. The first real candidate in this repository DID have
 * a control and its author had not noticed it was one — reporting it as a
 * feature of the gate rather than as the half that made the red mean
 * anything. Requiring the field is what stops the next one omitting it.
 *
 * `defectOrigin` is required for the same reason, and not because one origin
 * outranks the other: an injected violation is fully acceptable evidence (see
 * docs/LIFECYCLE.md state 3 — real in kind, not in origin). What is not
 * acceptable is a reader being unable to tell which they are looking at
 * without parsing someone's prose.
 */
export function validateStagedBy(value, name, findings) {
  if (value === undefined) return false;
  if (!isRecord(value)) {
    findings.push(finding("unreadable-staged-by", name, "`stagedBy` must be an object"));
    return false;
  }
  let ok = true;
  // `run` must let a READER VERIFY THE CLAIM, which a URL does by inspection
  // and a local run does by reproduction. Both are acceptable, and requiring a
  // CI URL would be wrong: for a gate whose CI job is a REQUIRED status
  // context, the only ways to make it go red are a pull request that then
  // carries a failing required check, or a push to the default branch. This
  // repository's ci.yml is `push: branches: [main]`, so there is no
  // scratch-branch path either. Demanding a URL would make `staged` reachable
  // only by damaging the branch protection the gate exists to serve -- the
  // same shape as demanding a natural defect, which state 3 already rejects.
  //
  // Unlike `defectOrigin`, this needs no field of its own: which kind it is
  // can be read off the value. An unverifiable claim needs a declared field; a
  // derivable one does not.
  const run = typeof value.run === "string" ? value.run.trim() : "";
  const isUrl = /^https?:\/\//.test(run);
  if (run === "" || (!isUrl && run.length < MIN_REPRODUCTION_LENGTH)) {
    findings.push(
      finding(
        "staged-by-without-run",
        name,
        "`stagedBy.run` must be either a URL to the recorded run, or -- when the gate's CI job is a required status context and " +
          "no such URL can exist without breaking it -- a local run described in enough detail to reproduce: the input, the command, and what it printed",
      ),
    );
    ok = false;
  }
  if (!DEFECT_ORIGINS.has(value.defectOrigin)) {
    findings.push(
      finding(
        "staged-by-without-origin",
        name,
        `\`stagedBy.defectOrigin\` must be one of: ${[...DEFECT_ORIGINS].join(", ")} — both are acceptable evidence, being unable to tell them apart is not`,
      ),
    );
    ok = false;
  }
  for (const [field, what] of [
    ["defect", "what actually went wrong, in terms a reader could reproduce"],
    ["control", "what stayed GREEN in the same run — without one, a red proves the gate fails, not that it discriminates"],
  ]) {
    if (typeof value[field] !== "string" || value[field].trim().length < 20) {
      findings.push(finding(`staged-by-without-${field}`, name, `\`stagedBy.${field}\` must say ${what}`));
      ok = false;
    }
  }
  return ok;
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
/**
 * Grade one package against the gate rule (docs/DECISIONS.md 11).
 *
 * Pure, and separate from the ladder on purpose: shipping a gate is not a
 * rung, it is a property a package either has or has declared it will never
 * have. Returns findings only — a package that ships a `bin` and declares
 * nothing is the ordinary, silent pass.
 */
export function evaluateGateRule({ name, entry, bins }) {
  const findings = [];
  const declaration = entry.shipsNoGate;
  const shipsGate = bins.length > 0;

  if (declaration !== undefined && !isRecord(declaration)) {
    findings.push(finding("unreadable-no-gate", name, "`shipsNoGate`, when present, must be an object with a `reason`"));
    return { findings, shipsGate };
  }

  if (shipsGate) {
    if (declaration) {
      findings.push(
        finding(
          "stale-no-gate-declaration",
          name,
          `declares it ships no gate, but its manifest exposes ${bins.length} bin entry point(s) (${bins.join(", ")}) — remove the declaration`,
        ),
      );
    }
    return { findings, shipsGate };
  }

  if (!declaration) {
    findings.push(
      finding(
        "gate-not-declared",
        name,
        "exposes no `bin` and does not declare `shipsNoGate` — an absent gate must be a decision with a reason, not an absence " +
          "indistinguishable from one nobody remembered to build (docs/DECISIONS.md 11)",
      ),
    );
    return { findings, shipsGate };
  }

  if (typeof declaration.reason !== "string" || declaration.reason.trim().length < 20) {
    findings.push(finding("no-gate-without-reason", name, "`shipsNoGate` needs a reason saying why this package judges nothing"));
  }

  if (declaration.permanent === true) {
    findings.push(
      finding(
        "no-gate-claimed-permanent",
        name,
        "claims it will never owe a gate — active packages may only use temporary, issue-backed compatibility exceptions",
      ),
    );
  } else if (!Number.isInteger(declaration.issue)) {
    findings.push(
      finding(
        "no-gate-without-issue",
        name,
        "`shipsNoGate` needs an integer `issue`: it is a countdown, like `gaps`, not a standing exemption",
      ),
    );
  }

  return { findings, shipsGate };
}

export function evaluatePrograms({
  contract,
  distSites,
  binSites,
  lifecycleStatuses,
  workspacePackages,
  workspaceBins = new Map(),
  workspaceScope,
  publishedPackages = new Set(),
}) {
  const findings = [];
  const results = [];

  if (!isRecord(contract)) {
    return { findings: [finding("unreadable-contract", "(contract)", "the contract is not an object")], results };
  }
  if (!Array.isArray(contract.packages)) {
    return { findings: [finding("unreadable-contract", "(contract)", "`packages` must be an array")], results };
  }

  const declaredNames = new Set();
  for (const entry of contract.packages) {
    if (!isRecord(entry) || typeof entry.name !== "string") {
      findings.push(finding("unreadable-contract", "(packages)", "every package entry needs a string `name`"));
      continue;
    }
    const { name } = entry;
    declaredNames.add(name);

    const category = entry.category === undefined ? "role" : entry.category;
    if (!PACKAGE_CATEGORIES.has(category)) {
      findings.push(finding("unknown-package-category", name, `category must be one of: ${[...PACKAGE_CATEGORIES].join(", ")}`));
      continue;
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
        category,
        state: entry.state,
        supersession: RETIRED_STATUS,
        invocationSites: sites.length,
        binInvocations: bins.length,
        // The gate rule is not applied to a retired package for the same
        // reason the ladder is not: it has left. Reported, never graded.
        shipsGate: (workspaceBins.get(name) ?? []).length > 0,
        acknowledgedGaps: [],
        // Preserve the last recorded position evidence after retirement; this
        // cell is descriptive and retired packages are not ladder-graded.
        stagedHere: true,
      });
      continue;
    }

    // What the tree actually supports, independent of what was declared.
    const evidence = new Map();
    const publishedPredecessor =
      typeof workspaceScope === "string" &&
      workspaceScope.startsWith("@") &&
      !name.startsWith(`${workspaceScope}/`) &&
      PUBLISHED_STATUSES.has(lifecycleStatus ?? "");
    evidence.set("implemented", workspacePackages.has(name) || publishedPredecessor);
    // Sites prove the gate RUNS. Only a recorded red run proves it WORKS, and
    // that cannot be derived here — so staged is never satisfied by scan alone.
    const stagedByOk = validateStagedBy(entry.stagedBy, name, findings);
    evidence.set("staged", sites.length > 0 && stagedByOk);
    evidence.set("published", PUBLISHED_STATUSES.has(lifecycleStatus ?? "") && (publishedPredecessor || publishedPackages.has(name)));

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

    // The gate rule (docs/DECISIONS.md 11), graded only where there is a
    // package to observe: a role still at "designed" has no manifest, and a
    // rule about what a manifest exposes cannot be applied to one that does
    // not exist yet.
    let shipsGate = false;
    if (workspacePackages.has(name)) {
      const gate = evaluateGateRule({
        name,
        entry,
        bins: workspaceBins.get(name) ?? [],
      });
      findings.push(...gate.findings);
      shipsGate = gate.shipsGate;
    }

    results.push({
      package: name,
      category,
      state: entry.state,
      supersession: lifecycleStatus === "deprecated" ? "deprecated" : null,
      invocationSites: sites.length,
      binInvocations: bins.length,
      shipsGate,
      acknowledgedGaps: [...gaps.keys()],
      stagedHere: evidence.get("staged") === true,
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

function markdownCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

/**
 * The committed position table in docs/LIFECYCLE.md is generated from the
 * same evaluated results the gate prints. Executable tooling has no consumer
 * role loop, so adoption, grounding, and closure are N/A rather than a
 * fabricated unknown. Roles still report grounding as unknown: #484 has not
 * supplied independent landed-change outcomes, so an apparent zero escape
 * rate would be a measurement gap, not a result.
 */
export function renderLifecyclePositionTable({ contract, results }) {
  const rows = [
    LIFECYCLE_POSITION_START,
    "",
    "| package | current position | staged here | adoption | grounding | closure |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const result of results) {
    const staged = result.stagedHere === true ? "yes" : "not yet";
    const tooling = result.category === "executable-tooling";
    const notApplicable = "N/A — executable tooling";
    const adoption = tooling ? notApplicable : stateIndex(result.state) >= stateIndex("adopted") && !result.acknowledgedGaps.includes("adopted") ? "yes" : "not yet";
    const grounding = tooling ? notApplicable : stateIndex(result.state) >= stateIndex("grounded") && !result.acknowledgedGaps.includes("grounded") ? "yes" : "unknown — #484";
    const closure = tooling ? notApplicable : stateIndex(result.state) >= stateIndex("closed") && !result.acknowledgedGaps.includes("closed") ? "yes" : "not yet";
    // Retirement is the current position, not the last evidence rung the
    // package happened to reach before it left the active catalogue.
    const displayState = result.supersession === RETIRED_STATUS ? RETIRED_STATUS : result.state;
    rows.push(
      `| \`${markdownCell(result.package)}\` | ${markdownCell(displayState)} | ${staged} | ${adoption} | ${grounding} | ${closure} |`,
    );
  }
  rows.push("", LIFECYCLE_POSITION_END);
  return `${rows.join("\n")}\n`;
}

export function replaceLifecyclePositionTable(document, rendered) {
  const start = document.indexOf(LIFECYCLE_POSITION_START);
  const end = document.indexOf(LIFECYCLE_POSITION_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`missing ${LIFECYCLE_POSITION_START} / ${LIFECYCLE_POSITION_END} markers`);
  }
  const afterEnd = end + LIFECYCLE_POSITION_END.length;
  // `rendered` owns the marker and its terminating newline. Canonicalize the
  // boundary that follows it too: a write must not preserve (and therefore
  // accumulate) blank lines left by an earlier generated block. One blank
  // line is the document's canonical separation before the next prose.
  const replacement = `${rendered.replace(/\n*$/, "\n")}`;
  const following = document.slice(afterEnd).replace(/^\n+/, "");
  return `${document.slice(0, start)}${replacement}${following === "" ? "" : `\n${following}`}`;
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

/**
 * Bin entry-point names per package, read from each manifest on disk.
 *
 * Read from the manifest rather than from the contract for the same reason
 * every state above is derived rather than declared: what a package installs
 * is a fact about the package, and a second copy of that fact in a contract
 * agrees with the first only by luck.
 */
export function readWorkspaceBins(repoRoot) {
  const bins = new Map();
  let entries;
  try {
    entries = readdirSync(join(repoRoot, "packages"), { withFileTypes: true });
  } catch {
    return bins;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = JSON.parse(readFileSync(join(repoRoot, "packages", entry.name, "package.json"), "utf8"));
      if (typeof manifest.name !== "string") continue;
      const bin = manifest.bin;
      bins.set(manifest.name, typeof bin === "string" ? [manifest.name] : Object.keys(bin ?? {}));
    } catch {
      // Same as readWorkspacePackages: a directory with no readable manifest
      // is not a package, and is not silently credited with anything either.
    }
  }
  return bins;
}

function die(message) {
  console.error(`check-package-evidence: ${message}`);
  process.exit(2);
}

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const render = argv.includes("--render-lifecycle-position");
  const write = argv.includes("--write-lifecycle-position");
  if (render && write) die("--render-lifecycle-position and --write-lifecycle-position cannot be used together");
  const positional = argv.filter((a) => !a.startsWith("--"));
  const repoRoot = resolve(positional[1] ?? ".");
  const contractPath = resolve(positional[0] ?? join(repoRoot, "docs/contracts/package-evidence.json"));

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

  let workspaceScope;
  try {
    const scopeDocument = JSON.parse(readFileSync(join(repoRoot, "package-scope.json"), "utf8"));
    if (typeof scopeDocument.scope !== "string" || !/^@[a-z0-9][a-z0-9-]*$/.test(scopeDocument.scope)) {
      throw new Error("`scope` must be an npm scope");
    }
    workspaceScope = scopeDocument.scope;
  } catch (error) {
    die(`could not read the package scope: ${error?.message ?? error}`);
  }

  const workspacePackages = readWorkspacePackages(repoRoot);
  if (workspacePackages.size === 0) die(`no readable packages under ${join(repoRoot, "packages")} — refusing to grade an empty workspace`);

  const declared = (contract.packages ?? []).map((p) => p?.name).filter((n) => typeof n === "string");
  const { distSites, binSites } = scanInvocationSites(repoRoot, [...new Set([...declared, ...workspacePackages])]);
  for (const [name, sites] of readPackageAuthenticQualificationSites(repoRoot)) {
    distSites.set(name, [...(distSites.get(name) ?? []), ...sites]);
  }

  const workspaceBins = readWorkspaceBins(repoRoot);
  const publishedPackages = readValidatedPublishedPackages(repoRoot);
  const { findings, results } = evaluatePrograms({
    contract,
    distSites,
    binSites,
    lifecycleStatuses,
    workspacePackages,
    workspaceBins,
    workspaceScope,
    publishedPackages,
  });
  let roleNames;
  try {
    const roleDocument = JSON.parse(readFileSync(join(repoRoot, "docs/contracts/role-loop-archetypes.json"), "utf8"));
    if (!isRecord(roleDocument.roles)) throw new Error("`roles` must be an object");
    roleNames = new Set(Object.keys(roleDocument.roles));
  } catch (error) {
    findings.push(finding("role-inventory-unreadable", "docs/contracts/role-loop-archetypes.json", `${error instanceof Error ? error.message : String(error)}`));
    roleNames = new Set();
  }
  for (const role of roleNames) {
    if (!workspacePackages.has(role)) findings.push(finding("role-package-missing", role, "has a durable role charter but no workspace package"));
  }
  const categoriesByName = new Map(results.map((result) => [result.package, result.category]));
  for (const name of workspacePackages) {
    const category = categoriesByName.get(name);
    if (category === "role" && !roleNames.has(name)) {
      findings.push(finding("unqualified-role-package", name, "is classified as a role but has no durable charter in the role-loop contract"));
    }
    if (category === "executable-tooling" && roleNames.has(name)) {
      findings.push(finding("role-misclassified-as-tooling", name, "has a durable role charter and cannot be classified as executable tooling"));
    }
  }
  const lifecycleDocumentPath = join(repoRoot, "docs/LIFECYCLE.md");
  // Terminal historical identities stay in the evidence contract, but the
  // generated current-position view must not turn retired namespace rows
  // into live install guidance after an identity transition.
  const currentResults = results.filter((result) => result.supersession !== RETIRED_STATUS);
  const renderedPosition = renderLifecyclePositionTable({ contract, results: currentResults });

  if (render) {
    process.stdout.write(renderedPosition);
    process.exit(findings.filter(isFailureFinding).length === 0 ? 0 : 1);
  }

  let lifecycleDocument;
  try {
    lifecycleDocument = readFileSync(lifecycleDocumentPath, "utf8");
    if (write) {
      writeFileSync(lifecycleDocumentPath, replaceLifecyclePositionTable(lifecycleDocument, renderedPosition));
      console.log(`Updated ${relative(repoRoot, lifecycleDocumentPath)} from docs/contracts/package-evidence.json.`);
    } else if (!lifecycleDocument.includes(renderedPosition)) {
      findings.push(
        finding(
          "lifecycle-position-table-drift",
          "docs/LIFECYCLE.md",
          "the generated lifecycle position table does not match docs/contracts/package-evidence.json; regenerate it with `node scripts/check-package-evidence.mjs --write-lifecycle-position`",
        ),
      );
    }
  } catch (error) {
    findings.push(finding("lifecycle-position-table-unreadable", "docs/LIFECYCLE.md", `${error instanceof Error ? error.message : String(error)}`));
  }

  if (json) {
    console.log(JSON.stringify({ results, findings }, null, 2));
  } else {
    for (const r of results) {
      console.log(
        `  [${String(r.state).padEnd(11)}] ${r.package.padEnd(32)} ${r.shipsGate ? "gate" : "----"} sites=${String(r.invocationSites).padStart(2)}` +
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
        ? `PACKAGE EVIDENCE OK — ${results.length} package(s) graded; every declared position is supported by evidence or acknowledged with a reason and an issue.`
        : `PACKAGE EVIDENCE FAIL — ${errors.length} position(s) run ahead of their evidence. See docs/LIFECYCLE.md for what each state requires; a shortfall that is real and tracked belongs in the package's \`gaps\` with a reason and an issue, not left implicit.`,
    );
  }
  process.exit(errors.length === 0 ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => die(`unexpected error: ${error?.stack ?? error}`));
}
