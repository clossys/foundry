/**
 * The int2 library tree to slot candidates (`clossys migrate recut` step 3), on a tmp copy of
 * test-fixtures/consumer-legacy-tree. Cells are built in tmp from a package default candidate (shape only, no new text).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PRODUCER_ROOT } from "../package-path.js";
import { readRecordHeader } from "../records/schema.js";
import { listLibraryCells, planLibraryCells, removeLibraryCell } from "./library-cells.js";
import { RECUT_CLI, applyRecut, planRecut, recutCandidateBytes } from "./recut.js";

const AT = "2026-11-15T10:00:00Z";
const FRONT = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
const body = () => readFileSync(join(PRODUCER_ROOT, "..", "director", "src", "catalog", "defaults", "advantage.proposition.promise", "template-v1.md"), "utf8").replace(FRONT, "");

let root: string | undefined;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = undefined; });

function consumerWith(cells: Record<string, Record<string, string>>): { root: string; consumer: string } {
  root = mkdtempSync(join(tmpdir(), "library-cells-"));
  cpSync(join(PRODUCER_ROOT, "test-fixtures", "consumer-legacy-tree", "clossys"), join(root, "clossys"), { recursive: true });
  const consumer = join(root, "clossys");
  for (const [dir, files] of Object.entries(cells)) {
    mkdirSync(join(consumer, "library", dir), { recursive: true });
    for (const [name, bytes] of Object.entries(files)) writeFileSync(join(consumer, "library", dir, name), bytes);
  }
  return { root, consumer };
}

const cellFiles = () => ({ "cell.md": body(), "element.json": "{}\n", "preview.json": "{}\n" });
const convert = (input: { agent: "director" | "designer" | "writer" | "publisher" | "producer"; slotId: string; name: string; body: string; sourceRef: string }) =>
  recutCandidateBytes(input.name, input.body, { agent: input.agent, slotId: input.slotId, at: AT, version: "0.0.0", sourceRef: input.sourceRef });

describe("library cells", () => {
  it("lists each version folder as one cell", () => {
    const { consumer } = consumerWith({ "passages.hero/hero/v1": cellFiles(), "passages.hero/hero/v3": cellFiles(), "sections.hero/hero/v1": cellFiles() });
    expect(listLibraryCells(consumer).map(cell => `${cell.slot}/${cell.name}/v${cell.version}`)).toEqual(["passages.hero/hero/v1", "passages.hero/hero/v3", "sections.hero/hero/v1"]);
  });

  it("turns a cell into one <name>-v<n>.md candidate whose body is cell.md, and drops preview.json", () => {
    const { consumer } = consumerWith({ "passages.hero/hero/v2": cellFiles() });
    const dir = join(consumer, "agents", "writer", "sections.hero.copy");
    const plan = planLibraryCells(consumer, () => ({ agent: "writer", slotId: "sections.hero.copy", dir, record: true }), convert);
    expect(plan.findings).toEqual([]);
    expect(plan.conversions).toHaveLength(1);
    const [conversion] = plan.conversions;
    expect(conversion!.file).toBe(join(dir, "candidates", "hero-v2.md"));
    expect(conversion!.bytes.replace(FRONT, "")).toBe(body());
    expect(readRecordHeader("hero-v2.md", conversion!.bytes)).toMatchObject({ id: "writer/sections.hero.copy/hero-v2.md", createdBy: { actor: "code", cli: RECUT_CLI }, source: { kind: "derived", ref: ["library/passages.hero/hero/v2"] } });
    removeLibraryCell(consumer, conversion!.cell);
    expect(existsSync(join(consumer, "library"))).toBe(false);
  });

  it("leaves a cell with another file, no cell.md, or a taken name in place, as a finding", () => {
    const { consumer } = consumerWith({
      "passages.hero/extra/v1": { ...cellFiles(), "source.tsx": body() },
      "passages.hero/bare/v1": { "element.json": "{}\n", "preview.json": "{}\n" },
      "passages.hero/hero/v1": cellFiles(),
    });
    const dir = join(consumer, "agents", "writer", "sections.hero.copy");
    const taken = new Set([join(dir, "candidates", "hero-v1.md")]);
    const plan = planLibraryCells(consumer, () => ({ agent: "writer", slotId: "sections.hero.copy", dir, record: true }), convert, taken);
    expect(plan.conversions).toEqual([]);
    expect(plan.findings).toEqual([
      "library/passages.hero/bare/v1: no cell.md; left in place",
      "library/passages.hero/extra/v1: holds source.tsx, not only cell.md, element.json, preview.json; left in place",
      "library/passages.hero/hero/v1: writer/sections.hero.copy/candidates/hero-v1.md already exists; left in place",
    ]);
  });

  it("routes a cell through the recut: a moved slot's cell lands in the target, a retired slot's in its retired folder", () => {
    const { root: dir, consumer } = consumerWith({ "passages.hero/hero/v1": cellFiles(), "components.chart-heatmap/heatmap/v1": cellFiles(), "nowhere.at-all/x/v1": cellFiles() });
    const plan = planRecut(dir, { at: AT });
    expect(plan.library.findings).toEqual(["library/nowhere.at-all/x/v1: slot nowhere.at-all is in no package tree and no retired.json"]);
    // An unknown library slot is an unknown id: the plan refuses whole and nothing is written.
    expect(plan.unknown).toContain("library/nowhere.at-all");
    expect(() => applyRecut(plan)).toThrow(/library\/nowhere\.at-all/);
    expect(existsSync(join(consumer, "library", "passages.hero", "hero", "v1", "cell.md"))).toBe(true);
    rmSync(join(consumer, "library", "nowhere.at-all"), { recursive: true });
    applyRecut(planRecut(dir, { at: AT }));
    expect(readFileSync(join(consumer, "agents", "writer", "sections.hero.copy", "candidates", "hero-v1.md"), "utf8").replace(FRONT, "")).toBe(body());
    expect(existsSync(join(consumer, "agents", "designer", "_retired", "components.chart-heatmap", "candidates", "heatmap-v1.md"))).toBe(true);
    expect(existsSync(join(consumer, "library", "passages.hero"))).toBe(false);
  });
});
