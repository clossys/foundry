import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  DEFECT_ORIGINS,
  DERIVABLE_STATES,
  STATES,
  evaluatePrograms,
  isFailureFinding,
  readLifecycleStatuses,
  readWorkspacePackages,
  scanInvocationSites,
  stateIndex,
} from "./check-package-programs.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts/check-package-programs.mjs");

// Two layers, matching this repo's existing split: the pure evaluator is
// exercised with hand-built observations so a verdict is testable without a
// filesystem, and the CLI is exercised end-to-end so the exit contract and
// the real contract in docs/contracts are both covered.

const P = "@vespeneventures/thing";

// `manifestBins` is what the package's own manifest exposes, which the gate
// rule (docs/DECISIONS.md 11) grades. The default is one bin: a package that
// ships a gate is the ordinary case, and it keeps every ladder test above
// free of a rule they are not about.
function grade(
  entry,
  { sites = [], bins = [], status = "published", inWorkspace = true, programs, manifestBins = ["thing-check"] } = {},
) {
  return evaluatePrograms({
    contract: {
      programs: programs ?? { operation: { packages: [P], donors: [] } },
      packages: [entry],
    },
    distSites: new Map([[P, sites]]),
    binSites: new Map([[P, bins]]),
    lifecycleStatuses: new Map(status ? [[P, status]] : []),
    workspacePackages: new Set(inWorkspace ? [P] : []),
    workspaceBins: new Map([[P, manifestBins]]),
  });
}

const rules = (r) => r.findings.filter(isFailureFinding).map((f) => f.rule);

test("the ladder is ordered and its derivable states are a prefix of it", () => {
  assert.deepEqual(STATES, ["designed", "implemented", "staged", "published", "adopted", "grounded", "closed"]);
  assert.equal(stateIndex("staged") < stateIndex("published"), true);
  for (const s of DERIVABLE_STATES) assert.equal(STATES.includes(s), true);
  // grounded and closed must NOT be derivable here: observer measures them,
  // and a package cannot ground itself.
  assert.equal(DERIVABLE_STATES.has("grounded"), false);
  assert.equal(DERIVABLE_STATES.has("closed"), false);
});

test("a published package with no invocation site and no gap is a violation", () => {
  assert.deepEqual(rules(grade({ name: P, state: "published" })), ["state-ahead-of-evidence"]);
});

test("the same package passes once the shortfall is acknowledged", () => {
  const r = grade({ name: P, state: "published", gaps: [{ state: "staged", reason: "zero invocation sites anywhere in this repository", issue: 466 }] });
  assert.deepEqual(rules(r), []);
});

test("invocation sites alone never satisfy staged — a recorded failing run is required", () => {
  // The whole point: a gate that has only ever run green has been shown to
  // run, not to work.
  assert.deepEqual(rules(grade({ name: P, state: "published" }, { sites: ["ci.yml:10"] })), ["state-ahead-of-evidence"]);
  const withRun = grade(
    { name: P, state: "published", stagedBy: { run: "https://example/run/1", defectOrigin: "injected", defect: "set the ink token equal to the surface token", control: "the dark theme stayed clean in the same run" } },
    { sites: ["ci.yml:10"] },
  );
  assert.deepEqual(rules(withRun), []);
});

test("a stagedBy record must name a run, an origin, the defect, and the control", () => {
  // The gate checks the PRESENCE of this record, never its truth. That is why
  // every field names something a reader can go and check.
  const complete = { run: "https://example/run/1", defectOrigin: "injected", defect: "set the ink token equal to the surface token", control: "the dark theme stayed clean in the same run" };
  assert.deepEqual(rules(grade({ name: P, state: "published", stagedBy: complete }, { sites: ["ci.yml:10"] })), []);

  // `{}` used to satisfy staged outright.
  const empty = rules(grade({ name: P, state: "published", stagedBy: {} }, { sites: ["ci.yml:10"] }));
  assert.deepEqual(empty.slice(0, 4), [
    "staged-by-without-run",
    "staged-by-without-origin",
    "staged-by-without-defect",
    "staged-by-without-control",
  ]);
});

test("a local run counts as `run` when it carries its own reproduction", () => {
  // Requiring a CI URL would make `staged` unreachable for any gate whose CI
  // job is a REQUIRED status context: the only ways to make it go red are a
  // pull request that then carries a failing required check, or a push to the
  // default branch (this repository's ci.yml is `push: branches: [main]`, so
  // there is no scratch-branch path). A state reachable only by damaging
  // branch protection is not a state — the same argument state 3 already
  // accepts for injected defects.
  const base = { defectOrigin: "injected", defect: "set the ink token equal to the surface token", control: "the dark theme stayed clean in the same run" };
  const accepts = (run) => rules(grade({ name: P, state: "published", stagedBy: { ...base, run } }, { sites: ["ci.yml:10"] }));

  // Deliberately not a github.com slug: this repository must never name an
  // account or repository other than its own, and check-foreign-references
  // cannot tell an invented placeholder slug from a real peer — it caught
  // exactly this line.
  assert.deepEqual(accepts("https://example.invalid/actions/runs/1"), []);
  assert.deepEqual(
    accepts("LOCAL, no Actions URL exists. Reproduce: set --color-ink-primary equal to --color-surface-base in tokens.css, then run the contrast CLI over it; exits 1 with three findings."),
    [],
  );
  // A claim with nothing a reader could check is refused.
  assert.equal(accepts("it went red locally").includes("staged-by-without-run"), true);
  assert.equal(accepts("").includes("staged-by-without-run"), true);
});

test("a record with no control is refused, because a red alone proves nothing", () => {
  // The field most likely to be left out, and the one that carries the proof:
  // a gate that fails on ANY input is not a working gate, and a red run alone
  // cannot tell the two apart.
  const { control, ...noControl } = { run: "https://example/run/1", defectOrigin: "injected", defect: "set the ink token equal to the surface token", control: "the dark theme stayed clean in the same run" };
  const found = rules(grade({ name: P, state: "published", stagedBy: noControl }, { sites: ["ci.yml:10"] }));
  assert.equal(found.includes("staged-by-without-control"), true);
  assert.equal(found.includes("state-ahead-of-evidence"), true);
});

test("both defect origins are acceptable evidence; an unstated one is not", () => {
  // An injected violation is real in KIND, which is what state 3 requires.
  // Requiring natural origin would make staged reachable only by luck.
  assert.deepEqual([...DEFECT_ORIGINS].sort(), ["injected", "natural"]);
  for (const defectOrigin of DEFECT_ORIGINS) {
    const stagedBy = { ...{ run: "https://example/run/1", defectOrigin: "injected", defect: "set the ink token equal to the surface token", control: "the dark theme stayed clean in the same run" }, defectOrigin };
    assert.deepEqual(rules(grade({ name: P, state: "published", stagedBy }, { sites: ["ci.yml:10"] })), [], defectOrigin);
  }
  const vague = { ...{ run: "https://example/run/1", defectOrigin: "injected", defect: "set the ink token equal to the surface token", control: "the dark theme stayed clean in the same run" }, defectOrigin: "probably real" };
  assert.equal(rules(grade({ name: P, state: "published", stagedBy: vague }, { sites: ["ci.yml:10"] })).includes("staged-by-without-origin"), true);
});

test("an acknowledgement that outlives its reason is a violation", () => {
  const r = grade(
    { name: P, state: "published", stagedBy: { run: "https://example/run/1", defectOrigin: "injected", defect: "set the ink token equal to the surface token", control: "the dark theme stayed clean in the same run" }, gaps: [{ state: "staged", reason: "no invocation site exists yet at all", issue: 466 }] },
    { sites: ["ci.yml:10"] },
  );
  assert.deepEqual(rules(r), ["stale-gap"]);
});

test("a gap needs both a substantive reason and an issue", () => {
  assert.deepEqual(rules(grade({ name: P, state: "published", gaps: [{ state: "staged", reason: "todo", issue: 466 }] })), [
    "gap-without-reason",
    "state-ahead-of-evidence",
  ]);
  assert.deepEqual(rules(grade({ name: P, state: "published", gaps: [{ state: "staged", reason: "zero invocation sites anywhere here", issue: "466" }] })), [
    "gap-without-issue",
    "state-ahead-of-evidence",
  ]);
});

test("a state this repository cannot derive is never assumed satisfied", () => {
  // adopted, grounded and closed all need the consumer's tree or observer's
  // output. Silence about them must fail, not pass.
  for (const state of ["adopted", "grounded", "closed"]) {
    const r = grade({ name: P, state, gaps: [{ state: "staged", reason: "zero invocation sites anywhere here", issue: 466 }] });
    assert.equal(rules(r).includes("state-ahead-of-evidence"), true, `${state} was allowed through`);
  }
});

test("a retired package has left the ladder and is not graded for stopping", () => {
  // Supersession is a parallel axis, not a stage. Grading a retired package
  // against `published` would report it as running ahead of its evidence for
  // having been deliberately retired, which inverts the finding's meaning.
  const r = grade({ name: P, state: "published" }, { status: "retired" });
  assert.deepEqual(rules(r), []);
  assert.equal(r.results[0].supersession, "retired");
});

test("a retired package still carrying gaps is told to drop them", () => {
  // The gap list is a countdown. A gap on a retired package tracks work that
  // will never be done, which is how an acknowledgement outlives its reason.
  const r = grade(
    { name: P, state: "published", gaps: [{ state: "staged", reason: "zero invocation sites anywhere here", issue: 466 }] },
    { status: "retired" },
  );
  assert.deepEqual(rules(r), ["gap-on-a-retired-package"]);
  assert.deepEqual(r.results[0].acknowledgedGaps, []);
});

test("a deprecated package is still on the ladder, because it is still installable", () => {
  assert.deepEqual(rules(grade({ name: P, state: "published" }, { status: "deprecated" })), ["state-ahead-of-evidence"]);
  const ok = grade({ name: P, state: "published", gaps: [{ state: "staged", reason: "zero invocation sites anywhere here", issue: 466 }] }, { status: "deprecated" });
  assert.deepEqual(rules(ok), []);
  assert.equal(ok.results[0].supersession, "deprecated");
});

test("a bin-name invocation is reported and is not evidence of staging", () => {
  const r = grade({ name: P, state: "published" }, { bins: ["ci.yml:44"] });
  assert.equal(rules(r).includes("state-ahead-of-evidence"), true);
  assert.equal(r.findings.some((f) => f.rule === "invocation-by-bin-name" && f.severity === "note"), true);
});

test("a donor is a member of the programme retiring it", () => {
  const r = grade(
    { name: P, state: "published", gaps: [{ state: "staged", reason: "zero invocation sites anywhere here", issue: 466 }] },
    { programs: { expression: { packages: [], donors: [P] } } },
  );
  assert.deepEqual(rules(r), []);
  assert.equal(r.results[0].role, "donor");
});

test("a package in no programme, and a workspace package in no contract, both fail", () => {
  assert.equal(
    rules(grade({ name: P, state: "published", gaps: [{ state: "staged", reason: "zero invocation sites anywhere here", issue: 466 }] }, { programs: { operation: { packages: [], donors: [] } } })).includes("package-in-no-program"),
    true,
  );
  const r = evaluatePrograms({
    contract: { programs: { operation: { packages: [], donors: [] } }, packages: [] },
    distSites: new Map(),
    binSites: new Map(),
    lifecycleStatuses: new Map(),
    workspacePackages: new Set([P]),
  });
  assert.deepEqual(rules(r), ["undeclared-package"]);
});

// ---------------------------------------------- the gate rule (decision 11)

const staged = { state: "staged", reason: "zero invocation sites anywhere here", issue: 466 };
const noGate = { manifestBins: [] };

test("a package that ships a gate declares nothing and passes", () => {
  assert.deepEqual(rules(grade({ name: P, state: "published", gaps: [staged] })), []);
});

test("a package that ships no gate and says nothing about it is a violation", () => {
  // The whole point of decision 11: before it, a primitive that correctly
  // owes no gate and a package whose gate nobody built were the same absence.
  assert.deepEqual(rules(grade({ name: P, state: "published", gaps: [staged] }, noGate)), ["gate-not-declared"]);
});

test("declaring it, with a reason and an issue, passes", () => {
  const r = grade(
    { name: P, state: "published", gaps: [staged], shipsNoGate: { reason: "donor to a role nobody has cut yet", issue: 458 } },
    noGate,
  );
  assert.deepEqual(rules(r), []);
  assert.equal(r.results[0].shipsGate, false);
});

test("outside the primitive tier the declaration is a countdown: reason and issue both required", () => {
  assert.deepEqual(
    rules(grade({ name: P, state: "published", gaps: [staged], shipsNoGate: { reason: "short", issue: 458 } }, noGate)),
    ["no-gate-without-reason"],
  );
  assert.deepEqual(
    rules(grade({ name: P, state: "published", gaps: [staged], shipsNoGate: { reason: "donor to a role nobody has cut yet" } }, noGate)),
    ["no-gate-without-issue"],
  );
  assert.deepEqual(
    rules(
      grade(
        { name: P, state: "published", gaps: [staged], shipsNoGate: { reason: "donor to a role nobody has cut yet", permanent: true } },
        noGate,
      ),
    ),
    ["no-gate-claimed-permanent"],
  );
});

test("permanence is available only in the primitive tier, and takes no issue", () => {
  const tier = { programs: { foundation: { tier: "primitive", packages: [P], donors: [] } } };
  const ok = grade(
    { name: P, state: "published", gaps: [staged], shipsNoGate: { reason: "no addressee, therefore no question to judge", permanent: true } },
    { ...noGate, programs: tier.programs },
  );
  assert.deepEqual(rules(ok), []);

  const notPermanent = grade(
    { name: P, state: "published", gaps: [staged], shipsNoGate: { reason: "no addressee, therefore no question to judge", issue: 458 } },
    { ...noGate, programs: tier.programs },
  );
  assert.deepEqual(rules(notPermanent).sort(), ["no-gate-with-both", "no-gate-without-permanence"]);
});

test("a primitive that ships a gate is a contradiction, not a bonus", () => {
  const r = grade(
    { name: P, state: "published", gaps: [staged] },
    { programs: { foundation: { tier: "primitive", packages: [P], donors: [] } } },
  );
  assert.deepEqual(rules(r), ["primitive-ships-a-gate"]);
});

test("a declaration that outlived the gate it excused is stale, like a gap", () => {
  const r = grade({
    name: P,
    state: "published",
    gaps: [staged],
    shipsNoGate: { reason: "donor to a role nobody has cut yet", issue: 458 },
  });
  assert.deepEqual(rules(r), ["stale-no-gate-declaration"]);
});

test("an unreadable declaration is a finding, and a tier that is not `primitive` is a typo", () => {
  assert.deepEqual(rules(grade({ name: P, state: "published", gaps: [staged], shipsNoGate: "yes" }, noGate)), [
    "unreadable-no-gate",
  ]);
  const r = grade({ name: P, state: "published", gaps: [staged] }, { programs: { x: { tier: "core", packages: [P], donors: [] } } });
  assert.equal(rules(r).includes("unreadable-contract"), true);
});

test("a designed package has no manifest to grade, and a retired one has left the ladder", () => {
  // A rule about what a manifest exposes cannot be applied to a package that
  // does not exist yet, and must not be applied to one deliberately gone.
  assert.deepEqual(rules(grade({ name: P, state: "designed" }, { ...noGate, inWorkspace: false, status: null })), []);
  assert.deepEqual(rules(grade({ name: P, state: "published" }, { ...noGate, status: "retired" })), []);
});

test("an unparseable contract yields one finding and no results, never a pass", () => {
  for (const contract of [null, {}, { programs: {} }, { programs: {}, packages: {} }]) {
    const r = evaluatePrograms({ contract, distSites: new Map(), binSites: new Map(), lifecycleStatuses: new Map(), workspacePackages: new Set() });
    assert.equal(r.findings.length >= 1, true);
    assert.deepEqual(r.results, []);
  }
});

test("the scan finds a dist-path invocation and ignores a commented one", () => {
  const dir = mkdtempSync(join(tmpdir(), "programs-scan-"));
  try {
    mkdirSync(join(dir, "packages/thing"), { recursive: true });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "packages/thing/package.json"), JSON.stringify({ name: P, bin: { "thing-check": "./dist/cli.js" } }));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { check: "node packages/thing/dist/cli.js ." } }));
    writeFileSync(join(dir, "scripts/x.mjs"), "// node packages/thing/dist/cli.js -- a comment, not a site\nrun('thing-check');\n");

    const { distSites, binSites } = scanInvocationSites(dir, [P]);
    assert.deepEqual(distSites.get(P), ["package.json:1"]);
    assert.deepEqual(binSites.get(P), ["scripts/x.mjs:2"]);
    assert.deepEqual([...readWorkspacePackages(dir)], [P]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a package NAME used as test-fixture data is not an invocation site", () => {
  // The scanner's first extension counted any quoted occurrence of a package
  // name and reported six invocation sites for `auth`, all of them strings
  // like `entry("auth", "@vespeneventures/auth", "0.2.4")` inside another
  // script's tests. Naming a package is not using one.
  const dir = mkdtempSync(join(tmpdir(), "programs-fixture-"));
  try {
    mkdirSync(join(dir, "packages/thing"), { recursive: true });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "packages/thing/package.json"), JSON.stringify({ name: P }));
    writeFileSync(join(dir, "package.json"), "{}");
    writeFileSync(join(dir, "scripts/a.test.mjs"), `const row = entry("thing", "${P}", "1.0.0");\n`);
    writeFileSync(join(dir, "scripts/b.mjs"), `import { thing } from "${P}";\n`);

    const { distSites } = scanInvocationSites(dir, [P]);
    assert.deepEqual(distSites.get(P), ["scripts/b.mjs:1"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lifecycle statuses are read by name", () => {
  const s = readLifecycleStatuses({ packages: [{ name: P, status: "deprecated" }, { name: "x" }, "nope"] });
  assert.equal(s.get(P), "deprecated");
  assert.equal(s.size, 1);
});

test("this repository's own contract passes, and exits 0/1/2 correctly", () => {
  const out = execFileSync(process.execPath, [script, "--json"], { cwd: repoRoot, encoding: "utf8" });
  const { results, findings } = JSON.parse(out);
  assert.equal(results.length > 0, true);
  assert.deepEqual(findings.filter(isFailureFinding), []);

  // Every workspace package is graded, so the picture cannot be partial.
  for (const name of readWorkspacePackages(repoRoot)) {
    assert.equal(results.some((r) => r.package === name), true, `${name} is ungraded`);
  }

  // A positive control: the gate must actually fail on the defect it exists
  // for, not merely pass on a clean tree.
  const dir = mkdtempSync(join(tmpdir(), "programs-cli-"));
  try {
    const contract = JSON.parse(execFileSync(process.execPath, ["-e", "process.stdout.write(require('fs').readFileSync('docs/contracts/package-programs.json','utf8'))"], { cwd: repoRoot, encoding: "utf8" }));
    for (const p of contract.packages) if (p.name === "@vespeneventures/observer") delete p.gaps;
    const broken = join(dir, "broken.json");
    writeFileSync(broken, JSON.stringify(contract));
    assert.throws(() => execFileSync(process.execPath, [script, broken, repoRoot], { cwd: repoRoot, stdio: "pipe" }), (e) => e.status === 1);
    assert.throws(() => execFileSync(process.execPath, [script, join(dir, "absent.json"), repoRoot], { cwd: repoRoot, stdio: "pipe" }), (e) => e.status === 2);

    // The same control for the gate rule, against the real tree: drop the
    // primitive's declaration and the absent `bin` must stop being excused.
    const stripped = JSON.parse(execFileSync(process.execPath, ["-e", "process.stdout.write(require('fs').readFileSync('docs/contracts/package-programs.json','utf8'))"], { cwd: repoRoot, encoding: "utf8" }));
    for (const p of stripped.packages) if (p.name === "@vespeneventures/domain") delete p.shipsNoGate;
    const undeclared = join(dir, "undeclared-gate.json");
    writeFileSync(undeclared, JSON.stringify(stripped));
    assert.throws(
      () => execFileSync(process.execPath, [script, undeclared, repoRoot], { cwd: repoRoot, stdio: "pipe" }),
      (e) => e.status === 1 && `${e.stdout}`.includes("gate-not-declared"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
