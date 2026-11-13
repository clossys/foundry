import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStrategy } from "./api.js";
import { stageSlot } from "./__fixtures__/slot-model.js";
import { reader } from "../test/store.js";

const roots: string[] = [];
const id = "focus.segment.core";
const contract = { id: "fixture.read", schemaVersion: 1 as const, owner: "fixture", requires: [id], optional: [] };
const direction = ["Who: Fictional studio teams.", "Not: Large factories."];
const options = { because: ["Interview evidence."], watch: ["If requests > 5 each month, then review."] };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "strategy-api-")); roots.push(root);
  stageSlot(root, id, 1, direction, options);
  stageSlot(root, id, 2, direction, { ...options, unpinned: true });
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("synchronous strategy read API", () => {
  it("reads the pinned candidate as the cell; an unpinned candidate resolves only by its version, as a draft", () => {
    const strategy = openStrategy(fixture(), reader, { contracts: [contract] });
    expect(strategy).not.toBeInstanceOf(Promise);
    expect(strategy.getCell(id)?.version).toBe(1);
    expect(strategy.getCell(id, 1)?.version).toBe(1);
    expect(strategy.getCell(id, 2)).toMatchObject({ version: 2, status: "draft" });
    expect(strategy.getCell(id, 3)).toBeUndefined();
    expect(strategy.getCell("unknown.cell.id")).toBeUndefined();
    expect(strategy.getActive(id)?.version).toBe(1);
    // Pinned is not enough: the fixture fails Q2 and Q3 (see the completion test below), so the handoff counts it missing.
    expect(strategy.getBrief(contract.id)).toMatchObject({ state: "missing", missing: [id] });
  });
  it("unpinned candidates never stale a current ref, but pinning a newer version does", () => {
    const root = fixture();
    expect(openStrategy(root, reader).isStale({ cell: id, version: 1 })).toBe(false);
    expect(openStrategy(root, reader).isStale({ cell: id, version: 2 })).toBe(true);
    stageSlot(root, id, 2, direction, options);
    const activated = openStrategy(root, reader);
    expect(activated.isStale({ cell: id, version: 1 })).toBe(true);
    expect(activated.isStale({ cell: id, version: 2 })).toBe(false);
    expect(activated.isStale({ cell: "unknown.cell.id", version: 1 })).toBe(true);
  });
  it("uses the selected archetype core with canonical quality and completion levels", () => {
    const strategy = openStrategy(fixture(), reader, { archetype: "product-saas" });
    expect(strategy.status().counts.total).toBe(27);
    // The fixture misses a Direction label and a Because reference, so it is not complete;
    // a pin records who decided, so a pinned candidate needs no Q7 session confirmation.
    expect(strategy.status().cells.find(cell => cell.id === id)?.active).toBe(false);
    expect(strategy.status().cells.find(cell => cell.id === id)?.findings.filter(f => f.severity === "hard").map(f => f.rule)).toEqual(["Q2", "Q3"]);
    expect(strategy.status().cells.find(cell => cell.id === id)?.findings.some(f => f.rule === "Q7")).toBe(false);
    expect(strategy.status().l0Clean).toBe(false);
    expect(strategy.status({ scope: "full" }).counts.total).toBe(57);
    expect(() => openStrategy(fixture(), reader, { archetype: "unknown" })).toThrow(/archetype/i);
  });
  it("does not silently accept invalid or conflicting explicit contracts", () => {
    const root = fixture();
    expect(() => openStrategy(root, reader, { contracts: [{ ...contract, requires: ["unknown.cell.id"] }] })).toThrow(/contract/i);
    expect(() => openStrategy(root, reader, { contracts: [contract, { ...contract, requires: [] }] })).toThrow(/conflict/i);
    expect(() => openStrategy(root, reader).getBrief("../outside")).toThrow(/unknown.*contract/i);
  });
});
