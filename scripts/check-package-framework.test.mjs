// Regression tests for check-package-framework.mjs.
//
// Mirrors check-role-assessment-surfaces.test.mjs: fixture manifests plant a
// declaration that must be caught, or an absence that must stay visible (and
// never fail report mode), and the pure envelope/document shape checks are
// exercised directly against synthetic documents.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePackageFramework,
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

test("--enforce does not report a collision when one role's own two solves entries repeat the same problem id", () => {
  const entryA = { problem: "cant-explain-what-we-are", statement: "y", metric: "m", proofCase: "c", evidence: "designed" };
  const entryB = { problem: "cant-explain-what-we-are", statement: "z", metric: "m", proofCase: "c", evidence: "designed" };
  const roleMetricByRole = new Map([["@scope/alpha", "m"]]);
  const readAdapterCases = () => ["c"];
  const result = evaluatePackageFramework(["@scope/alpha"], manifests([
    { name: "@scope/alpha", foundry: { solves: [entryA, entryB] } },
  ]), { enforce: true, roleMetricByRole, readAdapterCases });
  assert.deepEqual(result.findings.filter((f) => f.rule === "solves-problem-claimed-by-multiple-roles"), []);
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

// --- issue #1382: cycles are judged per capability, not per role ---

const KEEP_LOOP_ROLES = ["@clossys/customer", "@clossys/publisher", "@clossys/writer"];
function capability(id, inputs, outputs) { return { id, inputs, outputs }; }

test("#1382: the Customer/Publisher keep loop is a role-level cycle but not a capability cycle, so it passes --enforce with no finding and no warning", () => {
  const result = evaluatePackageFramework(KEEP_LOOP_ROLES, manifests([
    { name: "@clossys/customer", foundry: {
      needs: [{ producerRole: "@clossys/publisher", artifact: "surface-documents" }],
      feeds: [{ artifact: "keep-verdict", path: "clossys/customer/keep.json" }],
      capabilities: [capability("keep-verdict", [{ producerRole: "@clossys/publisher", artifact: "surface-documents" }], ["clossys/customer/keep.json"])],
    } },
    { name: "@clossys/publisher", foundry: {
      needs: [{ producerRole: "@clossys/customer", artifact: "keep-verdict" }, { producerRole: "@clossys/writer", artifact: "copy-registry" }],
      feeds: [{ artifact: "surface-documents", path: "clossys/publisher/surfaces.json" }],
      capabilities: [
        capability("surface-documents", [{ producerRole: "@clossys/writer", artifact: "copy-registry" }], ["clossys/publisher/surfaces.json"]),
        capability("sealing-and-the-publication-record", [{ producerRole: "@clossys/customer", artifact: "keep-verdict" }], ["clossys/publisher/record.json"]),
      ],
    } },
    { name: "@clossys/writer", foundry: {
      needs: [],
      feeds: [{ artifact: "copy-registry", path: "clossys/writer/copy.json" }],
      capabilities: [capability("copy-registry", [], ["clossys/writer/copy.json"])],
    } },
  ]), { enforce: true });
  assert.deepEqual(result.findings.filter((f) => f.rule === "needs-graph-cycle" || f.rule === "unmatched-need"), []);
  assert.deepEqual(result.warnings.filter((f) => f.rule === "needs-graph-cycle-unjudged"), []);
});

test("#1382: capabilities that need each other are a real deadlock and fail --enforce, naming the capability cycle", () => {
  const result = evaluatePackageFramework(ROLES, manifests([
    { name: "@scope/alpha", foundry: { capabilities: [capability("draft", [{ producerRole: "@scope/beta", artifact: "review" }], ["clossys/alpha/draft.json"])] } },
    { name: "@scope/beta", foundry: { capabilities: [capability("review", [{ producerRole: "@scope/alpha", artifact: "draft" }], ["clossys/beta/review.json"])] } },
  ]), { enforce: true });
  const cycle = result.findings.find((f) => f.rule === "needs-graph-cycle");
  assert.ok(cycle, "expected a needs-graph-cycle finding");
  assert.match(cycle.message, /@scope\/alpha#draft/);
  assert.match(cycle.message, /@scope\/beta#review/);
});

test("#1382: a capability input resolves through the producer's feeds path when it names an artifact rather than a capability id", () => {
  const result = evaluatePackageFramework(ROLES, manifests([
    { name: "@scope/alpha", foundry: { feeds: [{ artifact: "a-artifact", path: "clossys/alpha/a.json" }], capabilities: [capability("make-a", [{ producerRole: "@scope/beta", artifact: "b-artifact" }], ["clossys/alpha/a.json"])] } },
    { name: "@scope/beta", foundry: { feeds: [{ artifact: "b-artifact", path: "clossys/beta/b.json" }], capabilities: [capability("make-b", [{ producerRole: "@scope/alpha", artifact: "a-artifact" }], ["clossys/beta/b.json"])] } },
  ]), { enforce: true });
  assert.ok(result.findings.some((f) => f.rule === "needs-graph-cycle"));
});

test("#1382: a capability that needs its own output is a self-cycle and fails --enforce", () => {
  const result = evaluatePackageFramework(ROLES, manifests([
    { name: "@scope/alpha", foundry: { capabilities: [capability("loop", [{ producerRole: "@scope/alpha", artifact: "loop" }], ["clossys/alpha/loop.json"])] } },
  ]), { enforce: true });
  assert.ok(result.findings.some((f) => f.rule === "needs-graph-cycle"));
});

test("#1382: a role-level cycle between roles with no capability maps cannot be judged, so it is a warning, not a finding", () => {
  const result = evaluatePackageFramework(ROLES, manifests([
    { name: "@scope/alpha", foundry: { needs: [{ producerRole: "@scope/beta", artifact: "b-artifact" }], feeds: [{ artifact: "a-artifact", path: "clossys/alpha/a.json" }] } },
    { name: "@scope/beta", foundry: { needs: [{ producerRole: "@scope/alpha", artifact: "a-artifact" }], feeds: [{ artifact: "b-artifact", path: "clossys/beta/b.json" }] } },
  ]), { enforce: true });
  assert.equal(result.findings.some((f) => f.rule === "needs-graph-cycle"), false);
  const warning = result.warnings.find((f) => f.rule === "needs-graph-cycle-unjudged");
  assert.ok(warning, "expected an unjudged-cycle warning");
  assert.match(warning.message, /#1382/);
});

// Review of PR #1387 (B1): a role's top-level `needs` entry that no capability's
// `inputs` covers must not be dropped from the graph -- empty `inputs` would
// otherwise hide a real deadlock from both the finding and the warning.
function alphaBetaNeeds({ alphaMapped, betaMapped }) {
  const alpha = { needs: [{ producerRole: "@scope/beta", artifact: "b" }], feeds: [{ artifact: "a", path: "clossys/alpha/a.json" }] };
  const beta = { needs: [{ producerRole: "@scope/alpha", artifact: "a" }], feeds: [{ artifact: "b", path: "clossys/beta/b.json" }] };
  if (alphaMapped) alpha.capabilities = [capability("make-a", [], ["clossys/alpha/a.json"])];
  if (betaMapped) beta.capabilities = [capability("make-b", [], ["clossys/beta/b.json"])];
  return manifests([{ name: "@scope/alpha", foundry: alpha }, { name: "@scope/beta", foundry: beta }]);
}

test("#1387 review: a top-level needs cycle behind two capability maps with empty inputs is still a needs-graph-cycle finding", () => {
  const result = evaluatePackageFramework(ROLES, alphaBetaNeeds({ alphaMapped: true, betaMapped: true }), { enforce: true });
  const cycle = result.findings.find((f) => f.rule === "needs-graph-cycle");
  assert.ok(cycle, "expected a needs-graph-cycle finding");
  assert.match(cycle.message, /@scope\/alpha#make-a/);
  assert.match(cycle.message, /@scope\/beta#make-b/);
});

test("#1387 review: the same cycle with only one role mapped is never silent -- it is an unjudged-cycle warning", () => {
  for (const [alphaMapped, betaMapped] of [[true, false], [false, true]]) {
    const result = evaluatePackageFramework(ROLES, alphaBetaNeeds({ alphaMapped, betaMapped }), { enforce: true });
    assert.equal(result.findings.some((f) => f.rule === "needs-graph-cycle"), false);
    const warning = result.warnings.find((f) => f.rule === "needs-graph-cycle-unjudged");
    assert.ok(warning, `expected an unjudged-cycle warning (alphaMapped=${alphaMapped}, betaMapped=${betaMapped})`);
    assert.match(warning.message, /@scope\/alpha/);
    assert.match(warning.message, /@scope\/beta/);
  }
});

test("#1387 review: an uncovered top-level need becomes an edge from every capability of the role", () => {
  const result = evaluatePackageFramework(ROLES, manifests([
    { name: "@scope/alpha", foundry: {
      needs: [{ producerRole: "@scope/beta", artifact: "b" }],
      feeds: [{ artifact: "a", path: "clossys/alpha/a.json" }],
      capabilities: [capability("first", [], ["clossys/alpha/first.json"]), capability("make-a", [], ["clossys/alpha/a.json"])],
    } },
    { name: "@scope/beta", foundry: {
      needs: [],
      feeds: [{ artifact: "b", path: "clossys/beta/b.json" }],
      // Waits on alpha's `first`, which does not own the `a` feed -- so the
      // cycle closes only if the uncovered need is an edge from `first` too.
      capabilities: [capability("make-b", [{ producerRole: "@scope/alpha", artifact: "first" }], ["clossys/beta/b.json"])],
    } },
  ]), { enforce: true });
  const cycle = result.findings.find((f) => f.rule === "needs-graph-cycle");
  assert.ok(cycle, "expected a needs-graph-cycle finding");
  assert.match(cycle.message, /@scope\/alpha#first -> @scope\/beta#make-b -> @scope\/alpha#first/);
});

test("#1382: report mode never evaluates cycles (the rule stays --enforce-only, as before)", () => {
  const result = evaluatePackageFramework(ROLES, manifests([
    { name: "@scope/alpha", foundry: { capabilities: [capability("draft", [{ producerRole: "@scope/beta", artifact: "review" }], ["clossys/alpha/draft.json"])] } },
    { name: "@scope/beta", foundry: { capabilities: [capability("review", [{ producerRole: "@scope/alpha", artifact: "draft" }], ["clossys/beta/review.json"])] } },
  ]));
  assert.equal(result.findings.some((f) => f.rule === "needs-graph-cycle"), false);
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
