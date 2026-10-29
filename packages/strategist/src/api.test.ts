import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openStrategy } from "./api.js";
import { loadCatalog } from "./catalog.js";
import { readStrategyRoot } from "./store.js";

const roots: string[] = [];
const id = "focus.segment.core";
const contract = { id: "fixture.read", schemaVersion: 1 as const, owner: "fixture", requires: [id], optional: [] };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "strategy-api-")); roots.push(root);
  put(root, "tree.json", JSON.stringify({ schemaVersion: 1, catalog: "@clossys/strategist#strategy-v1", archetype: "default", core: "archetype", active: { [id]: 1 } }));
  put(root, `cells/${id}/v1.md`, cell(1, "active"));
  put(root, `cells/${id}/v2.md`, cell(2, "draft"));
  return root;
}
function put(root: string, path: string, bytes: string) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); }
function cell(version: number, status: string) {
  return `---\nid: ${id}\nversion: ${version}\nstatus: ${status}\nupdated: 2026-10-29\ncites: []\nfeeds: []\nfunctions: []\n${status === "active" ? "confirmed: msg:2026-10-29-1#U2\n" : ""}---\n\n## Direction\n- Who: Fictional studio teams.\n- Not: Large factories.\n\n## Because\n- Interview evidence.\n\n## Watch\n- If requests > 5 each month, then review.\n`;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("synchronous strategy read API", () => {
  it("gets the latest or pinned version while active follows the tree pointer", () => {
    const strategy = openStrategy(fixture(), { contracts: [contract] });
    expect(strategy).not.toBeInstanceOf(Promise);
    expect(strategy.getCell(id)?.version).toBe(2);
    expect(strategy.getCell(id, 1)?.version).toBe(1);
    expect(strategy.getCell(id, 3)).toBeUndefined();
    expect(strategy.getCell("unknown.cell.id")).toBeUndefined();
    expect(strategy.getActive(id)?.version).toBe(1);
    expect(strategy.getBrief(contract.id).state).toBe("ready");
  });
  it("drafts never stale a current ref, but activating a newer version does", () => {
    const root = fixture();
    expect(openStrategy(root).isStale({ cell: id, version: 1 })).toBe(false);
    expect(openStrategy(root).isStale({ cell: id, version: 2 })).toBe(true);
    put(root, "tree.json", JSON.stringify({ schemaVersion: 1, catalog: "@clossys/strategist#strategy-v1", archetype: "default", core: "archetype", active: { [id]: 2 } }));
    put(root, `cells/${id}/v2.md`, cell(2, "active"));
    const activated = openStrategy(root);
    expect(activated.isStale({ cell: id, version: 1 })).toBe(true);
    expect(activated.isStale({ cell: id, version: 2 })).toBe(false);
    expect(activated.isStale({ cell: "unknown.cell.id", version: 1 })).toBe(true);
  });
  it("uses the selected archetype core with canonical quality and completion levels", () => {
    const strategy = openStrategy(fixture(), { archetype: "product-saas" });
    expect(strategy.status().counts.total).toBe(27);
    expect(strategy.status().cells.find(cell => cell.id === id)?.active).toBe(false);
    expect(strategy.status().cells.find(cell => cell.id === id)?.findings.some(f => f.rule === "Q7")).toBe(true);
    expect(strategy.status().l0Clean).toBe(false);
    expect(strategy.status({ scope: "full" }).counts.total).toBe(57);
    expect(() => openStrategy(fixture(), { archetype: "unknown" })).toThrow(/archetype/i);
  });
  it("keeps persisted custom core selection when an archetype is overridden", () => {
    const root = fixture();
    const core = [...loadCatalog().archetypes.default, "context.market.size"];
    put(root, "tree.json", JSON.stringify({ schemaVersion: 1, catalog: "@clossys/strategist#strategy-v1", archetype: "default", core, active: { [id]: 1 } }));
    expect(readStrategyRoot(root).issues).toEqual([]);
    expect(openStrategy(root, { archetype: "product-saas" }).status().cells.map(cell => cell.id)).toEqual(core);
  });
  it("does not silently accept invalid or conflicting explicit contracts", () => {
    const root = fixture();
    expect(() => openStrategy(root, { contracts: [{ ...contract, requires: ["unknown.cell.id"] }] })).toThrow(/contract/i);
    expect(() => openStrategy(root, { contracts: [contract, { ...contract, requires: [] }] })).toThrow(/conflict/i);
    expect(() => openStrategy(root).getBrief("../outside")).toThrow(/unknown.*contract/i);
  });
});
