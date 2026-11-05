import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileBrief } from "./brief.js";
import { discoverBriefContracts, validateBriefContract } from "./brief-contracts.js";
import { openStrategy } from "./api.js";
import { readStrategyRoot } from "./store.js";
import { stageFinding, stageSlot, strategyRoot } from "./ground/fixtures.js";
import { reader } from "../test/store.js";

const roots: string[] = [];
const need = "context.customer.need", promise = "advantage.proposition.promise", differentiator = "advantage.defensibility.differentiator";
const contract = { id: "fixture.brief", schemaVersion: 1 as const, owner: "fixture", requires: [need], optional: ["context.customer.buying"] };
function put(root: string, path: string, bytes: string) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); }
/** Stages one candidate of a slot; an "active" one is pinned, any other status is left unpinned. */
function stage(root: string, id: string, version = 1, refs: string[] = [], status = "active") {
  stageSlot(root, id, version, ["Need: A fictional studio needs scheduling.", "Not: Large factories."], {
    refs, because: [`Measured interviews${refs.length ? ` (${refs.join(", ")})` : "."}`], watch: ["If requests > 5 each month, then review."], unpinned: status !== "active",
  });
}
function fixture(active: Record<string, number | null> = { [need]: 1 }) {
  const project = mkdtempSync(join(tmpdir(), "strategy-brief-")); roots.push(project);
  const root = strategyRoot(project);
  for (const [id, version] of Object.entries(active)) if (version) stage(root, id, version);
  return { root, project };
}
function brief(root: string, selected = contract) { return openStrategy(root, reader, { contracts: [selected] }).getBrief(selected.id); }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("brief compilation", () => {
  it("returns ready and copies Direction plus Watch with CellRef provenance", () => {
    const { root } = fixture(); const result = brief(root);
    expect(result.state).toBe("ready"); expect(result.missing).toEqual([]); expect(result.stale).toEqual([]);
    expect(result.cells[0]).toMatchObject({ cell: need, version: 1, direction: [{ key: "Need" }, { key: "Not" }], watch: [{ text: "If requests > 5 each month, then review." }] });
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/); expect(Number.isNaN(Date.parse(result.compiledAt))).toBe(false);
    const filtered = brief(root, { ...contract, keys: { [need]: ["Not"] } });
    expect(filtered.cells[0]?.direction.map(b => b.key)).toEqual(["Not"]);
    expect(filtered.cells[0]?.watch).toEqual(result.cells[0]?.watch);
  });
  it("lists missing required cells, ignores absent optional cells, and requires a pinned candidate", () => {
    const { root } = fixture({ [need]: null });
    expect(brief(root)).toMatchObject({ state: "missing", missing: [need], cells: [] });
    stage(root, need, 1, [], "draft");
    expect(brief(root).state).toBe("missing");
    stage(root, need, 1); rmSync(join(root, need, "candidates", "fixture-v1.md"));
    expect(brief(root).state).toBe("missing");
  });
  it("detects stale direct cell citations while a newer unpinned candidate has no effect", () => {
    const { root } = fixture({ [need]: 1, [promise]: 1 });
    stage(root, promise, 1, ["context.customer.need@1"]);
    const selected = { ...contract, requires: [promise] };
    expect(brief(root, selected).state).toBe("ready");
    stage(root, need, 2, [], "draft");
    expect(brief(root, selected).state).toBe("ready");
    stage(root, need, 2);
    expect(brief(root, selected)).toMatchObject({ state: "stale", stale: [{ cell: need, version: 1 }] });
  });
  it("checks transitive C1 dependencies even beyond the contract cell list", () => {
    const { root } = fixture({ [need]: 2, [promise]: 1, [differentiator]: 1 });
    stage(root, need, 1, [], "retired");
    stage(root, promise, 1, ["context.customer.need@1"]);
    stage(root, differentiator, 1, ["advantage.proposition.promise@1"]);
    expect(brief(root, { ...contract, requires: [differentiator] })).toMatchObject({ state: "stale", stale: [{ cell: need, version: 1 }] });
    stage(root, promise);
    expect(brief(root, { ...contract, requires: [differentiator] }).state).toBe("stale");
  });
  it("compares a previous compiled fingerprint and never writes the root", () => {
    // Compiled briefs live with Director evidence, outside the flat slot tree.
    const { root } = fixture(); const current = brief(root); const written = `../../evidence/director/briefs/${contract.id}.json`;
    put(root, written, JSON.stringify(current));
    expect(brief(root).state).toBe("ready");
    put(root, written, JSON.stringify({ ...current, fingerprint: "0".repeat(64) }));
    expect(brief(root).state).toBe("stale");
    expect(JSON.parse(readFileSync(join(root, written), "utf8")).fingerprint).toBe("0".repeat(64));
    // A brief left inside the slot tree is not read.
    put(root, `briefs/${contract.id}.json`, JSON.stringify(current));
    expect(brief(root).state).toBe("stale");
  });
  it("hashes sorted refs and exact cited file bytes, including evidence outside selected cells", () => {
    const { root } = fixture();
    const evidence = "---\nid: fixture-survey\nsource: user\nobserved: 2026-10-29\nby: researcher\n---\n- Five fictional studio interviews.\n";
    stageFinding(root, "fixture-survey", evidence);
    stage(root, need, 1, ["finding:fixture-survey"]);
    const model = readStrategyRoot(root, reader); const first = compileBrief(model, contract);
    const reordered = { ...model, cells: [...model.cells].reverse(), files: Object.fromEntries(Object.entries(model.files).reverse()) };
    expect(compileBrief(reordered, contract).fingerprint).toBe(first.fingerprint);
    stageFinding(root, "fixture-survey", evidence.replace("Five", "Six"));
    expect(brief(root).fingerprint).not.toBe(first.fingerprint);
    stageFinding(root, "fixture-survey", evidence.replace(/\n/g, "\r\n"));
    expect(brief(root).fingerprint).not.toBe(first.fingerprint);
    stageFinding(root, "fixture-survey", evidence);
    expect(brief(root).fingerprint).toBe(first.fingerprint);
  });
  it("does not hash unpinned candidates or depend on contract list order", () => {
    const { root } = fixture({ [need]: 1, ["context.customer.buying"]: 1 });
    const first = brief(root);
    stage(root, need, 2, [], "draft");
    expect(brief(root).fingerprint).toBe(first.fingerprint);
    expect(brief(root, { ...contract, requires: ["context.customer.buying", need], optional: [] }).fingerprint).toBe(first.fingerprint);
  });
});

describe("brief contracts", () => {
  it("validates known ids and rejects malformed contracts, unknown ids and keys", () => {
    expect(validateBriefContract(contract).ok).toBe(true);
    for (const value of [null, { ...contract, schemaVersion: 2 }, { ...contract, requires: ["unknown.cell.id"] }, { ...contract, keys: { "unknown.cell.id": ["Need"] } }, { ...contract, optional: [need] }, { ...contract, id: "../outside" }, { ...contract, owner: "" }]) expect(validateBriefContract(value).ok).toBe(false);
  });
  it("discovers installed scoped packages and root-local contracts without importing packages", () => {
    const { root, project } = fixture();
    put(project, "node_modules/@clossys/fixture-role/strategy-brief.json", JSON.stringify(contract));
    put(root, "contracts/local.json", JSON.stringify({ ...contract, id: "fixture.local" }));
    const found = discoverBriefContracts(root, reader);
    expect(found.issues).toEqual([]);
    expect(found.contracts.map(c => c.id)).toEqual(["fixture.brief", "fixture.local"]);
    expect(openStrategy(root, reader).getBrief(contract.id).state).toBe("ready");
  });
  it("reports invalid contracts and conflicting ids rather than picking an arbitrary source", () => {
    const { root, project } = fixture();
    put(project, "node_modules/@clossys/fixture-role/strategy-brief.json", JSON.stringify(contract));
    put(root, "contracts/duplicate.json", JSON.stringify({ ...contract, requires: [] }));
    put(root, "contracts/broken.json", "{broken");
    const found = discoverBriefContracts(root, reader);
    expect(found.contracts).toEqual([]);
    expect(found.issues.some(i => /conflict/i.test(i.message))).toBe(true);
    expect(found.issues.some(i => /JSON/i.test(i.message))).toBe(true);
    expect(() => openStrategy(root, reader)).toThrow(/contract/i);
  });
  it("rejects symlink escapes in local discovery and cached brief reads", () => {
    const { root, project } = fixture();
    put(project, "outside/contract.json", JSON.stringify(contract));
    symlinkSync(join(project, "outside"), join(root, "contracts"));
    expect(discoverBriefContracts(root, reader).issues.length).toBeGreaterThan(0);
    rmSync(join(root, "contracts"));
    put(project, "outside/brief.json", JSON.stringify({ fingerprint: "0".repeat(64) }));
    mkdirSync(join(root, "../../evidence/director/briefs"), { recursive: true }); symlinkSync(join(project, "outside/brief.json"), join(root, `../../evidence/director/briefs/${contract.id}.json`));
    expect(brief(root).state).toBe("stale");
  });
});
