import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  DEFECT_ORIGINS,
  DERIVABLE_STATES,
  PACKAGE_CATEGORIES,
  STATES,
  evaluatePrograms,
  isFailureFinding,
  packageAuthenticStarterQualificationSite,
  readLifecycleStatuses,
  readValidatedPublishedPackageNames,
  readValidatedPublishedPackages,
  readWorkspacePackages,
  renderLifecyclePositionTable,
  replaceLifecyclePositionTable,
  scanInvocationSites,
  stateIndex,
} from "./check-package-evidence.mjs";
import { TRIO_PUBLICATION_PATH, TRIO_PUBLICATION_TRANSITION_PATHS } from "./lib/release-publication-cohort.mjs";
import { validateRetainedLaterPublications } from "./lib/release-later-publication.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts/check-package-evidence.mjs");

// Two layers, matching this repo's existing split: the pure evaluator is
// exercised with hand-built observations so a verdict is testable without a
// filesystem, and the CLI is exercised end-to-end so the exit contract and
// the real contract in docs/contracts are both covered.

const P = "@clossys/thing";

// `manifestBins` is what the package's own manifest exposes, which the gate
// rule (docs/DECISIONS.md 11) grades. The default is one bin: a package that
// ships a gate is the ordinary case, and it keeps every ladder test above
// free of a rule they are not about.
//
// `version` is the package's CURRENT manifest version, and `publication`
// controls what `readValidatedPublishedPackages` is stood in for (#875):
// `true` (the default) means "published at exactly the current version",
// `false` means "nothing published", and a string or array of strings is
// taken as the literal validated `name@version` identity/identities — which
// is how the version-mismatch and cross-package controls below are built,
// without needing a real retained-publication fixture on disk for every one.
function grade(
  entry,
  {
    sites = [],
    bins = [],
    status = "published",
    inWorkspace = true,
    manifestBins = ["thing-check"],
    workspaceScope = "@clossys",
    publication = true,
    version = "1.0.0",
  } = {},
) {
  const publishedIdentities = publication === true
    ? [`${P}@${version}`]
    : publication === false
      ? []
      : Array.isArray(publication) ? publication : [publication];
  return evaluatePrograms({
    contract: {
      packages: [entry],
    },
    distSites: new Map([[P, sites]]),
    binSites: new Map([[P, bins]]),
    lifecycleStatuses: new Map(status ? [[P, status]] : []),
    workspacePackages: new Set(inWorkspace ? [P] : []),
    workspaceBins: new Map([[P, manifestBins]]),
    workspaceScope,
    publishedPackages: new Set(publishedIdentities),
    workspacePackageVersions: new Map(inWorkspace ? [[P, version]] : []),
  });
}

const rules = (r) => r.findings.filter(isFailureFinding).map((f) => f.rule);

// `readValidatedPublishedPackages` returns `name@version` IDENTITIES, never
// bare names (#875) — every retained record in
// governance/release-publications/later, plus the three Trio members sealed
// at their own first-publication versions. Measured directly against this
// repository's own tree; see the correction on issue #875 for how this list
// was derived (`governance/release-publications/later/*.json` file names,
// joined with `governance/release-publications/clossys-npmjs-trio.json`'s
// three sealed qualification records).
const CURRENT_PUBLISHED_IDENTITIES = [
  "@clossys/advisor@0.1.3",
  "@clossys/advisor@0.1.5",
  "@clossys/advisor@0.1.6",
  "@clossys/advisor@0.2.5",
  "@clossys/architect@0.1.2",
  "@clossys/architect@0.1.3",
  "@clossys/bouncer@0.1.1",
  "@clossys/bouncer@0.1.2",
  "@clossys/builder@0.7.3",
  "@clossys/builder@0.7.4",
  "@clossys/butler@0.1.1",
  "@clossys/butler@0.1.2",
  "@clossys/controller@0.8.21",
  "@clossys/controller@0.8.23",
  "@clossys/controller@0.8.24",
  "@clossys/designer@0.2.4",
  "@clossys/designer@0.2.7",
  "@clossys/designer@0.4.7",
  "@clossys/giver@0.1.2",
  "@clossys/giver@0.1.3",
  "@clossys/influencer@0.1.2",
  "@clossys/influencer@0.1.3",
  "@clossys/inspector@0.1.18",
  "@clossys/inspector@0.1.19",
  "@clossys/integrator@0.6.10",
  "@clossys/integrator@0.6.2",
  "@clossys/integrator@0.6.3",
  "@clossys/keeper@0.1.2",
  "@clossys/keeper@0.1.3",
  "@clossys/launcher@0.1.2",
  "@clossys/locksmith@0.1.6",
  "@clossys/locksmith@0.1.7",
  "@clossys/messenger@0.1.2",
  "@clossys/messenger@0.1.3",
  "@clossys/observer@0.2.3",
  "@clossys/observer@0.2.4",
  "@clossys/publisher@0.1.10",
  "@clossys/publisher@0.2.1",
  "@clossys/starter@0.1.2",
  "@clossys/starter@0.1.4",
  "@clossys/starter@0.1.5",
  "@clossys/strategist@0.1.1",
  "@clossys/strategist@0.1.2",
  "@clossys/writer@0.3.2",
  "@clossys/writer@0.3.3",
];

// None of the identities above matches any package's CURRENT manifest
// version — that is the exact finding #875 measured. This is the load-bearing
// consequence of version-keying: today, zero packages satisfy `published` at
// their current version from retained-publication evidence alone.
const CURRENT_PUBLISHED_PACKAGE_NAMES = [...new Set(CURRENT_PUBLISHED_IDENTITIES.map((identity) => identity.slice(0, identity.lastIndexOf("@"))))].sort();

test("the ladder is ordered and its derivable states are a prefix of it", () => {
  assert.deepEqual(STATES, ["designed", "implemented", "staged", "published", "adopted", "grounded", "closed"]);
  assert.equal(stateIndex("staged") < stateIndex("published"), true);
  for (const s of DERIVABLE_STATES) assert.equal(STATES.includes(s), true);
  // grounded and closed must NOT be derivable here: observer measures them,
  // and a package cannot ground itself.
  assert.equal(DERIVABLE_STATES.has("grounded"), false);
  assert.equal(DERIVABLE_STATES.has("closed"), false);
});

test("current-scope publication requires the exact validated first-publication record", () => {
  const withoutPublication = grade(
    { name: P, state: "published", stagedBy: { run: "https://example/run/1", defectOrigin: "injected", defect: "the installed gate observed one real fixture defect", control: "the matched control passed through the same installed gate" } },
    { sites: ["fixture:1"], publication: false },
  );
  assert.ok(rules(withoutPublication).includes("state-ahead-of-evidence"));
  assert.deepEqual([...readValidatedPublishedPackages(repoRoot)].sort(), CURRENT_PUBLISHED_IDENTITIES);
  assert.deepEqual([...readValidatedPublishedPackageNames(repoRoot)].sort(), CURRENT_PUBLISHED_PACKAGE_NAMES);
});

// ------------------------------------------------------- #875 negative controls
//
// The published set is version-keyed: a validated record proves exactly one
// `name@version` identity, and `published` must join that identity against
// the package's CURRENT manifest version. Before this change, a record for
// ANY version of a package satisfied `published` for every version of it,
// forever — these controls are the demonstration that it no longer does,
// each targeted at one way that could silently regress back to name-only.

const STAGED_BY = {
  run: "https://example/run/1",
  defectOrigin: "injected",
  defect: "the installed gate observed one real fixture defect",
  control: "the matched control passed through the same installed gate",
};

// Interpolated on BOTH sides of the `@`, deliberately: an at-sign directly
// followed by a literal version number in this file's own source reads to
// scripts/check-foreign-references.mjs as a bare-scope account reference
// (the exact shape that gate exists to catch), not as test data about a
// package version.
const identity = (name, version) => `${name}@${version}`;

test("(a) a publication record for a SUPERSEDED version does not satisfy published for the current version", () => {
  // @clossys/thing is at 2.0.0; the only validated identity is 1.0.0 — the
  // exact shape #875 measured live for all 19 packages (e.g. a record
  // proving advisor@0.1.5 shipped does not keep advisor published at 0.2.1).
  const r = grade(
    { name: P, state: "published", stagedBy: STAGED_BY },
    { sites: ["ci.yml:10"], version: "2.0.0", publication: identity(P, "1.0.0") },
  );
  assert.deepEqual(rules(r), ["state-ahead-of-evidence"]);
});

test("(b) a publication record at the EXACT current version satisfies published", () => {
  const r = grade(
    { name: P, state: "published", stagedBy: STAGED_BY },
    { sites: ["ci.yml:10"], version: "2.0.0", publication: identity(P, "2.0.0") },
  );
  assert.deepEqual(rules(r), []);
});

test("(c) a different package's name@version identity does not leak across packages", () => {
  // The published set contains a real identity — just not this package's.
  // A join that degraded to "the set is non-empty" or matched by version
  // alone would let this through; an exact `name@version` join will not.
  const r = grade(
    { name: P, state: "published", stagedBy: STAGED_BY },
    { sites: ["ci.yml:10"], version: "2.0.0", publication: identity("@clossys/other", "2.0.0") },
  );
  assert.deepEqual(rules(r), ["state-ahead-of-evidence"]);
});

test("(d) a malformed later-publication record fails closed rather than silently satisfying anything", () => {
  const dir = mkdtempSync(join(tmpdir(), "malformed-later-publication-"));
  const fixtureRoot = join(dir, "repository");
  try {
    execFileSync("git", ["clone", "--local", "--no-hardlinks", repoRoot, fixtureRoot], { stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "package evidence fixture"], { cwd: fixtureRoot });
    execFileSync("git", ["config", "user.email", "fixture@invalid.example"], { cwd: fixtureRoot });

    if (!existsSync(join(fixtureRoot, TRIO_PUBLICATION_PATH))) {
      for (const path of TRIO_PUBLICATION_TRANSITION_PATHS) {
        const target = join(fixtureRoot, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, readFileSync(join(repoRoot, path)));
      }
      execFileSync("git", ["add", "--all"], { cwd: fixtureRoot });
      execFileSync("git", ["commit", "-m", "fixture: materialize publication transition"], { cwd: fixtureRoot, stdio: "ignore" });
    }

    const malformedPath = join(fixtureRoot, "governance/release-publications/later/strategist-9.9.9.json");
    writeFileSync(malformedPath, "{ this is not valid json");
    execFileSync("git", ["add", "governance/release-publications/later/strategist-9.9.9.json"], { cwd: fixtureRoot });
    execFileSync("git", ["commit", "-m", "fixture: introduce a malformed later-publication record"], { cwd: fixtureRoot, stdio: "ignore" });

    const { names, identities, findings } = validateRetainedLaterPublications(fixtureRoot);
    assert.ok(findings.some((item) => item.rule === "retained-record"), "the malformed record must be reported, not skipped");
    // The 42 genuine records still validate individually...
    assert.equal(names.size, 20);
    assert.equal(identities.size, 42);
    // ...but the gate is fail-closed as a whole: one invalid record among
    // many zeroes the entire published set rather than admitting the rest.
    assert.deepEqual([...readValidatedPublishedPackages(fixtureRoot)], []);
    assert.deepEqual([...readValidatedPublishedPackageNames(fixtureRoot)], []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(e) the retained-record immutability and qualification joins still reject what they rejected before", () => {
  // check-later-publications.mjs (npm run check:later-publications) is the
  // dedicated gate for this; this asserts the same thing at the library
  // level so it is covered here alongside the other four controls, not only
  // by a separate CLI invocation.
  const { findings, names, identities } = validateRetainedLaterPublications(repoRoot);
  assert.deepEqual(findings, []);
  assert.equal(names.size, 20);
  assert.equal(identities.size, 42);
});

test("current-scope publication rejects coherent rewrites and rewrite-restore history", () => {
  const dir = mkdtempSync(join(tmpdir(), "publication-history-"));
  const fixtureRoot = join(dir, "repository");
  try {
    execFileSync("git", ["clone", "--local", "--no-hardlinks", repoRoot, fixtureRoot], { stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "package evidence fixture"], { cwd: fixtureRoot });
    execFileSync("git", ["config", "user.email", "fixture@invalid.example"], { cwd: fixtureRoot });

    if (!existsSync(join(fixtureRoot, TRIO_PUBLICATION_PATH))) {
      for (const path of TRIO_PUBLICATION_TRANSITION_PATHS) {
        const target = join(fixtureRoot, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, readFileSync(join(repoRoot, path)));
      }
      execFileSync("git", ["add", "--all"], { cwd: fixtureRoot });
      execFileSync("git", ["commit", "-m", "fixture: materialize publication transition"], { cwd: fixtureRoot, stdio: "ignore" });
    }

    // Version-key the fixture so the sealed Trio's advisor@0.1.3 identity
    // (#875) is the package's CURRENT manifest version, and declare advisor
    // `published` in this fixture's OWN copy of the contract. Neither edit
    // touches this repository's real files: advisor is declared `staged`
    // there (docs/contracts/package-evidence.json), on the strength of
    // retained records for 0.1.5/0.1.6, neither of which is advisor's real
    // current version (0.2.1) -- so nothing in the real contract is "ahead
    // of its evidence" for the Trio rewrite below to expose. This
    // fixture-only pairing recreates a package that IS satisfied by the
    // sealed Trio record at its current version, so rewriting that record
    // still has a `published` claim to invalidate end to end.
    const advisorManifestPath = join(fixtureRoot, "packages/advisor/package.json");
    const advisorManifest = JSON.parse(readFileSync(advisorManifestPath, "utf8"));
    advisorManifest.version = "0.1.3";
    writeFileSync(advisorManifestPath, `${JSON.stringify(advisorManifest, null, 2)}\n`);
    const contractPath = join(fixtureRoot, "docs/contracts/package-evidence.json");
    const contract = JSON.parse(readFileSync(contractPath, "utf8"));
    const advisorEntry = contract.packages.find((entry) => entry.name === "@clossys/advisor");
    advisorEntry.state = "published";
    writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
    // Regenerate docs/LIFECYCLE.md's generated position table to match, in
    // THIS fixture only, so the assertions below see exactly one finding --
    // the one this test is actually about -- rather than a second,
    // unrelated `lifecycle-position-table-drift` finding riding along
    // because the fixture's contract and its LIFECYCLE.md fell out of
    // sync. An incidental second finding would make the CLI's exit code
    // true for the wrong reason: independent review caught exactly this
    // shape once already (the drift finding alone was enough to force
    // exit 1, with no `state-ahead-of-evidence` finding present at all,
    // when published-evidence checking was disabled outright).
    execFileSync(process.execPath, [script, "--write-lifecycle-position"], { cwd: fixtureRoot, stdio: "ignore" });
    execFileSync("git", ["add", "packages/advisor/package.json", "docs/contracts/package-evidence.json", "docs/LIFECYCLE.md"], { cwd: fixtureRoot });
    execFileSync("git", ["commit", "-m", "fixture: version-key advisor to the sealed Trio identity"], { cwd: fixtureRoot, stdio: "ignore" });

    const publicationPath = join(fixtureRoot, "governance/release-publications/clossys-npmjs-trio.json");
    const originalBytes = readFileSync(publicationPath, "utf8");
    const rewritten = JSON.parse(originalBytes);
    rewritten.members[0].publication.publishedAt = "2026-08-30T06:31:59.838Z";
    const rewrittenBytes = `${JSON.stringify(rewritten, null, 2)}\n`;

    assert.deepEqual([...readValidatedPublishedPackages(fixtureRoot)].sort(), CURRENT_PUBLISHED_IDENTITIES);
    writeFileSync(publicationPath, rewrittenBytes);
    assert.deepEqual([...readValidatedPublishedPackages(fixtureRoot)], []);

    execFileSync("git", ["add", "governance/release-publications/clossys-npmjs-trio.json"], { cwd: fixtureRoot });
    execFileSync("git", ["commit", "-m", "fixture: rewrite publication"], { cwd: fixtureRoot, stdio: "ignore" });
    writeFileSync(publicationPath, originalBytes);
    execFileSync("git", ["add", "governance/release-publications/clossys-npmjs-trio.json"], { cwd: fixtureRoot });
    execFileSync("git", ["commit", "-m", "fixture: restore publication"], { cwd: fixtureRoot, stdio: "ignore" });

    assert.equal(readFileSync(publicationPath, "utf8"), originalBytes);
    assert.deepEqual([...readValidatedPublishedPackages(fixtureRoot)], []);

    // Assert the SPECIFIC finding, not merely a nonzero exit code -- a
    // nonzero exit proves only that *some* finding fired, and independent
    // review demonstrated that the incidental `lifecycle-position-table-drift`
    // finding alone (see above) is enough to force exit 1 even with
    // published-evidence checking completely disabled. The exit code is
    // still asserted, but it is not load-bearing on its own here.
    let cliExitCode;
    let cliStdout;
    try {
      cliStdout = execFileSync(process.execPath, [script, "--json"], { cwd: fixtureRoot, stdio: "pipe" });
      cliExitCode = 0;
    } catch (error) {
      cliExitCode = error.status;
      cliStdout = error.stdout;
    }
    assert.equal(cliExitCode, 1);
    const report = JSON.parse(cliStdout.toString("utf8"));
    // With LIFECYCLE.md kept in sync above, the tampered Trio record's
    // invalidation of advisor's `published` evidence is the ONLY finding --
    // the cleanest, most exact shape this control can assert, and the one
    // that actually proves the CLI detects tampering end to end.
    assert.deepEqual(
      report.findings.filter(isFailureFinding).map((item) => ({ rule: item.rule, subject: item.subject })),
      [{ rule: "state-ahead-of-evidence", subject: "@clossys/advisor" }],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("executable tooling is explicit and stays outside the role-package inference", () => {
  assert.deepEqual([...PACKAGE_CATEGORIES].sort(), ["executable-tooling", "role"]);
  const tooling = grade({ name: P, category: "executable-tooling", state: "implemented" });
  assert.deepEqual(rules(tooling), []);
  assert.equal(tooling.results[0].category, "executable-tooling");
  assert.equal(rules(grade({ name: P, category: "remote-action", state: "implemented" })).includes("unknown-package-category"), true);
});

test("only the exact validated package-authentic Starter qualification earns a staging site", () => {
  const adapterBytes = readFileSync(join(repoRoot, "governance/release-qualification-adapters/starter/current-direct.json"), "utf8");
  const record = JSON.parse(readFileSync(join(repoRoot, "governance/release-qualifications/clossys-starter-0.1.2.json"), "utf8"));
  const input = { packageName: "@clossys/starter", manifestVersion: "0.1.2", adapterBytes, record };
  assert.equal(
    packageAuthenticStarterQualificationSite(input),
    "governance/release-qualifications/clossys-starter-0.1.2.json#transcript:current-direct",
  );
  const v3 = structuredClone(record);
  v3.transcript.schema = "foundry-candidate-qualification-transcript-v3";
  v3.transcript.version = 3;
  v3.transcript.coverage.reactServerImports = 0;
  v3.transcript.coverage.frameworkExports = 0;
  v3.transcript.coverage.frameworkBuilds = 0;
  for (const [index, observation] of v3.transcript.observations.filter((item) => item.kind === "import").entries()) {
    observation.id = `import:import:@clossys/starter${index === 0 ? "" : `/test-${index}`}`;
  }
  delete v3.transcript.canonicalSha256;
  v3.transcript.canonicalSha256 = createHash("sha256").update(JSON.stringify(v3.transcript)).digest("hex");
  assert.equal(
    packageAuthenticStarterQualificationSite({ ...input, record: v3 }),
    "governance/release-qualifications/clossys-starter-0.1.2.json#transcript:current-direct",
  );

  assert.equal(packageAuthenticStarterQualificationSite({ ...input, packageName: "@clossys/advisor" }), null);
  assert.equal(packageAuthenticStarterQualificationSite({ ...input, manifestVersion: "0.1.1" }), null);
  assert.equal(packageAuthenticStarterQualificationSite({ ...input, adapterBytes: adapterBytes.replace('"current-direct"', '"prior-minor"') }), null);

  const declarationOnly = structuredClone(record);
  declarationOnly.transcript.observations = declarationOnly.transcript.observations.filter((item) => item.kind !== "case");
  assert.equal(packageAuthenticStarterQualificationSite({ ...input, record: declarationOnly }), null);

  const forcedRed = structuredClone(record);
  const violated = forcedRed.transcript.observations.find((item) => item.id === "case:activation-violated");
  violated.observedExitCode = 0;
  violated.rawCaseEvidence.exitCode = 0;
  assert.equal(packageAuthenticStarterQualificationSite({ ...input, record: forcedRed }), null);
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

test("a published predecessor retains implementation evidence after source moves to the current scope", () => {
  const predecessor = "@retired-scope/thing";
  const result = evaluatePrograms({
    contract: { packages: [{ name: predecessor, state: "implemented" }] },
    distSites: new Map(),
    binSites: new Map(),
    lifecycleStatuses: new Map([[predecessor, "published"]]),
    workspacePackages: new Set(),
    workspaceBins: new Map(),
    workspaceScope: "@clossys",
  });
  assert.deepEqual(rules(result), []);

  assert.deepEqual(
    rules(grade({ name: P, state: "implemented" }, { inWorkspace: false, workspaceScope: "@clossys" })),
    ["state-ahead-of-evidence"],
  );
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

test("a workspace package missing from the evidence contract fails", () => {
  const r = evaluatePrograms({
    contract: { packages: [] },
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

test("a no-gate declaration is a countdown: reason and issue are required, and permanence is forbidden", () => {
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

test("a declaration that outlived the gate it excused is stale, like a gap", () => {
  const r = grade({
    name: P,
    state: "published",
    gaps: [staged],
    shipsNoGate: { reason: "donor to a role nobody has cut yet", issue: 458 },
  });
  assert.deepEqual(rules(r), ["stale-no-gate-declaration"]);
});

test("an unreadable no-gate declaration is a finding", () => {
  assert.deepEqual(rules(grade({ name: P, state: "published", gaps: [staged], shipsNoGate: "yes" }, noGate)), [
    "unreadable-no-gate",
  ]);
});

test("a designed package has no manifest to grade, and a retired one has left the ladder", () => {
  // A rule about what a manifest exposes cannot be applied to a package that
  // does not exist yet, and must not be applied to one deliberately gone.
  assert.deepEqual(rules(grade({ name: P, state: "designed" }, { ...noGate, inWorkspace: false, status: null })), []);
  assert.deepEqual(rules(grade({ name: P, state: "published" }, { ...noGate, status: "retired" })), []);
});

test("an unparseable contract yields one finding and no results, never a pass", () => {
  for (const contract of [null, {}, { packages: {} }]) {
    const r = evaluatePrograms({ contract, distSites: new Map(), binSites: new Map(), lifecycleStatuses: new Map(), workspacePackages: new Set() });
    assert.equal(r.findings.length >= 1, true);
    assert.deepEqual(r.results, []);
  }
});

test("the scan finds a dist-path invocation and ignores a commented one", () => {
  const dir = mkdtempSync(join(tmpdir(), "evidence-scan-"));
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
  // like `entry("auth", "@example/auth", "0.2.4")` inside another
  // script's tests. Naming a package is not using one.
  const dir = mkdtempSync(join(tmpdir(), "evidence-fixture-"));
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

test("the lifecycle position renderer does not promote zero-site tooling or fabricate a role loop for it", () => {
  const rendered = renderLifecyclePositionTable({
    contract: {},
    results: [
      { package: P, category: "role", state: "published", acknowledgedGaps: [], stagedHere: true },
      { package: "@clossys/not-yet", category: "role", state: "published", acknowledgedGaps: ["staged"], stagedHere: false },
      { package: "@clossys/retired", category: "role", state: "published", supersession: "retired", acknowledgedGaps: [], stagedHere: true },
      { package: "@clossys/tool", category: "executable-tooling", state: "implemented", acknowledgedGaps: [], stagedHere: false },
    ],
  });
  assert.match(rendered, /<!-- lifecycle-position-table:start -->/);
  assert.match(rendered, /\| package \| current position \| staged here \| adoption \| grounding \| closure \|/);
  assert.match(rendered, /\| `@clossys\/thing` \| published \| yes \| not yet \| unknown — #484 \| not yet \|/);
  assert.match(rendered, /@clossys\/not-yet.*\| not yet \| not yet \| unknown — #484 \| not yet/);
  assert.match(rendered, /@clossys\/retired.*\| retired \| yes \| not yet \| unknown — #484 \| not yet/);
  assert.match(rendered, /@clossys\/tool.*\| implemented \| not yet \| N\/A — executable tooling \| N\/A — executable tooling \| N\/A — executable tooling/);
  assert.match(rendered, /<!-- lifecycle-position-table:end -->/);
});

test("replacing the generated lifecycle block preserves surrounding prose, canonicalizes its boundary, and is idempotent", () => {
  const rendered = "<!-- lifecycle-position-table:start -->\nnew table\n<!-- lifecycle-position-table:end -->\n";
  const source = "before\n<!-- lifecycle-position-table:start -->\nold\n<!-- lifecycle-position-table:end -->\n\n\n\nafter\n";
  const expected = "before\n<!-- lifecycle-position-table:start -->\nnew table\n<!-- lifecycle-position-table:end -->\n\nafter\n";
  const replaced = replaceLifecyclePositionTable(source, rendered);
  assert.equal(replaced, expected);
  assert.equal(replaceLifecyclePositionTable(replaced, rendered), replaced);
  assert.throws(() => replaceLifecyclePositionTable("no markers", rendered), /missing/);
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
  const dir = mkdtempSync(join(tmpdir(), "evidence-cli-"));
  try {
    const contract = JSON.parse(execFileSync(process.execPath, ["-e", "process.stdout.write(require('fs').readFileSync('docs/contracts/package-evidence.json','utf8'))"], { cwd: repoRoot, encoding: "utf8" }));
    for (const p of contract.packages) {
      if (p.name !== "@clossys/strategist") continue;
      p.state = "staged";
      // The real contract may acknowledge a staging shortfall with `gaps`,
      // or support it with a recorded red/control `stagedBy` run. Remove
      // both forms so this remains a positive control for missing evidence.
      delete p.gaps;
      delete p.stagedBy;
    }
    const broken = join(dir, "broken.json");
    writeFileSync(broken, JSON.stringify(contract));
    assert.throws(() => execFileSync(process.execPath, [script, broken, repoRoot], { cwd: repoRoot, stdio: "pipe" }), (e) => e.status === 1);

    // The table is a committed generated view. Altering only an ungraded
    // display label leaves the lifecycle evaluation clean, but must still
    // make the normal check refuse a stale rendered block and point at the
    // explicit (never automatic) regeneration command.
    const drifted = JSON.parse(execFileSync(process.execPath, ["-e", "process.stdout.write(require('fs').readFileSync('docs/contracts/package-evidence.json','utf8'))"], { cwd: repoRoot, encoding: "utf8" }));
    drifted.packages.find((entry) => entry.name === "@clossys/controller").state = "designed";
    const driftedPath = join(dir, "drifted.json");
    writeFileSync(driftedPath, JSON.stringify(drifted));
    assert.throws(
      () => execFileSync(process.execPath, [script, driftedPath, repoRoot], { cwd: repoRoot, stdio: "pipe" }),
      (e) => e.status === 1 && `${e.stdout}`.includes("lifecycle-position-table-drift") && `${e.stdout}`.includes("--write-lifecycle-position"),
    );
    assert.throws(() => execFileSync(process.execPath, [script, join(dir, "absent.json"), repoRoot], { cwd: repoRoot, stdio: "pipe" }), (e) => e.status === 2);

    // The same control for the gate rule, against the real tree: drop the
    // primitive's declaration and the absent `bin` must stop being excused.
    const stripped = JSON.parse(execFileSync(process.execPath, ["-e", "process.stdout.write(require('fs').readFileSync('docs/contracts/package-evidence.json','utf8'))"], { cwd: repoRoot, encoding: "utf8" }));
    for (const p of stripped.packages) if (p.name === "@clossys/controller") p.shipsNoGate = { reason: "A stale declaration on a package that now ships a gate.", issue: 1 };
    const undeclared = join(dir, "undeclared-gate.json");
    writeFileSync(undeclared, JSON.stringify(stripped));
    assert.throws(
      () => execFileSync(process.execPath, [script, undeclared, repoRoot], { cwd: repoRoot, stdio: "pipe" }),
      (e) => e.status === 1 && `${e.stdout}`.includes("stale-no-gate-declaration"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
