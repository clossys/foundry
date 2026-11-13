import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { runSourceEsm } from "./lib/surface-source-runtime.mjs";
import { checkSurfaceDescriptorTransitions } from "./lib/surface-history-continuity.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const { api, stableStringify, live } = await runSourceEsm(root, async sourceModule => ({
  api: await sourceModule(path.join(root, "packages/designer/src/catalog-core/surface-library.ts")),
  stableStringify: (await sourceModule(path.join(root, "packages/designer/src/catalog-core/stable.ts"))).stableStringify,
  live: (await sourceModule(path.join(root, "packages/designer/src/library-cli/surface-catalog.ts"))).foundrySurfaceCatalog(),
}));
const hash = "sha256:6e1d05c03a31919afbd1a644c8f6521672090321ba730195dc2fd7c85721270a";
const previous = live.packageHistory[hash][0];
const prior = { source: "1988bfd3d2f19cbbd53185a5b014fe074938464a:native-source", catalog: { fills: [previous.document], slots: [previous.contract] } };
const check = (catalog, priors = [prior]) => checkSurfaceDescriptorTransitions({ catalog, priors, api, stableStringify });

test("unchanged current source needs no historical registration", () => {
  assert.deepEqual(check({ ...live, packageHistory: {} }, [{ source: "unchanged", catalog: live }]), { findings: [], rows: [] });
});

test("genuine prior public document and same-revision contract satisfy continuity", () => {
  const result = check(live);
  assert.deepEqual(result.findings, []);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].status, "PASS");
});

for (const mutation of ["missing", "duplicate", "wrong-source", "changed-body", "changed-contract", "missing-pin", "wrong-hash"]) {
  test(`continuity refuses ${mutation} history and passes after restoration`, () => {
    const catalog = { ...live, packageHistory: structuredClone(live.packageHistory) };
    const rows = catalog.packageHistory[hash];
    if (mutation === "missing") delete catalog.packageHistory[hash];
    if (mutation === "duplicate") rows.push(structuredClone(rows[0]));
    if (mutation === "wrong-source") rows[0].document.$extensions["com.clossys.fill"].source = "other";
    if (mutation === "changed-body") rows[0].document.frames["app-shell"].consumption.sourceFiles[0].sha256 = "0".repeat(64);
    if (mutation === "changed-contract") rows[0].contract.description = "Changed contract";
    if (mutation === "missing-pin") delete rows[0].document.$extensions["com.clossys.fill"].pin;
    if (mutation === "wrong-hash") { delete catalog.packageHistory[hash]; catalog.packageHistory["sha256:" + "0".repeat(64)] = rows; }
    assert.equal(check(catalog).findings[0]?.code, "surface-history-continuity");
    assert.deepEqual(check(live).findings, []);
  });
}

test("every package descriptor slot requires its prior full identity after change", () => {
  const fills = live.fills.filter(document => api.isSurfacePackageEntry(api.surfaceEntryOf(document)));
  assert.ok(fills.length > 40);
  for (const document of fills) {
    const slot = document.$extensions["com.clossys.fill"].slot;
    const changed = structuredClone(document);
    Object.values(changed[slot.split(".")[0]])[0].propMap.continuity = "next";
    const catalog = { ...live, fills: [changed], packageHistory: {} };
    const priors = [{ source: "previous-current", catalog: { fills: [document], slots: live.slots.filter(row => row.id === slot) } }];
    const result = check(catalog, priors);
    assert.equal(result.findings.length, 1, slot);
    assert.equal(result.findings[0].leaf, slot);
    assert.equal(result.findings[0].descriptorHash, api.surfacePackageDescriptorHash(api.surfaceEntryOf(document)));
  }
});

test("each merge parent's prior current is required independently", () => {
  const second = structuredClone(prior);
  second.source = "another-parent:native-source";
  second.catalog.fills[0].frames["app-shell"].propMap.continuity = "other-parent";
  const result = check(live, [prior, second]);
  assert.equal(result.rows.filter(row => row.status === "PASS").length, 1);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].baseline, second.source);
});

test("a contract change retains the previous full registration even when the descriptor hash stays current", () => {
  const document = live.fills.find(row => row.$extensions["com.clossys.fill"].slot === "frames.app-shell");
  const contract = live.slots.find(row => row.id === "frames.app-shell");
  const descriptorHash = api.surfacePackageDescriptorHash(api.surfaceEntryOf(document));
  const catalog = { ...live, fills: [document], slots: [structuredClone(contract)], packageHistory: {} };
  catalog.slots[0].description = "Changed public contract";
  const priors = [{ source: "same-hash-previous-contract", catalog: { fills: [document], slots: [contract] } }];
  assert.equal(check(catalog, priors).findings.length, 1);
  catalog.packageHistory[descriptorHash] = [{ document, contract }];
  assert.deepEqual(check(catalog, priors).findings, []);
});
