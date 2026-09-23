// Contract-shape tests for the capability catalogue (PR #1398's blocker).
//
// Every test composes THIS repository's real catalogue with one change:
// packages/customer/package.json's `foundry` block gains the contract-shaped
// `needs`/`solves`/`feeds` values PR #1398 prepared
// (scripts/fixtures/customer-contract-needs-solves.json). Manifests are
// overlaid in memory through buildCapabilityCatalogue's `manifests` option,
// so nothing is written to disk.

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
const fixture = JSON.parse(readFileSync(join(repoRoot, "scripts/fixtures/customer-contract-needs-solves.json"), "utf8"));
const presetsContract = JSON.parse(readFileSync(join(repoRoot, "docs/contracts/kit-presets.json"), "utf8"));
const launchRoles = presetsContract.presets.find((preset) => preset.id === "launch").roles;

/** The real manifests, with `patch(directory, foundry)` applied to any package's `foundry` block. */
function manifestsWith(patches = {}) {
  const manifests = collectPackageManifests(repoRoot);
  for (const [directory, patch] of Object.entries(patches)) {
    const manifest = manifests.get(directory);
    manifests.set(directory, { ...manifest, foundry: patch(structuredClone(manifest.foundry ?? {})) });
  }
  return manifests;
}

const withCustomerFixture = (foundry) => ({ ...foundry, ...structuredClone(fixture.foundry) });

function catalogueWith(patches = {}, options = {}) {
  return buildCapabilityCatalogue(repoRoot, { manifests: manifestsWith(patches), ...options });
}

const customerCatalogue = () => catalogueWith({ customer: withCustomerFixture });
const roleOf = (catalogue, role) => catalogue.roles.find((entry) => entry.role === role);

/** Publisher's `surface-documents` capability waiting on Customer's keep: a genuine deadlock. */
function publisherSurfacesWaitOnKeep(foundry) {
  const surfaces = foundry.capabilities.find((capability) => capability.id === "surface-documents");
  surfaces.inputs = [...surfaces.inputs, { producerRole: "@clossys/customer", artifact: "keep-verdict" }];
  return foundry;
}

test("a contract-shaped `needs` edge resolves: producerRole's scoped name becomes the producer role", () => {
  const catalogue = customerCatalogue();
  const customer = roleOf(catalogue, "customer");
  assert.deepEqual(customer.needs, [
    { artifact: "surface-documents", role: "publisher", producerRole: "@clossys/publisher", source: "manifest" },
    { artifact: "audience-understanding", role: "strategist", producerRole: "@clossys/strategist", source: "manifest" },
  ]);
  assert.equal(customer.needs.some((need) => need.source.startsWith("fallback-")), false);

  // The producer's side of the edge names its consumer.
  assert.deepEqual(
    roleOf(catalogue, "publisher").feeds.filter((feed) => feed.role === "customer"),
    [{ artifact: "surface-documents", role: "customer", source: "manifest" }],
  );

  const composed = composeKit({ selectedRoles: ["customer"], catalogue });
  assert.equal(composed.state, "composed");
  assert.deepEqual(composed.unsatisfiedNeeds, []);
  assert.deepEqual([...composed.addedForDependencies].sort(), ["controller", "designer", "publisher", "strategist", "writer"]);
  assert.ok(composed.sequence.indexOf("strategist") < composed.sequence.indexOf("customer"));
  assert.deepEqual(composed.roles.find((role) => role.role === "customer").inputsFrom, ["publisher", "strategist"]);
});

test("a declared `feeds` entry carries its path; one no role needs stays listed with no consumer", () => {
  const customer = roleOf(customerCatalogue(), "customer");
  assert.deepEqual(
    customer.feeds.filter((feed) => feed.source === "manifest"),
    [{ artifact: "keep-verdict", path: "clossys/customer/keep.json", source: "manifest" }],
  );
});

test("a `needs` edge naming a producer outside this repository's scope is unsatisfied, never guessed", () => {
  const catalogue = catalogueWith({
    customer: (foundry) => ({ ...withCustomerFixture(foundry), needs: [{ producerRole: "publisher", artifact: "surface-documents" }] }),
  });
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

test("a `qualified` contract-shaped `solves` entry is carried field for field, `statement` and `capability` included", () => {
  const catalogue = catalogueWith({
    customer: (foundry) => {
      const next = withCustomerFixture(foundry);
      next.solves = [{ ...next.solves[0], notAContractField: "dropped" }];
      return next;
    },
  });
  assert.deepEqual(roleOf(catalogue, "customer").solves, fixture.foundry.solves);
  // The advisory preset floor now credits Customer's real claim.
  const flagged = presetEvidenceFindings({ presets: presetsContract.presets, catalogue }).map((finding) => finding.role);
  assert.equal(flagged.includes("customer"), false);
  assert.equal(flagged.includes("publisher"), true);
});

test("a `solves` entry missing the contract's required `statement` is dropped", () => {
  const catalogue = catalogueWith({
    customer: (foundry) => {
      const next = withCustomerFixture(foundry);
      const { statement, ...withoutStatement } = next.solves[0];
      next.solves = [withoutStatement];
      return next;
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

test("the Customer<->Publisher role-level loop is legitimate per #1382: every real preset still passes", () => {
  const catalogue = customerCatalogue();
  const result = evaluateOfferingKits({ contract: presetsContract, catalogue });
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.warnings, []);

  const launch = composeKit({ selectedRoles: launchRoles, catalogue });
  assert.equal(launch.state, "composed");
  assert.deepEqual(launch.unsatisfiedNeeds, []);
  assert.equal(launch.unjudgedCycle, null);
  assert.deepEqual(launch.roleCycles, [["customer", "publisher", "customer"]]);
  assert.deepEqual(judgeNeedsCycles({ roleNames: launch.sequence, catalogue }), { capabilityCycle: null, unjudgedCycle: null });
});

test("the catalogue's cycle verdict agrees with check-package-framework's --enforce verdict", () => {
  const verdicts = (patches) => {
    const byDirectory = manifestsWith(patches);
    const manifestsByName = new Map([...byDirectory.values()].map((manifest) => [manifest.name, manifest]));
    const gate = evaluatePackageFramework([...manifestsByName.keys()], manifestsByName, { enforce: true });
    const catalogue = buildCapabilityCatalogue(repoRoot, { manifests: byDirectory });
    return {
      gateDeadlock: gate.findings.some((finding) => finding.rule === "needs-graph-cycle"),
      kitDeadlock: composeKit({ selectedRoles: launchRoles, catalogue }).state === "indeterminate",
    };
  };
  assert.deepEqual(verdicts({ customer: withCustomerFixture }), { gateDeadlock: false, kitDeadlock: false });
  assert.deepEqual(verdicts({ customer: withCustomerFixture, publisher: publisherSurfacesWaitOnKeep }), { gateDeadlock: true, kitDeadlock: true });
  assert.deepEqual(verdicts({ customer: customerNeedsSealing }), { gateDeadlock: true, kitDeadlock: true });
});

test("a cycle among capabilities is a deadlock: the kit is indeterminate and the preset a finding", () => {
  const catalogue = catalogueWith({ customer: withCustomerFixture, publisher: publisherSurfacesWaitOnKeep });
  const launch = composeKit({ selectedRoles: launchRoles, catalogue });
  assert.equal(launch.state, "indeterminate");
  assert.match(launch.reason, /customer#keep-verdict -> publisher#surface-documents -> customer#keep-verdict/);
  const rules = evaluateOfferingKits({ contract: presetsContract, catalogue }).findings.map((finding) => finding.rule);
  assert.equal(rules.includes("preset-does-not-compose"), true);
});

/** A summary `needs` entry naming Publisher's sealing, which no Customer capability's `inputs` covers. */
function customerNeedsSealing(foundry) {
  const next = withCustomerFixture(foundry);
  next.needs = [...next.needs, { producerRole: "@clossys/publisher", artifact: "sealing-and-the-publication-record" }];
  return next;
}

test("a top-level need no capability input covers is never dropped: every capability of that role waits on it", () => {
  // Sealing waits on keep-verdict. The uncovered summary entry cannot be
  // pinned to one Customer capability, so all of them -- keep-verdict
  // included -- wait on sealing, and that is a deadlock.
  const catalogue = catalogueWith({ customer: customerNeedsSealing });
  const { capabilityCycle } = judgeNeedsCycles({ roleNames: ["customer", "publisher"], catalogue });
  assert.deepEqual(capabilityCycle, ["publisher#sealing-and-the-publication-record", "customer#keep-verdict", "publisher#sealing-and-the-publication-record"]);
});

test("a cycle only visible through a role with no capability map is unjudged: composed, and named", () => {
  const catalogue = catalogueWith({
    // Two roles with no capability map that need each other.
    inspector: (foundry) => ({ ...foundry, needs: [{ producerRole: "@clossys/integrator", artifact: "integration-report" }] }),
    integrator: (foundry) => ({ ...foundry, needs: [{ producerRole: "@clossys/inspector", artifact: "inspection-report" }] }),
  });
  assert.deepEqual(roleOf(catalogue, "inspector").capabilities, []);
  const composed = composeKit({ selectedRoles: ["inspector"], catalogue });
  assert.equal(composed.state, "composed");
  assert.deepEqual(composed.unjudgedCycle, ["inspector", "integrator", "inspector"]);
  const result = evaluateOfferingKits({ contract: presetsContract, catalogue });
  assert.equal(result.findings.some((finding) => finding.rule === "preset-does-not-compose"), false);
  assert.deepEqual(result.warnings.map((warning) => `${warning.rule} ${warning.preset}`), ["needs-graph-cycle-unjudged ship-safely"]);
});
