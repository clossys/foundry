// Regression tests for check-capability-maps.mjs.
//
// Mirrors check-package-framework.test.mjs: fixture manifests plant a
// declaration that must be caught, or an absence that must stay visible
// (and never fail report mode).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUSINESS_LIFECYCLE_STAGES,
  CAPABILITY_MATURITIES,
  buildCapabilityCatalogue,
  evaluateCapabilityMaps,
  validateCapabilityShape,
} from "./check-capability-maps.mjs";

const ROLES = ["@scope/alpha", "@scope/beta"];
function manifests(entries) { return new Map(entries.map((manifest) => [manifest.name, manifest])); }

function capability(overrides = {}) {
  return {
    id: "confirm-fit",
    subQuestion: "Is this role a fit for the client?",
    worldClass: "Recommends only when evidence supports it.",
    inputs: [],
    outputs: ["clossys/alpha/fit-report.json"],
    proofCase: "case-1",
    maturity: "built",
    v0: true,
    ...overrides,
  };
}

test("absence of capabilities is printed and counted, never a report-mode failure", () => {
  const result = evaluateCapabilityMaps(ROLES, manifests([{ name: "@scope/alpha", foundry: {} }, { name: "@scope/beta", foundry: {} }]));
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.table.map((row) => row.capabilities), ["absent", "absent"]);
});

test("a well-formed capability declares cleanly with no findings", () => {
  const result = evaluateCapabilityMaps(ROLES, manifests([
    { name: "@scope/alpha", foundry: { capabilities: [capability()] } },
    { name: "@scope/beta", foundry: {} },
  ]));
  assert.deepEqual(result.findings, []);
  assert.equal(result.table.find((row) => row.role === "@scope/alpha").capabilities, "declared");
  assert.equal(result.table.find((row) => row.role === "@scope/alpha").count, 1);
});

test("an empty capabilities array is malformed, not an absence", () => {
  const result = evaluateCapabilityMaps(ROLES, manifests([{ name: "@scope/alpha", foundry: { capabilities: [] } }, { name: "@scope/beta", foundry: {} }]));
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].rule, "invalid-capabilities-declaration");
});

test("validateCapabilityShape rejects a capability missing required fields", () => {
  const findings = validateCapabilityShape({ id: "x" }, "@scope/alpha");
  const rules = findings.map((f) => f.rule);
  assert.ok(rules.includes("invalid-capability-sub-question"));
  assert.ok(rules.includes("invalid-capability-world-class"));
  assert.ok(rules.includes("invalid-capability-outputs"));
  assert.ok(rules.includes("invalid-capability-proof-case"));
  assert.ok(rules.includes("invalid-capability-maturity"));
  assert.ok(rules.includes("invalid-capability-v0"));
});

test("validateCapabilityShape rejects an unknown maturity value", () => {
  const findings = validateCapabilityShape(capability({ maturity: "shipped" }), "@scope/alpha");
  assert.ok(findings.some((f) => f.rule === "invalid-capability-maturity"));
});

test("validateCapabilityShape rejects an output path outside the role's own folder", () => {
  const findings = validateCapabilityShape(capability({ outputs: ["clossys/beta/report.json"] }), "@scope/alpha");
  assert.ok(findings.some((f) => f.rule === "capability-output-outside-role-folder"));
});

test("validateCapabilityShape accepts every declared maturity and rejects businessLifecycleStage outside the fixed vocabulary", () => {
  for (const maturity of CAPABILITY_MATURITIES) {
    const proofCase = maturity === "planned" ? null : "case-1";
    assert.deepEqual(validateCapabilityShape(capability({ maturity, proofCase }), "@scope/alpha"), []);
  }
  const findings = validateCapabilityShape(capability({ businessLifecycleStage: "scale" }), "@scope/alpha");
  assert.ok(findings.some((f) => f.rule === "invalid-capability-business-lifecycle-stage"));
});

test("businessLifecycleStage is optional", () => {
  assert.deepEqual(validateCapabilityShape(capability(), "@scope/alpha"), []);
  assert.deepEqual(validateCapabilityShape(capability({ businessLifecycleStage: "launch" }), "@scope/alpha"), []);
});

test("within one role, no two capabilities may declare the same output", () => {
  const result = evaluateCapabilityMaps(["@scope/alpha"], manifests([
    { name: "@scope/alpha", foundry: { capabilities: [
      capability({ id: "a", outputs: ["clossys/alpha/shared.json"] }),
      capability({ id: "b", outputs: ["clossys/alpha/shared.json"] }),
    ] } },
  ]));
  assert.ok(result.findings.some((f) => f.rule === "duplicate-capability-output"));
});

test("within one role, capability ids must be unique", () => {
  const result = evaluateCapabilityMaps(["@scope/alpha"], manifests([
    { name: "@scope/alpha", foundry: { capabilities: [capability({ id: "dup" }), capability({ id: "dup", outputs: ["clossys/alpha/other.json"] })] } },
  ]));
  assert.ok(result.findings.some((f) => f.rule === "duplicate-capability-id"));
});

test("duplicate sub-questions within one role are flagged — they cannot be jointly exhaustive if not distinct", () => {
  const result = evaluateCapabilityMaps(["@scope/alpha"], manifests([
    { name: "@scope/alpha", foundry: { capabilities: [
      capability({ id: "a", subQuestion: "same question", outputs: ["clossys/alpha/a.json"] }),
      capability({ id: "b", subQuestion: "same question", outputs: ["clossys/alpha/b.json"] }),
    ] } },
  ]));
  assert.ok(result.findings.some((f) => f.rule === "duplicate-capability-sub-question"));
});

test("whole-question coverage is never asserted as a finding — only reported as a warning", () => {
  const result = evaluateCapabilityMaps(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { capabilities: [capability()] } } ]));
  assert.deepEqual(result.findings, []);
  assert.ok(result.warnings.some((w) => w.rule === "capability-coverage-not-verified"));
});

// The outputs pathRule already namespaces every path under clossys/<role-short-name>/,
// so a real cross-role collision can only happen when two DIFFERENT scoped
// packages resolve to the same short name (e.g. @fixture-old-scope/alpha and
// @fixture-new-scope/alpha both deriving "alpha") -- exactly the fixture below.
const COLLIDING_ROLES = ["@fixture-old-scope/alpha", "@fixture-new-scope/alpha"];

test("report mode never checks cross-role output ownership", () => {
  const result = evaluateCapabilityMaps(COLLIDING_ROLES, manifests([
    { name: "@fixture-old-scope/alpha", foundry: { capabilities: [capability({ id: "a", outputs: ["clossys/alpha/x.json"] })] } },
    { name: "@fixture-new-scope/alpha", foundry: { capabilities: [capability({ id: "b", outputs: ["clossys/alpha/x.json"] })] } },
  ]));
  assert.deepEqual(result.findings, []);
});

test("--enforce catches an output claimed by capabilities in two different roles", () => {
  const result = evaluateCapabilityMaps(COLLIDING_ROLES, manifests([
    { name: "@fixture-old-scope/alpha", foundry: { capabilities: [capability({ id: "a", outputs: ["clossys/alpha/x.json"] })] } },
    { name: "@fixture-new-scope/alpha", foundry: { capabilities: [capability({ id: "b", outputs: ["clossys/alpha/x.json"] })] } },
  ]), { enforce: true });
  assert.ok(result.findings.some((f) => f.rule === "capability-output-multiple-owners"));
});

test("--enforce does not flag the same capability's own path counted twice", () => {
  const result = evaluateCapabilityMaps(["@scope/alpha"], manifests([
    { name: "@scope/alpha", foundry: { capabilities: [capability({ id: "a", outputs: ["clossys/alpha/x.json"] })] } },
  ]), { enforce: true });
  assert.deepEqual(result.findings.filter((f) => f.rule === "capability-output-multiple-owners"), []);
});

test("--enforce requires capabilities on every active role unless allowlisted", () => {
  const result = evaluateCapabilityMaps(ROLES, manifests([{ name: "@scope/alpha", foundry: {} }, { name: "@scope/beta", foundry: {} }]), { enforce: true });
  assert.equal(result.findings.length, 2);
  assert.ok(result.findings.every((f) => f.rule === "required-capabilities-absent"));
});

test("--allowlist exempts a named role from the required-capabilities finding", () => {
  const result = evaluateCapabilityMaps(ROLES, manifests([{ name: "@scope/alpha", foundry: {} }, { name: "@scope/beta", foundry: {} }]), {
    enforce: true,
    allowlistedRoles: ["@scope/alpha", "@scope/beta"],
  });
  assert.deepEqual(result.findings, []);
});

test("--enforce matches a feeds entry against exactly one producing capability", () => {
  const result = evaluateCapabilityMaps(["@scope/alpha"], manifests([
    { name: "@scope/alpha", foundry: {
      feeds: [{ artifact: "plan", path: "clossys/alpha/plan.json" }],
      capabilities: [capability({ id: "a", outputs: ["clossys/alpha/plan.json"] })],
    } },
  ]), { enforce: true });
  assert.deepEqual(result.findings, []);
});

test("--enforce flags a feeds entry no capability produces", () => {
  const result = evaluateCapabilityMaps(["@scope/alpha"], manifests([
    { name: "@scope/alpha", foundry: {
      feeds: [{ artifact: "plan", path: "clossys/alpha/plan.json" }],
      capabilities: [capability({ id: "a", outputs: ["clossys/alpha/other.json"] })],
    } },
  ]), { enforce: true });
  assert.ok(result.findings.some((f) => f.rule === "feed-not-fed-by-any-capability"));
});

test("--enforce flags a feeds entry produced by more than one capability", () => {
  const result = evaluateCapabilityMaps(["@scope/alpha"], manifests([
    { name: "@scope/alpha", foundry: {
      feeds: [{ artifact: "plan", path: "clossys/alpha/plan.json" }],
      capabilities: [
        capability({ id: "a", outputs: ["clossys/alpha/plan.json"] }),
        capability({ id: "b", subQuestion: "different question", outputs: ["clossys/alpha/plan.json", "clossys/alpha/extra.json"] }),
      ],
    } },
  ]), { enforce: true });
  assert.ok(result.findings.some((f) => f.rule === "feed-fed-by-multiple-capabilities"));
});

test("report mode does not check the feeds/capability match", () => {
  const result = evaluateCapabilityMaps(["@scope/alpha"], manifests([
    { name: "@scope/alpha", foundry: {
      feeds: [{ artifact: "plan", path: "clossys/alpha/plan.json" }],
      capabilities: [capability({ id: "a", outputs: ["clossys/alpha/other.json"] })],
    } },
  ]));
  assert.deepEqual(result.findings, []);
});

test("validateCapabilityShape rejects a planned capability with a non-null proofCase", () => {
  const findings = validateCapabilityShape(capability({ maturity: "planned", proofCase: "case-1" }), "@scope/alpha");
  assert.ok(findings.some((f) => f.rule === "invalid-capability-proof-case"));
});

test("validateCapabilityShape accepts a planned capability with proofCase: null", () => {
  assert.deepEqual(validateCapabilityShape(capability({ maturity: "planned", proofCase: null }), "@scope/alpha"), []);
});

test("validateCapabilityShape rejects a built capability with proofCase: null", () => {
  const findings = validateCapabilityShape(capability({ maturity: "built", proofCase: null }), "@scope/alpha");
  assert.ok(findings.some((f) => f.rule === "invalid-capability-proof-case"));
});

test("validateCapabilityShape resolves proofCase against a supplied known-case-id set", () => {
  const known = new Set(["case-1"]);
  assert.deepEqual(validateCapabilityShape(capability({ proofCase: "case-1" }), "@scope/alpha", known), []);
  const findings = validateCapabilityShape(capability({ proofCase: "case-99" }), "@scope/alpha", known);
  assert.ok(findings.some((f) => f.rule === "unresolved-capability-proof-case"));
});

test("validateCapabilityShape skips proofCase resolution when no known-case-id set is supplied", () => {
  assert.deepEqual(validateCapabilityShape(capability({ proofCase: "anything" }), "@scope/alpha"), []);
});

test("evaluateCapabilityMaps threads proofCaseIdsByRole into per-capability resolution", () => {
  const result = evaluateCapabilityMaps(["@scope/alpha"], manifests([
    { name: "@scope/alpha", foundry: { capabilities: [capability({ proofCase: "unknown-case" })] } },
  ]), { proofCaseIdsByRole: new Map([["@scope/alpha", new Set(["case-1"])]]) });
  assert.ok(result.findings.some((f) => f.rule === "unresolved-capability-proof-case"));
});

test("capability-input resolution runs in report mode (no --enforce needed)", () => {
  const result = evaluateCapabilityMaps(["@scope/alpha", "@scope/beta"], manifests([
    { name: "@scope/alpha", foundry: { capabilities: [capability({ id: "produced", outputs: ["clossys/alpha/x.json"] })] } },
    { name: "@scope/beta", foundry: { capabilities: [capability({
      id: "consumer", outputs: ["clossys/beta/y.json"],
      inputs: [{ producerRole: "@scope/alpha", artifact: "produced" }],
    })] } },
  ]));
  assert.deepEqual(result.findings.filter((f) => f.rule === "unresolved-capability-input"), []);
});

test("capability-input resolution flags an unresolved input in report mode", () => {
  const result = evaluateCapabilityMaps(["@scope/alpha", "@scope/beta"], manifests([
    { name: "@scope/alpha", foundry: { capabilities: [capability({ id: "produced", outputs: ["clossys/alpha/x.json"] })] } },
    { name: "@scope/beta", foundry: { capabilities: [capability({
      id: "consumer", outputs: ["clossys/beta/y.json"],
      inputs: [{ producerRole: "@scope/alpha", artifact: "nonexistent" }],
    })] } },
  ]));
  assert.ok(result.findings.some((f) => f.rule === "unresolved-capability-input"));
});

test("--enforce also resolves a capability input against the producer role's own capability id (same result as report mode)", () => {
  const result = evaluateCapabilityMaps(["@scope/alpha", "@scope/beta"], manifests([
    { name: "@scope/alpha", foundry: { capabilities: [capability({ id: "produced", outputs: ["clossys/alpha/x.json"] })] } },
    { name: "@scope/beta", foundry: { capabilities: [capability({
      id: "consumer", outputs: ["clossys/beta/y.json"],
      inputs: [{ producerRole: "@scope/alpha", artifact: "produced" }],
    })] } },
  ]), { enforce: true });
  assert.deepEqual(result.findings.filter((f) => f.rule === "unresolved-capability-input"), []);
});

test("--enforce also flags a capability input that names no real capability id on the producer role", () => {
  const result = evaluateCapabilityMaps(["@scope/alpha", "@scope/beta"], manifests([
    { name: "@scope/alpha", foundry: { capabilities: [capability({ id: "produced", outputs: ["clossys/alpha/x.json"] })] } },
    { name: "@scope/beta", foundry: { capabilities: [capability({
      id: "consumer", outputs: ["clossys/beta/y.json"],
      inputs: [{ producerRole: "@scope/alpha", artifact: "nonexistent" }],
    })] } },
  ]), { enforce: true });
  assert.ok(result.findings.some((f) => f.rule === "unresolved-capability-input"));
});

test("an unresolved capability input naming an allowlisted producer role is forgiven in either mode", () => {
  const manifestsFixture = manifests([
    { name: "@scope/beta", foundry: { capabilities: [capability({
      id: "consumer", outputs: ["clossys/beta/y.json"],
      inputs: [{ producerRole: "@scope/alpha", artifact: "anything" }],
    })] } },
  ]);
  const reportResult = evaluateCapabilityMaps(["@scope/alpha", "@scope/beta"], manifestsFixture, { allowlistedRoles: ["@scope/alpha"] });
  assert.deepEqual(reportResult.findings.filter((f) => f.rule === "unresolved-capability-input"), []);
  const enforceResult = evaluateCapabilityMaps(["@scope/alpha", "@scope/beta"], manifestsFixture, { enforce: true, allowlistedRoles: ["@scope/alpha"] });
  assert.deepEqual(enforceResult.findings.filter((f) => f.rule === "unresolved-capability-input"), []);
});

// Issue #1279: a capability input naming a NON-allowlisted producer role
// that simply has no capability map at all yet (the role's own manifest
// carries no `foundry.capabilities`, or no manifest at all) must never fail
// report mode -- that is absence, the same thing `required-capabilities-
// absent` already forgives for that producer directly, not a genuine
// mismatch. It is reported as a warning instead. The prior version of this
// test asserted the opposite (a report-mode failure) -- that was exactly
// the bug the reviewer reproduced on PR #1258 with a mutated Keeper input
// (see issue #1279's own repro).
test("report mode never fails on a capability input naming a producer role with no capability map at all — reported as a warning instead", () => {
  const result = evaluateCapabilityMaps(["@scope/alpha", "@scope/beta"], manifests([
    { name: "@scope/beta", foundry: { capabilities: [capability({
      id: "consumer", outputs: ["clossys/beta/y.json"],
      inputs: [{ producerRole: "@scope/alpha", artifact: "anything" }],
    })] } },
  ]));
  assert.deepEqual(result.findings.filter((f) => f.rule === "unresolved-capability-input"), []);
  assert.ok(result.warnings.some((w) => w.rule === "capability-input-producer-absent" && w.role === "@scope/beta"));
});

// The same absence, under --enforce, stays a failure -- report mode's
// forgiveness above must not leak into --enforce, the same split
// `required-capabilities-absent` already draws for the producer directly.
test("--enforce still fails a capability input naming a NON-allowlisted producer role with no capability map at all", () => {
  const result = evaluateCapabilityMaps(["@scope/alpha", "@scope/beta"], manifests([
    { name: "@scope/beta", foundry: { capabilities: [capability({
      id: "consumer", outputs: ["clossys/beta/y.json"],
      inputs: [{ producerRole: "@scope/alpha", artifact: "anything" }],
    })] } },
  ]), { enforce: true });
  assert.ok(result.findings.some((f) => f.rule === "unresolved-capability-input" && f.role === "@scope/beta"));
});

// Distinct from absence: a producer role that DOES declare a capability
// map, but none of its own capabilities produce the named artifact, is a
// genuine mismatch -- issue #1279 does not touch this case, and it must
// stay a failure in both modes. capability-input resolution's existing
// "capability-input resolution flags an unresolved input in report mode"
// and "--enforce also flags a capability input that names no real
// capability id on the producer role" tests above already cover this; this
// is the same case named explicitly as the #1279 control.
test("a capability input naming a real capability on a producer role that HAS a map, but not the named one, stays a failure in both modes (not #1279's absence case)", () => {
  const manifestsFixture = manifests([
    { name: "@scope/alpha", foundry: { capabilities: [capability({ id: "produced", outputs: ["clossys/alpha/x.json"] })] } },
    { name: "@scope/beta", foundry: { capabilities: [capability({
      id: "consumer", outputs: ["clossys/beta/y.json"],
      inputs: [{ producerRole: "@scope/alpha", artifact: "nonexistent" }],
    })] } },
  ]);
  const reportResult = evaluateCapabilityMaps(["@scope/alpha", "@scope/beta"], manifestsFixture);
  assert.ok(reportResult.findings.some((f) => f.rule === "unresolved-capability-input"));
  assert.deepEqual(reportResult.warnings.filter((w) => w.rule === "capability-input-producer-absent"), []);
  const enforceResult = evaluateCapabilityMaps(["@scope/alpha", "@scope/beta"], manifestsFixture, { enforce: true });
  assert.ok(enforceResult.findings.some((f) => f.rule === "unresolved-capability-input"));
});

test("buildCapabilityCatalogue lays each capability along its declared business lifecycle stage", () => {
  const catalogue = buildCapabilityCatalogue(ROLES, manifests([
    { name: "@scope/alpha", foundry: { capabilities: [capability({ id: "a", businessLifecycleStage: "launch" })] } },
    { name: "@scope/beta", foundry: { capabilities: [capability({ id: "b", businessLifecycleStage: "operate", outputs: ["clossys/beta/x.json"] })] } },
  ]));
  assert.deepEqual(catalogue.byStage.get("launch"), [{ role: "@scope/alpha", id: "a" }]);
  assert.deepEqual(catalogue.byStage.get("operate"), [{ role: "@scope/beta", id: "b" }]);
  assert.deepEqual(catalogue.unassigned, []);
});

test("buildCapabilityCatalogue buckets an unassigned capability rather than dropping it", () => {
  const catalogue = buildCapabilityCatalogue(["@scope/alpha"], manifests([{ name: "@scope/alpha", foundry: { capabilities: [capability({ id: "a" })] } }]));
  assert.deepEqual(catalogue.unassigned, [{ role: "@scope/alpha", id: "a" }]);
});

test("every declared business lifecycle stage is represented in the catalogue, even with zero capabilities", () => {
  const catalogue = buildCapabilityCatalogue([], new Map());
  assert.deepEqual([...catalogue.byStage.keys()], [...BUSINESS_LIFECYCLE_STAGES]);
});
