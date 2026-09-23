// Regression tests for check-package-framework.mjs.
//
// Mirrors check-role-assessment-surfaces.test.mjs: fixture manifests plant a
// declaration that must be caught, or an absence that must stay visible (and
// never fail report mode), and the pure envelope/document shape checks are
// exercised directly against synthetic documents.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  evaluatePackageFramework,
  findContextDuplicateCards,
  readContextFieldIds,
  validateCheckOutputEnvelope,
  validateFitSignalsShape,
  validateIntakeCardsShape,
  validateRoleAssessmentDocument,
} from "./check-package-framework.mjs";

const ROLES = ["@scope/alpha", "@scope/beta"];
function manifests(entries) { return new Map(entries.map((manifest) => [manifest.name, manifest])); }

const VALID_CARDS = { schemaVersion: 1, role: "@scope/alpha", cards: [
  { id: "q1", prompt: "Who can say yes?", choices: [{ id: "recommended", label: "The founder." }, { id: "someone-else", label: "Someone else." }], recommendedChoiceId: "recommended", somethingElseFollowUp: "Say it in one sentence." },
] };
const VALID_SIGNALS = { schemaVersion: 1, role: "@scope/alpha", signals: [{ id: "s1", prompt: "Is there an audience-facing surface?", evidenceKind: "repository-structure" }] };

function readerFor(files) {
  return (role, path) => {
    const key = `${role}:${path}`;
    if (!(key in files)) { const error = new Error("ENOENT"); error.code = "ENOENT"; throw error; }
    return files[key];
  };
}

test("a fully declared, well-formed package passes with every column declared", () => {
  const manifest = {
    name: "@scope/alpha",
    bin: { "alpha-status": "dist/status.js" },
    foundry: {
      assessment: { bin: "alpha-status", invocation: "single-json-input" },
      intake: "cards.json",
      outputs: ["clossys/alpha/plan.json"],
      status: { bin: "alpha-status", invocation: "single-json-input" },
      fit: "signals.json",
      solves: [{ problem: "cant-explain-what-we-are", statement: "We can't explain what we are.", metric: "owned-metric", proofCase: "case-1", evidence: "designed" }],
      needs: [{ producerRole: "@scope/beta", artifact: "direction" }],
      feeds: [{ artifact: "plan", path: "clossys/alpha/plan.json" }],
    },
  };
  const reader = readerFor({ "@scope/alpha:cards.json": JSON.stringify(VALID_CARDS), "@scope/alpha:signals.json": JSON.stringify(VALID_SIGNALS) });
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([manifest]), { readPackageFile: reader });
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.table, [{ role: "@scope/alpha", assessment: "declared", intake: "declared", outputs: "declared", status: "declared", fit: "declared", solves: "declared", needs: "declared", feeds: "declared" }]);
  assert.deepEqual(result.warnings.map((w) => w.rule), ["solves-statement-voice-lint-skipped"]);
});

test("a package with no foundry block at all reports every new field absent, never a failure", () => {
  const result = evaluatePackageFramework(ROLES, manifests([{ name: "@scope/alpha" }, { name: "@scope/beta" }]));
  assert.deepEqual(result.findings, []);
  for (const row of result.table) {
    assert.equal(row.intake, "absent");
    assert.equal(row.outputs, "absent");
    assert.equal(row.status, "absent");
    assert.equal(row.fit, "absent");
    assert.equal(row.solves, "absent");
    assert.equal(row.needs, "absent");
    assert.equal(row.feeds, "absent");
  }
});

test("a role with no shipped package at all is reported absent, not dropped", () => {
  const result = evaluatePackageFramework(["@scope/missing"], manifests([]));
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.table, [{ role: "@scope/missing", assessment: "absent", intake: "absent", outputs: "absent", status: "absent", fit: "absent", solves: "absent", needs: "absent", feeds: "absent" }]);
});

test("an intake path that escapes the package directory is a finding", () => {
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { intake: "../../etc/passwd" } }]));
  assert.deepEqual(result.findings.map((f) => f.rule), ["invalid-intake-declaration"]);
});

test("an intake declaration naming a file the package does not ship is a finding", () => {
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { intake: "cards.json" } }]), { readPackageFile: readerFor({}) });
  assert.deepEqual(result.findings.map((f) => f.rule), ["intake-file-missing"]);
});

test("an intake file whose recommended choice is not listed first is a finding", () => {
  const badCards = { schemaVersion: 1, role: "@scope/alpha", cards: [
    { id: "q1", prompt: "Who can say yes?", choices: [{ id: "someone-else", label: "Someone else." }, { id: "recommended", label: "The founder." }], recommendedChoiceId: "recommended", somethingElseFollowUp: "Say it in one sentence." },
  ] };
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { intake: "cards.json" } }]), { readPackageFile: readerFor({ "@scope/alpha:cards.json": JSON.stringify(badCards) }) });
  assert.deepEqual(result.findings.map((f) => f.rule), ["intake-card-recommendation-not-first"]);
});

test("outputs must be a non-empty array of path strings", () => {
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { outputs: [] } }]));
  assert.deepEqual(result.findings.map((f) => f.rule), ["invalid-outputs-declaration"]);
});

test("an outputs path outside the role's own clossys/<role>/ folder is a finding", () => {
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { outputs: ["clossys/beta/plan.json"] } }]));
  assert.deepEqual(result.findings.map((f) => f.rule), ["output-path-outside-role-folder"]);
});

test("an outputs path escaping the repository is a finding", () => {
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { outputs: ["../elsewhere.json"] } }]));
  assert.deepEqual(result.findings.map((f) => f.rule), ["output-path-outside-role-folder"]);
});

test("a status declaration with an unmapped bin is a finding", () => {
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", bin: {}, foundry: { status: { bin: "alpha-status", invocation: "single-json-input" } } }]));
  assert.deepEqual(result.findings.map((f) => f.rule), ["undeclared-status-bin"]);
});

test("a status declaration with an unsupported invocation kind is a finding", () => {
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", bin: { "alpha-status": "dist/status.js" }, foundry: { status: { bin: "alpha-status", invocation: "interactive-session" } } }]));
  assert.deepEqual(result.findings.map((f) => f.rule), ["invalid-status-declaration"]);
});

test("a status bin target that escapes the package directory is a finding", () => {
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", bin: { "alpha-status": "../../elsewhere.js" }, foundry: { status: { bin: "alpha-status", invocation: "single-json-input" } } }]));
  assert.deepEqual(result.findings.map((f) => f.rule), ["escaping-status-bin"]);
});

test("a fit declaration naming a file the package does not ship is a finding", () => {
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { fit: "signals.json" } }]), { readPackageFile: readerFor({}) });
  assert.deepEqual(result.findings.map((f) => f.rule), ["fit-file-missing"]);
});

test("a fit signal missing evidenceKind is a finding", () => {
  const badSignals = { schemaVersion: 1, role: "@scope/alpha", signals: [{ id: "s1", prompt: "x" }] };
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { fit: "signals.json" } }]), { readPackageFile: readerFor({ "@scope/alpha:signals.json": JSON.stringify(badSignals) }) });
  assert.deepEqual(result.findings.map((f) => f.rule), ["invalid-fit-signal"]);
});

test("an empty signals array is well-formed — a role may be universally applicable", () => {
  const emptySignals = { schemaVersion: 1, role: "@scope/alpha", signals: [] };
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { fit: "signals.json" } }]), { readPackageFile: readerFor({ "@scope/alpha:signals.json": JSON.stringify(emptySignals) }) });
  assert.deepEqual(result.findings, []);
});

// --- duplicate-question gate (issue #1173, docs/DECISIONS.md decision 28) ---

const CONTEXT_FIELD_IDS = ["business", "product", "audience", "stage", "intent", "constraints"];
const DUPLICATING_CARDS = { schemaVersion: 1, role: "@scope/alpha", cards: [
  VALID_CARDS.cards[0],
  { id: "audience", prompt: "Who is it for?", choices: [{ id: "consumers", label: "Consumers." }, { id: "businesses", label: "Businesses." }], recommendedChoiceId: "consumers", somethingElseFollowUp: "Say it in one sentence." },
  { id: "first-audience-segment", prompt: "Which segment do we address first?", choices: [{ id: "largest", label: "The largest." }, { id: "loudest", label: "The loudest." }], recommendedChoiceId: "largest", somethingElseFollowUp: "Say it in one sentence." },
] };

test("an intake card reusing an engagement-context field id is a WARN in report mode, never a failure", () => {
  const reader = readerFor({ "@scope/alpha:cards.json": JSON.stringify(DUPLICATING_CARDS) });
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { intake: "cards.json" } }]), { readPackageFile: reader, contextFieldIds: CONTEXT_FIELD_IDS });
  assert.deepEqual(result.findings, []);
  assert.equal(result.table[0].intake, "declared");
  assert.deepEqual(result.warnings.map((w) => [w.rule, w.role]), [["intake-card-duplicates-context-field", "@scope/alpha"]]);
  assert.match(result.warnings[0].message, /"audience"/);
});

test("--enforce promotes a duplicated context question to a finding", () => {
  const reader = readerFor({ "@scope/alpha:cards.json": JSON.stringify(DUPLICATING_CARDS) });
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { intake: "cards.json" } }]), { readPackageFile: reader, contextFieldIds: CONTEXT_FIELD_IDS, enforce: true });
  assert.ok(result.findings.some((f) => f.rule === "intake-card-duplicates-context-field"));
  assert.ok(!result.warnings.some((w) => w.rule === "intake-card-duplicates-context-field"));
});

test("matching is on stable ids only: a narrower card with its own id is not a duplicate", () => {
  const narrower = { ...DUPLICATING_CARDS, cards: [DUPLICATING_CARDS.cards[2]] };
  assert.deepEqual(findContextDuplicateCards(narrower, "@scope/alpha", CONTEXT_FIELD_IDS), []);
});

test("a case or whitespace variant of a reserved id is the same id: flagged as a duplicate, and rejected by the shape check", () => {
  for (const variant of ["Audience", " audience", "audience ", "AUDIENCE"]) {
    const cards = { ...DUPLICATING_CARDS, cards: [{ ...DUPLICATING_CARDS.cards[1], id: variant }] };
    assert.deepEqual(findContextDuplicateCards(cards, "@scope/alpha", CONTEXT_FIELD_IDS).map((f) => f.rule), ["intake-card-duplicates-context-field"], `variant ${JSON.stringify(variant)}`);
    assert.deepEqual(validateIntakeCardsShape(cards, "@scope/alpha").map((f) => f.rule), ["invalid-intake-card-id"], `variant ${JSON.stringify(variant)}`);
  }
});

test("an intake card id must be a lowercase slug", () => {
  for (const id of ["q1", "first-audience-segment", "a2b"]) {
    assert.deepEqual(validateIntakeCardsShape({ ...VALID_CARDS, cards: [{ ...VALID_CARDS.cards[0], id }] }, "@scope/alpha"), [], id);
  }
  for (const id of ["Q1", "first_segment", "-lead", "trail-", "double--dash", "two words"]) {
    assert.deepEqual(validateIntakeCardsShape({ ...VALID_CARDS, cards: [{ ...VALID_CARDS.cards[0], id }] }, "@scope/alpha").map((f) => f.rule), ["invalid-intake-card-id"], id);
  }
});

test("findContextDuplicateCards yields nothing for a null contract or a malformed document", () => {
  assert.deepEqual(findContextDuplicateCards(DUPLICATING_CARDS, "@scope/alpha", null), []);
  assert.deepEqual(findContextDuplicateCards({ cards: "not-an-array" }, "@scope/alpha", CONTEXT_FIELD_IDS), []);
});

test("an unreadable engagement-context contract is a WARN in report mode and a finding under --enforce, never a silent pass", () => {
  const reader = readerFor({ "@scope/alpha:cards.json": JSON.stringify(DUPLICATING_CARDS) });
  const declared = manifests([{ name: "@scope/alpha", foundry: { intake: "cards.json" } }]);
  const report = evaluatePackageFramework(["@scope/alpha"], declared, { readPackageFile: reader, contextFieldIds: null });
  assert.deepEqual(report.warnings.map((w) => w.rule), ["engagement-context-contract-unreadable"]);
  assert.equal(report.contextCheck.ran, false);
  const enforced = evaluatePackageFramework(["@scope/alpha"], declared, { readPackageFile: reader, contextFieldIds: null, enforce: true });
  assert.ok(enforced.findings.some((f) => f.rule === "engagement-context-contract-unreadable"));
  // Omitting contextFieldIds means the caller did not ask for the check: no finding either way.
  const omitted = evaluatePackageFramework(["@scope/alpha"], declared, { readPackageFile: reader, enforce: true });
  assert.ok(!omitted.findings.some((f) => f.rule === "engagement-context-contract-unreadable"));
});

test("contextCheck counts the intake files it examined and the duplicates it found", () => {
  const reader = readerFor({ "@scope/alpha:cards.json": JSON.stringify(DUPLICATING_CARDS), "@scope/beta:cards.json": JSON.stringify(VALID_CARDS) });
  const result = evaluatePackageFramework(["@scope/alpha", "@scope/beta", "@scope/gamma"], manifests([
    { name: "@scope/alpha", foundry: { intake: "cards.json" } },
    { name: "@scope/beta", foundry: { intake: "cards.json" } },
    { name: "@scope/gamma" },
  ]), { readPackageFile: reader, contextFieldIds: CONTEXT_FIELD_IDS });
  assert.deepEqual(result.contextCheck, { ran: true, intakeFilesExamined: 2, duplicates: 1 });
});

test("readContextFieldIds reads this repository's contract enum as slugs", () => {
  assert.deepEqual(readContextFieldIds(fileURLToPath(new URL("..", import.meta.url))), CONTEXT_FIELD_IDS);
});

test("report mode never fails on absence, but --enforce turns absence into a finding", () => {
  const noneDeclared = manifests([{ name: "@scope/alpha" }]);
  const reportMode = evaluatePackageFramework(["@scope/alpha"], noneDeclared);
  assert.deepEqual(reportMode.findings, []);
  const enforceMode = evaluatePackageFramework(["@scope/alpha"], noneDeclared, { enforce: true });
  assert.deepEqual(enforceMode.findings.map((f) => f.rule).sort(), ["required-feeds-absent", "required-fit-absent", "required-intake-absent", "required-needs-absent", "required-outputs-absent", "required-solves-absent", "required-status-absent"]);
});

// --- solves / needs / feeds (schema version 2, issue #1172's "De-risking additions to `solves`") ---

test("an empty solves/needs/feeds array is well-formed", () => {
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { solves: [], needs: [], feeds: [] } }]));
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.warnings, []);
  const row = result.table[0];
  assert.deepEqual([row.solves, row.needs, row.feeds], ["declared", "declared", "declared"]);
});

test("a solves entry missing a required field is a finding", () => {
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { solves: [{ problem: "x", statement: "y" }] } }]));
  assert.deepEqual(result.findings.map((f) => f.rule), ["invalid-solves-entry"]);
});

test("a solves entry with an out-of-enum evidence value is a finding", () => {
  const entry = { problem: "cant-explain-what-we-are", statement: "y", metric: "m", proofCase: "c", evidence: "definitely" };
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { solves: [entry] } }]));
  assert.deepEqual(result.findings.map((f) => f.rule), ["invalid-solves-entry"]);
});

test("a solves.problem id that is not lowercase kebab-case is a finding, even in report mode", () => {
  const entry = { problem: "Cant Explain", statement: "y", metric: "m", proofCase: "c", evidence: "designed" };
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { solves: [entry] } }]));
  assert.deepEqual(result.findings.map((f) => f.rule), ["invalid-solves-problem-id-format"]);
});

test("--enforce catches a solves.metric that does not name this role's own owned metric", () => {
  const entry = { problem: "cant-explain-what-we-are", statement: "y", metric: "wrong-metric", proofCase: "case-1", evidence: "designed" };
  const roleMetricByRole = new Map([["@scope/alpha", "owned-metric"]]);
  const readAdapterCases = () => ["case-1"];
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { solves: [entry] } }]), { enforce: true, roleMetricByRole, readAdapterCases });
  assert.ok(result.findings.some((f) => f.rule === "solves-metric-mismatch"));
});

test("--enforce catches a solves.proofCase absent from the role's own qualification adapter", () => {
  const entry = { problem: "cant-explain-what-we-are", statement: "y", metric: "owned-metric", proofCase: "no-such-case", evidence: "designed" };
  const roleMetricByRole = new Map([["@scope/alpha", "owned-metric"]]);
  const readAdapterCases = () => ["case-1"];
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { solves: [entry] } }]), { enforce: true, roleMetricByRole, readAdapterCases });
  assert.deepEqual(result.findings.filter((f) => f.rule.startsWith("solves-")).map((f) => f.rule), ["solves-proof-case-missing"]);
});

test("--enforce leaves solves.problem alone when docs/contracts/client-problems.json does not exist (clientProblemIds: null)", () => {
  const entry = { problem: "cant-explain-what-we-are", statement: "y", metric: "owned-metric", proofCase: "case-1", evidence: "designed" };
  const roleMetricByRole = new Map([["@scope/alpha", "owned-metric"]]);
  const readAdapterCases = () => ["case-1"];
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { solves: [entry] } }]), { enforce: true, roleMetricByRole, readAdapterCases, clientProblemIds: null });
  assert.deepEqual(result.findings.filter((f) => f.rule.startsWith("solves-") || f.rule === "unclaimed-client-problem"), []);
});

test("--enforce fails a solves.problem id not declared in an existing client-problems.json", () => {
  const entry = { problem: "not-a-real-problem", statement: "y", metric: "owned-metric", proofCase: "case-1", evidence: "designed" };
  const roleMetricByRole = new Map([["@scope/alpha", "owned-metric"]]);
  const readAdapterCases = () => ["case-1"];
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { solves: [entry] } }]), { enforce: true, roleMetricByRole, readAdapterCases, clientProblemIds: ["cant-explain-what-we-are"] });
  assert.ok(result.findings.some((f) => f.rule === "solves-problem-id-unresolved"));
  assert.ok(result.findings.some((f) => f.rule === "unclaimed-client-problem" && f.path === "cant-explain-what-we-are"));
});

test("--enforce flags two roles claiming the same problem id", () => {
  const entry = { problem: "cant-explain-what-we-are", statement: "y", metric: "m", proofCase: "c", evidence: "designed" };
  const roleMetricByRole = new Map([["@scope/alpha", "m"], ["@scope/beta", "m"]]);
  const readAdapterCases = () => ["c"];
  const result = evaluatePackageFramework(ROLES, manifests([
    { name: "@scope/alpha", foundry: { solves: [entry] } },
    { name: "@scope/beta", foundry: { solves: [entry] } },
  ]), { enforce: true, roleMetricByRole, readAdapterCases });
  const collision = result.findings.find((f) => f.rule === "solves-problem-claimed-by-multiple-roles");
  assert.ok(collision);
  assert.match(collision.message, /@scope\/alpha/);
  assert.match(collision.message, /@scope\/beta/);
});

test("needs must be an array of { producerRole, artifact }", () => {
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { needs: [{ producerRole: "@scope/beta" }] } }]));
  assert.deepEqual(result.findings.map((f) => f.rule), ["invalid-needs-declaration"]);
});

test("a feeds path outside the role's own clossys/<role>/ folder is a finding", () => {
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { feeds: [{ artifact: "plan", path: "clossys/beta/plan.json" }] } }]));
  assert.deepEqual(result.findings.map((f) => f.rule), ["feeds-path-outside-role-folder"]);
});

test("--enforce matches a needs entry against another role's feeds entry", () => {
  const result = evaluatePackageFramework(ROLES, manifests([
    { name: "@scope/alpha", foundry: { needs: [{ producerRole: "@scope/beta", artifact: "direction" }] } },
    { name: "@scope/beta", foundry: { feeds: [{ artifact: "direction", path: "clossys/beta/direction.json" }] } },
  ]), { enforce: true });
  assert.deepEqual(result.findings.filter((f) => f.rule === "unmatched-need" || f.rule === "needs-graph-cycle"), []);
});

test("--enforce fails an unmatched needs entry", () => {
  const result = evaluatePackageFramework(ROLES, manifests([
    { name: "@scope/alpha", foundry: { needs: [{ producerRole: "@scope/beta", artifact: "direction" }] } },
    { name: "@scope/beta", foundry: { feeds: [{ artifact: "something-else", path: "clossys/beta/x.json" }] } },
  ]), { enforce: true });
  assert.deepEqual(result.findings.filter((f) => f.rule === "unmatched-need").map((f) => f.rule), ["unmatched-need"]);
});

test("--enforce fails a cycle in the needs/feeds handoff graph", () => {
  const result = evaluatePackageFramework(ROLES, manifests([
    { name: "@scope/alpha", foundry: { needs: [{ producerRole: "@scope/beta", artifact: "b-artifact" }], feeds: [{ artifact: "a-artifact", path: "clossys/alpha/a.json" }] } },
    { name: "@scope/beta", foundry: { needs: [{ producerRole: "@scope/alpha", artifact: "a-artifact" }], feeds: [{ artifact: "b-artifact", path: "clossys/beta/b.json" }] } },
  ]), { enforce: true });
  assert.ok(result.findings.some((f) => f.rule === "needs-graph-cycle"));
});

// --- docs/contracts/check-output-envelope.json shape ---

test("a well-formed satisfied envelope has no findings", () => {
  const envelope = { package: "@scope/alpha", version: "1.0.0", verdict: "satisfied", summary: "Everything checked out.", findings: [] };
  assert.deepEqual(validateCheckOutputEnvelope(envelope, "fixture.json"), []);
});

test("a non-satisfied envelope with no findings is malformed", () => {
  const envelope = { package: "@scope/alpha", version: "1.0.0", verdict: "violated", summary: "Something is wrong.", findings: [] };
  const findings = validateCheckOutputEnvelope(envelope, "fixture.json");
  assert.deepEqual(findings.map((f) => f.rule), ["envelope-findings-empty-for-non-satisfied-verdict"]);
});

test("a summary with more than one sentence is malformed", () => {
  const envelope = { package: "@scope/alpha", version: "1.0.0", verdict: "satisfied", summary: "First sentence. Second sentence.", findings: [] };
  const findings = validateCheckOutputEnvelope(envelope, "fixture.json");
  assert.deepEqual(findings.map((f) => f.rule), ["invalid-envelope-summary"]);
});

test("an unrecognized verdict is malformed", () => {
  const envelope = { package: "@scope/alpha", version: "1.0.0", verdict: "unknown", summary: "One sentence.", findings: [{ rule: "x", severity: "error", message: "m" }] };
  const findings = validateCheckOutputEnvelope(envelope, "fixture.json");
  assert.deepEqual(findings.map((f) => f.rule), ["invalid-envelope-verdict"]);
});

// --- docs/contracts/role-assessment.json shape ---

test("a document missing required #533 fields reports each one", () => {
  const findings = validateRoleAssessmentDocument({ schemaVersion: 1, package: "@scope/alpha", version: "1.0.0" }, "assessment.json");
  const missing = findings.filter((f) => f.rule === "role-assessment-field-missing").map((f) => f.message);
  assert.ok(missing.some((m) => m.includes("baseline")));
  assert.ok(missing.some((m) => m.includes("proposedPositions")));
});

test("a fully shaped role assessment document has no findings", () => {
  const document = {
    schemaVersion: 1, package: "@scope/alpha", version: "1.0.0", role: "@scope/alpha", asOf: "2026-09-22T00:00:00Z",
    baseline: {}, target: {}, gaps: [], unknowns: [], criticalPath: {}, authority: {}, proposedPositions: [],
  };
  assert.deepEqual(validateRoleAssessmentDocument(document, "assessment.json"), []);
});

// --- direct shape-check unit coverage ---

test("validateIntakeCardsShape rejects a card with fewer than two choices", () => {
  const document = { schemaVersion: 1, role: "@scope/alpha", cards: [{ id: "q1", prompt: "x", choices: [{ id: "a", label: "A" }], recommendedChoiceId: "a", somethingElseFollowUp: "y" }] };
  const findings = validateIntakeCardsShape(document, "@scope/alpha");
  assert.deepEqual(findings.map((f) => f.rule), ["invalid-intake-card"]);
});

test("validateFitSignalsShape rejects a non-array signals field", () => {
  const findings = validateFitSignalsShape({ schemaVersion: 1, role: "@scope/alpha", signals: "not-an-array" }, "@scope/alpha");
  assert.deepEqual(findings.map((f) => f.rule), ["invalid-fit-signals-file"]);
});
