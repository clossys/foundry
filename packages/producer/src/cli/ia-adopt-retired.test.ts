import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadBuildCatalog, type PlacementNode } from "@clossys/designer/catalog";
import { resolveAgent } from "../agents.js";
import { designerRetired } from "../records/slot-model/foundry-ia.js";
import { runCli } from "./main.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const tempDir = (prefix: string) => { const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix))); dirs.push(dir); return dir; };

/** The ids Designer's retired.json lists, read straight from the installed package, not through the IA reader. */
function retiredIds(): string[] {
  const rows = JSON.parse(readFileSync(join(resolveAgent("designer").packageRoot, "src", "catalog", "retired.json"), "utf8")) as { id: string }[];
  return rows.map(row => row.id);
}

/** Every leaf the Designer build catalog places, retired ones included (the catalog keeps them placed). */
function catalogLeaves(): Set<string> {
  const leaves = (node: PlacementNode): readonly string[] => ("leaves" in node ? node.leaves : node.children.flatMap(leaves));
  return new Set(loadBuildCatalog().placements.flatMap(placement => placement.nodes.flatMap(leaves)));
}

describe("clossys ia designer --adopt on a fresh workspace", () => {
  it("places no retired Designer leaf, the way migrate recut skips them, and still places the live ones", async () => {
    const root = tempDir("ia-adopt-retired-");
    const at = ["--root", root], designer = join(root, "clossys", "agents", "designer");
    expect((await runCli(["config", "--init", ...at], root)).exitCode).toBe(0);
    expect((await runCli(["ia", "director", "--adopt", ...at], root)).exitCode).toBe(0);
    const adopt = await runCli(["ia", "designer", "--adopt", ...at], root);
    expect(adopt.exitCode, adopt.message).toBe(0);
    // Not vacuous: the catalog still places retired leaves, so only the adopt filter keeps them out.
    const retired = retiredIds().filter(id => catalogLeaves().has(id));
    expect(retired.length).toBeGreaterThan(0);
    expect(retired).toContain("sections.cards");
    const ia = JSON.parse(readFileSync(join(designer, "ia.json"), "utf8")) as { nodes: { children: { slots: string[] }[] }[] };
    const placed = new Set(ia.nodes.flatMap(node => node.children.flatMap(child => child.slots)));
    expect(retired.filter(id => placed.has(id))).toEqual([]);
    expect(retired.filter(id => existsSync(join(designer, id)))).toEqual([]);
    expect(placed.has("sections.features")).toBe(true);
    expect(existsSync(join(designer, "sections.features", "slot.json"))).toBe(true);
  }, 120_000);

  it("refuses a Designer retired.json that is not an array instead of reading it as no retired leaves", () => {
    const root = tempDir("ia-retired-shape-");
    expect(designerRetired(root)).toEqual(new Set());
    const file = join(root, "src", "catalog", "retired.json");
    mkdirSync(join(root, "src", "catalog"), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ id: "sections.cards" })}\n`);
    expect(() => designerRetired(root)).toThrow(/is not an array of retired leaves/);
    writeFileSync(file, `${JSON.stringify([{ id: "sections.cards" }, { note: "no id" }])}\n`);
    expect([...designerRetired(root)]).toEqual(["sections.cards"]);
  });
});
