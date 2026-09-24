// Contract-shape tests for the capability catalogue (PR #1398's blocker).
//
// Most tests compose THIS repository's real catalogue: the five v0 launch
// roles (customer, writer, designer, publisher, strategist) declare their
// contract-shaped `needs`/`solves`/`feeds` in their own package.json (#1172).
// Variants are overlaid in memory through buildCapabilityCatalogue's
// `manifests` option, so nothing is written to disk and no package is edited.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildCapabilityCatalogue,
  collectPackageManifests,
  composeKit,
  judgeNeedsCycles,
  presetEvidenceFindings,
} from "./capability-catalogue.mjs";
import { evaluateOfferingKits } from "../check-offering-kits.mjs";
import { evaluatePackageFramework } from "../check-package-framework.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LAUNCH_LANES = ["customer", "writer", "designer", "publisher", "strategist"];
const realManifests = collectPackageManifests(repoRoot);
/** Each launch role's own declared `foundry` block, read from its real package.json. */
const lanes = Object.fromEntries(LAUNCH_LANES.map((role) => [role, { foundry: structuredClone(realManifests.get(role).foundry) }]));
const presetsContract = JSON.parse(readFileSync(join(repoRoot, "docs/contracts/kit-presets.json"), "utf8"));
const launchRoles = presetsContract.presets.find((preset) => preset.id === "launch").roles;

/** The real manifests, with `patch(foundry)` applied to any package's `foundry` block. */
function manifestsWith(patches = {}) {
  const manifests = collectPackageManifests(repoRoot);
  for (const [directory, patch] of Object.entries(patches)) {
    const manifest = manifests.get(directory);
    manifests.set(directory, { ...manifest, foundry: patch(structuredClone(manifest.foundry ?? {})) });
  }
  return manifests;
}

/** The real manifests, unpatched: every launch role's values are its own declaration. */
const ALL_LANES = {};

/**
 * Two needs #1401 prepared on Designer that Designer does not feed:
 * `components-and-blocks` reaches Publisher as a package import, and
 * `logo-and-identity-files` is `planned`. The real manifest omits both; this
 * negative control puts them back.
 */
const UNFED_PUBLISHER_NEEDS = [
  { producerRole: "@clossys/designer", artifact: "components-and-blocks" },
  { producerRole: "@clossys/designer", artifact: "logo-and-identity-files" },
];

/** The real manifests, then `extra` patches applied on top. */
function allLanesWith(extra = {}) {
  const patches = { ...ALL_LANES };
  for (const [role, patch] of Object.entries(extra)) {
    const base = patches[role] ?? ((foundry) => foundry);
    patches[role] = (foundry) => patch(base(foundry));
  }
  return patches;
}

function catalogueWith(patches = {}, options = {}) {
  return buildCapabilityCatalogue(repoRoot, { manifests: manifestsWith(patches), ...options });
}

const lanesCatalogue = () => catalogueWith(ALL_LANES);
const roleOf = (catalogue, role) => catalogue.roles.find((entry) => entry.role === role);

/** Publisher's `surface-documents` capability waiting on Customer's keep: a genuine deadlock. */
function publisherSurfacesWaitOnKeep(foundry) {
  const surfaces = foundry.capabilities.find((capability) => capability.id === "surface-documents");
  surfaces.inputs = [...surfaces.inputs, { producerRole: "@clossys/customer", artifact: "keep-verdict" }];
  return foundry;
}

/** A summary `needs` entry naming Publisher's sealing, which no Customer capability's `inputs` covers. */
function customerNeedsSealing(foundry) {
  return { ...foundry, needs: [...foundry.needs, { producerRole: "@clossys/publisher", artifact: "sealing-and-the-publication-record" }] };
}

/**
 * Review of PR #1403 (F1): an input that resolves ONLY by capability id --
 * neither role declares `feeds` or top-level `needs` -- closes a deadlock.
 */
const idOnlyDeadlock = {
  customer: () => ({ needs: [], capabilities: [{ id: "keep", inputs: [{ producerRole: "@clossys/publisher", artifact: "one" }], outputs: ["clossys/customer/keep.json"] }] }),
  publisher: () => ({ needs: [], capabilities: [{ id: "one", inputs: [{ producerRole: "@clossys/customer", artifact: "keep" }], outputs: ["clossys/publisher/one.json"] }] }),
};

/**
 * Review of PR #1403 (N1): Customer's summary need names Publisher's
 * surfaces by a `feeds` alias, while `keep-verdict`'s input names the same
 * capability by id. They resolve to the same node, so the need is covered;
 * `surface-documents` waits only on `lived-feedback`, and nothing deadlocks.
 * Treating the need as uncovered would invent a cycle.
 */
const coveredByResolution = allLanesWith({
  customer: (foundry) => ({ ...foundry, needs: foundry.needs.map((need) => (need.artifact === "surface-documents" ? { ...need, artifact: "surfaces-alias" } : need)) }),
  publisher: (foundry) => {
    foundry.feeds = [...foundry.feeds, { artifact: "surfaces-alias", path: "clossys/publisher/surfaces/" }];
    const surfaces = foundry.capabilities.find((capability) => capability.id === "surface-documents");
    surfaces.inputs = [...surfaces.inputs, { producerRole: "@clossys/customer", artifact: "lived-feedback" }];
    return foundry;
  },
});

/**
 * Review of PR #1403 (F2): Publisher's surfaces wait on Influencer's reach
 * report, while Influencer -- no `needs` of its own, no capability map --
 * keeps its fallback need on Publisher from the committed non-runtime order.
 * That fallback names no Publisher capability, so it adds no edge; the loop
 * it closes must still be reported as unjudged, never as legitimate.
 */
const fallbackClosedLoop = allLanesWith({
  publisher: (foundry) => {
    const surfaces = foundry.capabilities.find((capability) => capability.id === "surface-documents");
    surfaces.inputs = [...surfaces.inputs, { producerRole: "@clossys/influencer", artifact: "reach-report" }];
    return { ...foundry, needs: [...foundry.needs, { producerRole: "@clossys/influencer", artifact: "reach-report" }] };
  },
  influencer: (foundry) => ({ ...foundry, feeds: [{ artifact: "reach-report", path: "clossys/influencer/reach.json" }] }),
});

/** Both verdicts for the same manifests: the framework gate's (--enforce) and kit composition's. */
function verdicts(patches, selectedRoles = launchRoles) {
  const byDirectory = manifestsWith(patches);
  const manifestsByName = new Map([...byDirectory.values()].map((manifest) => [manifest.name, manifest]));
  const gate = evaluatePackageFramework([...manifestsByName.keys()], manifestsByName, { enforce: true });
  const catalogue = buildCapabilityCatalogue(repoRoot, { manifests: byDirectory });
  const composed = composeKit({ selectedRoles, catalogue });
  const kitRoles = new Set(composed.sequence.map((role) => `@clossys/${role}`));
  return {
    gateDeadlock: gate.findings.some((finding) => finding.rule === "needs-graph-cycle"),
    kitDeadlock: composed.state === "indeterminate",
    gateUnmatched: gate.findings
      .filter((finding) => finding.rule === "unmatched-need" && kitRoles.has(finding.role))
      .map((finding) => `${finding.role.slice("@clossys/".length)} ${finding.message.match(/artifact: "([^"]+)"/)[1]}`)
      .sort(),
    kitUnsatisfied: (composed.unsatisfiedNeeds ?? []).map((need) => `${need.role} ${need.artifact}`).sort(),
  };
}

test("a contract-shaped `needs` edge resolves: producerRole's scoped name becomes the producer role", () => {
  const catalogue = lanesCatalogue();
  const customer = roleOf(catalogue, "customer");
  assert.deepEqual(customer.needs, [
    { artifact: "surface-documents", role: "publisher", producerRole: "@clossys/publisher", source: "manifest" },
    { artifact: "audience-understanding", role: "strategist", producerRole: "@clossys/strategist", source: "manifest" },
  ]);

  // The producer's side of the met edge names its consumer and its declared path.
  assert.deepEqual(
    roleOf(catalogue, "publisher").feeds.filter((feed) => feed.role === "customer"),
    [{ artifact: "surface-documents", role: "customer", path: "clossys/publisher/surfaces/", source: "manifest" }],
  );

  const composed = composeKit({ selectedRoles: ["customer"], catalogue });
  assert.equal(composed.state, "composed");
  assert.deepEqual(composed.unsatisfiedNeeds, []);
  assert.deepEqual([...composed.addedForDependencies].sort(), ["designer", "publisher", "strategist", "writer"]);
  assert.ok(composed.sequence.indexOf("strategist") < composed.sequence.indexOf("customer"));
  assert.deepEqual(composed.roles.find((role) => role.role === "customer").inputsFrom, ["publisher", "strategist"]);
});

test("`declaredFeeds` is the role's own `foundry.feeds`, verbatim and in declared order", () => {
  const catalogue = lanesCatalogue();
  assert.deepEqual(roleOf(catalogue, "strategist").declaredFeeds, lanes.strategist.foundry.feeds);
  assert.deepEqual(roleOf(catalogue, "controller").declaredFeeds, []);
});

test("a need is met only when its producer feeds the artifact, the same rule as the framework gate's unmatched-need", () => {
  // Publisher's full prepared `needs` (#1401), including the two entries
  // Designer does not feed, which the real manifest omits.
  const uncorrected = allLanesWith({ publisher: (foundry) => ({ ...foundry, needs: [...foundry.needs, ...UNFED_PUBLISHER_NEEDS] }) });
  const result = verdicts(uncorrected);
  assert.deepEqual(result.kitUnsatisfied, ["publisher components-and-blocks", "publisher logo-and-identity-files"]);
  assert.deepEqual(result.kitUnsatisfied, result.gateUnmatched);
  const rules = evaluateOfferingKits({ contract: presetsContract, catalogue: catalogueWith(uncorrected) }).findings.map((finding) => finding.rule);
  assert.equal(rules.includes("unsatisfied-need"), true);

  // As declared: nothing unmet on either side.
  const corrected = verdicts(ALL_LANES);
  assert.deepEqual(corrected.kitUnsatisfied, []);
  assert.deepEqual(corrected.gateUnmatched, []);

  // A producer that exists but declares no `feeds` at all does not meet a manifest need either.
  // Strategist keeps its capability map but declares no `feeds`: every need on it goes unmet.
  const unfed = verdicts({ strategist: (foundry) => ({ ...foundry, feeds: [] }) }, ["customer"]);
  assert.deepEqual(unfed.kitUnsatisfied, [
    "customer audience-understanding",
    "designer brand-derivation",
    "publisher strategy-brief",
    "writer brand-derivation",
    "writer claims",
  ]);
  assert.deepEqual(unfed.kitUnsatisfied, unfed.gateUnmatched);
});

test("a `needs` edge naming a producer outside this repository's scope is unsatisfied, never guessed", () => {
  const catalogue = catalogueWith(allLanesWith({ customer: (foundry) => ({ ...foundry, needs: [{ producerRole: "publisher", artifact: "surface-documents" }] }) }));
  const composed = composeKit({ selectedRoles: ["customer"], catalogue });
  assert.equal(composed.state, "composed");
  assert.deepEqual(composed.unsatisfiedNeeds, [{ role: "customer", artifact: "surface-documents", wantedRole: "publisher" }]);
});

test("the pre-contract edge shape (fromRole/toRole/role) is not read", () => {
  const catalogue = catalogueWith({
    customer: (foundry) => ({ ...foundry, needs: [{ fromRole: "publisher", artifact: "surface-documents" }, { role: "strategist", artifact: "audience-understanding" }] }),
  });
  // A declared array of entries without producerRole resolves to no edges at all.
  assert.deepEqual(roleOf(catalogue, "customer").needs, []);
});

test("`qualified` contract-shaped `solves` entries are carried field for field, `statement` and `capability` included", () => {
  // Every launch role declares `designed` today (no retained record qualifies
  // its current version), so raise Customer's claim here to cover `qualified`.
  const qualifiedCustomer = { ...lanes.customer.foundry.solves[0], evidence: "qualified" };
  const catalogue = catalogueWith(allLanesWith({ customer: (foundry) => ({ ...foundry, solves: [{ ...qualifiedCustomer, notAContractField: "dropped" }] }) }));
  const expected = { ...Object.fromEntries(LAUNCH_LANES.map((role) => [role, lanes[role].foundry.solves])), customer: [qualifiedCustomer] };
  for (const role of LAUNCH_LANES) assert.deepEqual(roleOf(catalogue, role).solves, expected[role], role);
  // The advisory preset floor credits every `qualified` claim, and only those.
  const flagged = new Set(presetEvidenceFindings({ presets: presetsContract.presets, catalogue }).map((finding) => finding.role));
  for (const role of LAUNCH_LANES) {
    assert.equal(flagged.has(role), expected[role].every((entry) => entry.evidence === "designed"), role);
  }
});

test("a `solves` entry missing the contract's required `statement` is dropped", () => {
  const catalogue = catalogueWith({
    customer: (foundry) => {
      const { statement, ...withoutStatement } = foundry.solves[0];
      return { ...foundry, solves: [withoutStatement] };
    },
  });
  assert.deepEqual(roleOf(catalogue, "customer").solves, []);
});

test("`fit` is read as the contract's package-relative path to a fit-signal declarations file", () => {
  const files = { "fit-signals.json": JSON.stringify({ schemaVersion: 1, role: "@clossys/customer", signals: [{ id: "named-audience-recorded", prompt: "p", evidenceKind: "repository-structure" }] }) };
  const readPackageFile = (directory, relativePath) => {
    if (directory === "customer" && relativePath in files) return files[relativePath];
    throw Object.assign(new Error("absent"), { code: "ENOENT" });
  };
  const declared = catalogueWith({ customer: (foundry) => ({ ...foundry, fit: "fit-signals.json" }) }, { readPackageFile });
  assert.deepEqual(roleOf(declared, "customer").fit, ["named-audience-recorded"]);
  const escaping = catalogueWith({ customer: (foundry) => ({ ...foundry, fit: "../fit-signals.json" }) }, { readPackageFile });
  assert.deepEqual(roleOf(escaping, "customer").fit, []);
});

test("with the five launch roles as declared, every real preset passes and the Customer<->Publisher loop is legitimate (#1382)", () => {
  const catalogue = lanesCatalogue();
  const result = evaluateOfferingKits({ contract: presetsContract, catalogue });
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.warnings, []);

  const launch = composeKit({ selectedRoles: launchRoles, catalogue });
  assert.equal(launch.state, "composed");
  assert.deepEqual(launch.unsatisfiedNeeds, []);
  assert.deepEqual([...launch.sequence].sort(), [...launchRoles].sort());
  assert.equal(launch.unjudgedCycle, null);
  assert.deepEqual(launch.roleCycles, [["customer", "publisher", "customer"]]);
  assert.deepEqual(judgeNeedsCycles({ roleNames: launch.sequence, catalogue }), { capabilityCycle: null, unjudgedCycle: null });
});

test("the catalogue's cycle verdict agrees with check-package-framework's --enforce verdict", () => {
  const cycles = (patches) => {
    const { gateDeadlock, kitDeadlock } = verdicts(patches);
    return { gateDeadlock, kitDeadlock };
  };
  assert.deepEqual(cycles(ALL_LANES), { gateDeadlock: false, kitDeadlock: false });
  assert.deepEqual(cycles(allLanesWith({ publisher: publisherSurfacesWaitOnKeep })), { gateDeadlock: true, kitDeadlock: true });
  assert.deepEqual(cycles(allLanesWith({ customer: customerNeedsSealing })), { gateDeadlock: true, kitDeadlock: true });
  assert.deepEqual(cycles(idOnlyDeadlock), { gateDeadlock: true, kitDeadlock: true });
  assert.deepEqual(cycles(coveredByResolution), { gateDeadlock: false, kitDeadlock: false });
});

test("an input resolved only by capability id closes a deadlock, as the gate reports", () => {
  const catalogue = catalogueWith(idOnlyDeadlock);
  assert.deepEqual(judgeNeedsCycles({ roleNames: ["customer", "publisher"], catalogue }).capabilityCycle, ["customer#keep", "publisher#one", "customer#keep"]);
});

test("a role loop closed by a fallback need that names no capability is unjudged, never legitimate (review F2)", () => {
  const catalogue = catalogueWith(fallbackClosedLoop);
  const influencer = roleOf(catalogue, "influencer");
  assert.deepEqual(influencer.capabilities, []);
  assert.deepEqual(influencer.needs.map((need) => `${need.source} ${need.role}`), ["fallback-non-runtime-order publisher"]);

  const grow = composeKit({ selectedRoles: presetsContract.presets.find((preset) => preset.id === "grow").roles, catalogue });
  assert.equal(grow.state, "composed");
  assert.deepEqual(grow.unsatisfiedNeeds, []);
  assert.deepEqual(grow.unjudgedCycle, ["influencer", "publisher", "influencer"]);
  assert.equal(grow.roleCycles.some((cycle) => cycle.includes("influencer")), true);

  const result = evaluateOfferingKits({ contract: presetsContract, catalogue });
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.warnings.map((warning) => `${warning.rule} ${warning.preset}`).sort(), ["needs-graph-cycle-unjudged grow", "needs-graph-cycle-unjudged launch"]);

  // The framework gate never sees fallback evidence: no finding there either way.
  const { gateDeadlock, kitDeadlock } = verdicts(fallbackClosedLoop);
  assert.deepEqual({ gateDeadlock, kitDeadlock }, { gateDeadlock: false, kitDeadlock: false });
});

test("the offering-kits gate lists every legitimate role loop, so none is invisible", () => {
  const result = evaluateOfferingKits({ contract: presetsContract, catalogue: lanesCatalogue() });
  assert.deepEqual(result.roleLoops.filter((loop) => loop.preset === "launch"), [{ preset: "launch", cycle: ["customer", "publisher", "customer"] }]);
});

/**
 * Review of PR #1403 (B1): Publisher's `feeds` lists `doc` twice. The gate
 * resolves a need through the FIRST declared entry; so must the kit.
 * `cycleThroughFirst` puts the capability that waits on Customer's keep
 * behind the first declared path (a deadlock); otherwise behind the second
 * (no deadlock).
 */
function duplicateFeedFixture(cycleThroughFirst) {
  const waitsOnKeep = [{ producerRole: "@clossys/customer", artifact: "keep" }];
  return {
    customer: () => ({
      needs: [{ producerRole: "@clossys/publisher", artifact: "doc" }],
      feeds: [{ artifact: "keep", path: "clossys/customer/keep.json" }],
      capabilities: [{ id: "keep", inputs: [{ producerRole: "@clossys/publisher", artifact: "doc" }], outputs: ["clossys/customer/keep.json"] }],
    }),
    publisher: () => ({
      needs: [{ producerRole: "@clossys/customer", artifact: "keep" }],
      feeds: [
        { artifact: "doc", path: "clossys/publisher/p1.json" },
        { artifact: "doc", path: "clossys/publisher/p2.json" },
      ],
      capabilities: [
        { id: "one", inputs: cycleThroughFirst ? waitsOnKeep : [], outputs: ["clossys/publisher/p1.json"] },
        { id: "two", inputs: cycleThroughFirst ? [] : waitsOnKeep, outputs: ["clossys/publisher/p2.json"] },
      ],
    }),
  };
}

test("a producer that declares one artifact twice resolves through its first declared entry, as the gate does", () => {
  const deadlock = verdicts(duplicateFeedFixture(true), ["customer"]);
  assert.deepEqual({ gate: deadlock.gateDeadlock, kit: deadlock.kitDeadlock }, { gate: true, kit: true });
  const catalogue = catalogueWith(duplicateFeedFixture(true));
  assert.deepEqual(judgeNeedsCycles({ roleNames: ["customer", "publisher"], catalogue }).capabilityCycle, ["customer#keep", "publisher#one", "customer#keep"]);

  const legitimate = verdicts(duplicateFeedFixture(false), ["customer"]);
  assert.deepEqual({ gate: legitimate.gateDeadlock, kit: legitimate.kitDeadlock }, { gate: false, kit: false });
});

test("a cycle among capabilities is a deadlock: the kit is indeterminate and the preset a finding", () => {
  const catalogue = catalogueWith(allLanesWith({ publisher: publisherSurfacesWaitOnKeep }));
  const launch = composeKit({ selectedRoles: launchRoles, catalogue });
  assert.equal(launch.state, "indeterminate");
  assert.match(launch.reason, /customer#keep-verdict -> publisher#surface-documents -> customer#keep-verdict/);
  const rules = evaluateOfferingKits({ contract: presetsContract, catalogue }).findings.map((finding) => finding.rule);
  assert.equal(rules.includes("preset-does-not-compose"), true);
});

test("a top-level need no capability input covers is never dropped: every capability of that role waits on it", () => {
  // Sealing waits on keep-verdict. The uncovered summary entry cannot be
  // pinned to one Customer capability, so all of them -- keep-verdict
  // included -- wait on sealing, and that is a deadlock.
  const catalogue = catalogueWith(allLanesWith({ customer: customerNeedsSealing }));
  const { capabilityCycle } = judgeNeedsCycles({ roleNames: ["customer", "publisher"], catalogue });
  assert.deepEqual(capabilityCycle, ["publisher#sealing-and-the-publication-record", "customer#keep-verdict", "publisher#sealing-and-the-publication-record"]);
});

test("a cycle only visible through a role with no capability map is unjudged: composed, and named", () => {
  const catalogue = catalogueWith({
    // Two roles with no capability map that need, and feed, each other.
    inspector: (foundry) => ({ ...foundry, needs: [{ producerRole: "@clossys/integrator", artifact: "integration-report" }], feeds: [{ artifact: "inspection-report", path: "clossys/inspector/report.json" }] }),
    integrator: (foundry) => ({ ...foundry, needs: [{ producerRole: "@clossys/inspector", artifact: "inspection-report" }], feeds: [{ artifact: "integration-report", path: "clossys/integrator/report.json" }] }),
  });
  assert.deepEqual(roleOf(catalogue, "inspector").capabilities, []);
  const composed = composeKit({ selectedRoles: ["inspector"], catalogue });
  assert.equal(composed.state, "composed");
  assert.deepEqual(composed.unsatisfiedNeeds, []);
  assert.deepEqual(composed.unjudgedCycle, ["inspector", "integrator", "inspector"]);
  const result = evaluateOfferingKits({ contract: presetsContract, catalogue });
  assert.equal(result.findings.some((finding) => finding.rule === "preset-does-not-compose"), false);
  assert.deepEqual(result.warnings.map((warning) => `${warning.rule} ${warning.preset}`), ["needs-graph-cycle-unjudged ship-safely"]);
});
