import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildCapabilityCatalogue,
  composeKit,
  composeKitFromProblems,
  FIRST_ENGAGEMENT_ROLE_CAP,
  validateKitProposal,
} from "./lib/capability-catalogue.mjs";
import { evaluateOfferingKits, loadAndEvaluate } from "./check-offering-kits.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts/check-offering-kits.mjs");

function solvesFor(role, problem) {
  return [{ problem, metric: `${role} metric`, proofCase: `${role} proof case`, evidence: "designed" }];
}

function catalogue(overrides = {}) {
  const base = {
    schemaVersion: 1,
    roles: [
      { role: "writer", scopeName: "@clossys/writer", jobQuestion: "writer job", primaryMode: "fulfill", metric: { name: "approved copy coverage rate", direction: "increase" }, boundary: { owns: "copy", excludes: [] }, solves: solvesFor("writer", "writer-unapproved-copy"), fit: [], needs: [], feeds: [{ artifact: "writer-package", role: "publisher", source: "fallback-runtime-dependency" }] },
      { role: "designer", scopeName: "@clossys/designer", jobQuestion: "designer job", primaryMode: "assure", metric: { name: "design conformance rate", direction: "increase" }, boundary: { owns: "design", excludes: [] }, solves: solvesFor("designer", "designer-interface-quality"), fit: [], needs: [], feeds: [{ artifact: "designer-package", role: "publisher", source: "fallback-runtime-dependency" }] },
      { role: "publisher", scopeName: "@clossys/publisher", jobQuestion: "publisher job", primaryMode: "fulfill", metric: { name: "verified publication rate", direction: "increase" }, boundary: { owns: "publish", excludes: [] }, solves: solvesFor("publisher", "publisher-verified-release"), fit: [], needs: [
        { artifact: "writer-package", role: "writer", source: "fallback-runtime-dependency" },
        { artifact: "designer-package", role: "designer", source: "fallback-runtime-dependency" },
      ], feeds: [] },
      { role: "influencer", scopeName: "@clossys/influencer", jobQuestion: "influencer job", primaryMode: "optimize", metric: { name: "qualified response yield per thousand", direction: "increase" }, boundary: { owns: "reach", excludes: [] }, solves: solvesFor("influencer", "influencer-audience-response"), fit: [], needs: [{ artifact: "publisher-sequence-gate", role: "publisher", source: "fallback-non-runtime-order" }], feeds: [] },
      { role: "strategist", scopeName: "@clossys/strategist", jobQuestion: "strategist job", primaryMode: "reconcile", metric: { name: "strategy traceability rate", direction: "increase" }, boundary: { owns: "strategy", excludes: [] }, solves: solvesFor("strategist", "strategist-unclear-direction"), fit: [], needs: [], feeds: [] },
      { role: "customer", scopeName: "@clossys/customer", jobQuestion: "customer job", primaryMode: "interact", metric: { name: "customer keep rate", direction: "increase" }, boundary: { owns: "keep", excludes: [] }, solves: solvesFor("customer", "customer-would-they-keep-it"), fit: [], needs: [], feeds: [] },
      { role: "orphan", scopeName: "@clossys/orphan", jobQuestion: "unreachable need", primaryMode: "assure", metric: { name: "orphan rate", direction: "increase" }, boundary: { owns: "x", excludes: [] }, solves: [], fit: [], needs: [{ artifact: "missing-thing", role: undefined, source: "manifest" }], feeds: [] },
    ],
  };
  return { ...base, ...overrides };
}

function contract(overrides = {}) {
  return {
    schemaVersion: 1,
    presets: [
      { id: "launch", label: "Launch", problem: "We can't explain what we are.", roles: ["writer", "designer", "publisher"] },
      { id: "grow", label: "Grow", problem: "Get it in front of people.", addOnTo: "launch", roles: ["influencer"] },
    ],
    ...overrides,
  };
}

function rules(result) {
  return result.findings.map((item) => item.rule);
}

test("the committed repository contract passes against the real generated catalogue", () => {
  const result = loadAndEvaluate(repoRoot);
  assert.deepEqual(result.findings, []);
  assert.equal(result.presets.length, 5);
});

test("a well-formed fixture preset set passes", () => {
  assert.deepEqual(rules(evaluateOfferingKits({ contract: contract(), catalogue: catalogue() })), []);
});

test("a preset naming an unknown role is a finding", () => {
  const drifted = contract();
  drifted.presets[0].roles = ["writer", "designer", "not-a-real-role"];
  const found = rules(evaluateOfferingKits({ contract: drifted, catalogue: catalogue() }));
  assert.equal(found.includes("unknown-role"), true);
});

test("a preset that does not compose because of a needs cycle is a finding", () => {
  const cyclic = catalogue();
  cyclic.roles.find((r) => r.role === "writer").needs = [{ artifact: "publisher-package", role: "publisher", source: "fallback-runtime-dependency" }];
  const drifted = contract();
  const found = rules(evaluateOfferingKits({ contract: drifted, catalogue: cyclic }));
  assert.equal(found.includes("preset-does-not-compose"), true);
});

test("a preset whose role has an unresolvable need is a finding, not a silent pass", () => {
  const drifted = contract({ presets: [{ id: "launch", label: "Launch", problem: "p", roles: ["orphan"] }] });
  const found = rules(evaluateOfferingKits({ contract: drifted, catalogue: catalogue() }));
  assert.equal(found.includes("unsatisfied-need"), true);
});

test("addOnTo naming a preset id outside the contract is a finding", () => {
  const drifted = contract();
  drifted.presets[1].addOnTo = "not-a-preset";
  const found = rules(evaluateOfferingKits({ contract: drifted, catalogue: catalogue() }));
  assert.equal(found.includes("unknown-add-on-to"), true);
});

test("a duplicate preset id is a finding", () => {
  const drifted = contract();
  drifted.presets.push({ ...drifted.presets[0] });
  const found = rules(evaluateOfferingKits({ contract: drifted, catalogue: catalogue() }));
  assert.equal(found.includes("duplicate-preset-id"), true);
});

test("this gate does not require every package to appear in a preset", () => {
  const drifted = contract({ presets: [contract().presets[0]] });
  assert.deepEqual(rules(evaluateOfferingKits({ contract: drifted, catalogue: catalogue() })), []);
});

test("composeKit pulls in an unselected role that a needs edge names, and reports it as added", () => {
  const composed = composeKit({ selectedRoles: ["publisher"], catalogue: catalogue() });
  assert.equal(composed.state, "composed");
  assert.deepEqual(composed.sequence, ["writer", "designer", "publisher"]);
  assert.deepEqual(composed.addedForDependencies.sort(), ["designer", "writer"]);
  assert.deepEqual(composed.unsatisfiedNeeds, []);
});

test("composeKit reports an unknown selected role as indeterminate", () => {
  const composed = composeKit({ selectedRoles: ["not-a-role"], catalogue: catalogue() });
  assert.equal(composed.state, "indeterminate");
});

test("composeKit reports a needs cycle as indeterminate", () => {
  const cyclic = catalogue();
  cyclic.roles.find((r) => r.role === "writer").needs = [{ artifact: "publisher-package", role: "publisher", source: "fallback-runtime-dependency" }];
  const composed = composeKit({ selectedRoles: ["writer"], catalogue: cyclic });
  assert.equal(composed.state, "indeterminate");
});

test("composeKitFromProblems is deterministic: shuffled confirmed-problem order gives the identical result", () => {
  const problemsA = [
    { id: "writer-unapproved-copy", primary: true },
    { id: "designer-interface-quality" },
  ];
  const problemsB = [
    { id: "designer-interface-quality" },
    { id: "writer-unapproved-copy", primary: true },
  ];
  const a = composeKitFromProblems({ confirmedProblems: problemsA, catalogue: catalogue() });
  const b = composeKitFromProblems({ confirmedProblems: problemsB, catalogue: catalogue() });
  assert.deepEqual(a, b);
  assert.equal(a.state, "composed");
  assert.deepEqual(a.sequence, ["designer", "writer"]);
});

test("composeKitFromProblems requires exactly one primary confirmed problem", () => {
  const none = composeKitFromProblems({ confirmedProblems: [{ id: "writer-unapproved-copy" }], catalogue: catalogue() });
  assert.equal(none.state, "indeterminate");
  assert.match(none.reason, /exactly one confirmed problem must be marked primary/);

  const two = composeKitFromProblems({
    confirmedProblems: [{ id: "writer-unapproved-copy", primary: true }, { id: "designer-interface-quality", primary: true }],
    catalogue: catalogue(),
  });
  assert.equal(two.state, "indeterminate");
});

test("composeKitFromProblems enforces the first-engagement role cap unless overCapReason is given", () => {
  const confirmedProblems = [
    { id: "writer-unapproved-copy", primary: true },
    { id: "designer-interface-quality" },
    { id: "publisher-verified-release" },
    { id: "influencer-audience-response" },
    { id: "strategist-unclear-direction" },
    { id: "customer-would-they-keep-it" },
  ];
  const overCap = composeKitFromProblems({ confirmedProblems, catalogue: catalogue() });
  assert.equal(overCap.state, "over-cap");
  assert.equal(overCap.cap, FIRST_ENGAGEMENT_ROLE_CAP);
  assert.ok(overCap.roleCount > FIRST_ENGAGEMENT_ROLE_CAP);

  const withReason = composeKitFromProblems({ confirmedProblems, catalogue: catalogue(), overCapReason: "client asked for the full launch package plus grow" });
  assert.equal(withReason.state, "composed");
  assert.equal(withReason.overCapReason, "client asked for the full launch package plus grow");
});

test("composeKitFromProblems reports no direct role as indeterminate, never a silent empty kit", () => {
  const result = composeKitFromProblems({ confirmedProblems: [{ id: "not-a-real-problem", primary: true }], catalogue: catalogue() });
  assert.equal(result.state, "indeterminate");
});

test("validateKitProposal drops a role that links to no confirmed problem and is not needed by one that does", () => {
  const confirmedProblems = [{ id: "writer-unapproved-copy", primary: true }];
  const result = validateKitProposal({
    proposal: {
      problem: "Our words don't sound like us.",
      roles: [
        { role: "writer", why: "writer job" },
        { role: "strategist", why: "seemed related" },
      ],
    },
    confirmedProblems,
    catalogue: catalogue(),
  });
  assert.equal(result.state, "indeterminate");
  assert.deepEqual(result.removalCandidates, ["strategist"]);
  assert.equal(result.findings.some((f) => f.rule === "ungrounded-role" && f.role === "strategist"), true);
});

test("validateKitProposal accepts every role the deterministic composition itself justifies, including a dependency-closure role", () => {
  const confirmedProblems = [{ id: "publisher-verified-release", primary: true }];
  const result = validateKitProposal({
    proposal: {
      problem: "We're not sure what's actually live.",
      roles: [
        { role: "publisher", problemId: "publisher-verified-release", why: "publisher job" },
        { role: "writer", why: "needed by publisher" },
        { role: "designer", why: "needed by publisher" },
      ],
    },
    confirmedProblems,
    catalogue: catalogue(),
  });
  assert.equal(result.state, "valid");
  assert.deepEqual(result.removalCandidates, []);
});

test("buildCapabilityCatalogue over this repository produces an entry per role with edge provenance recorded", () => {
  const built = buildCapabilityCatalogue(repoRoot);
  const roleNames = built.roles.map((role) => role.role).sort();
  assert.equal(roleNames.includes("launcher"), false);
  assert.equal(roleNames.includes("starter"), false);
  assert.equal(roleNames.includes("publisher"), true);
  const publisher = built.roles.find((role) => role.role === "publisher");
  assert.equal(publisher.needs.every((need) => need.source.startsWith("fallback-")), true);
});

test("the CLI reports PASS on this repository", () => {
  const run = spawnSync(process.execPath, [script], { encoding: "utf8", cwd: repoRoot });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /offering kits: PASS/);
});
