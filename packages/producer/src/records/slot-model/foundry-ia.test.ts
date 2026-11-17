/**
 * writerIa (foundry-build-0048 U2): Producer places the Writer's Voice, Prose and Copy trees (packages/writer
 * src/catalog/ia/<group>.json) in place of the retired five-layer store. Every count below is derived from those
 * files: a slot row is placed at its tree position, an awaiting leaf is not, and no retired.json id is placed.
 * The fixture consumer is moved to the tree with `clossys migrate recut`: `ia sync` reports no standard drift on it
 * and `--apply` strips no slot.json standard.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAgent } from "../../agents.js";
import { FIXTURE_CONSUMER } from "../../consumer-root.js";
import { WRITER_GROUPS, slotPositions, writerIa } from "./foundry-ia.js";
import { refContext, syncDrift, syncPlan, syncState } from "./ia-sync.js";

const fixture = join(FIXTURE_CONSUMER, "clossys");
const writerRoot = resolveAgent("writer").packageRoot;
const readWriter = (path: string): any => JSON.parse(readFileSync(join(writerRoot, path), "utf8"));
interface TreeFile { nodes: { id: string; children: { id: string; leaves: string[] }[] }[]; slots: { id: string; kind: string }[]; awaiting?: { id: string }[] }
const trees = WRITER_GROUPS.map(group => readWriter(`src/catalog/ia/${group}.json`) as TreeFile);
const rows = trees.flatMap(tree => tree.slots);

describe("writerIa", () => {
  it("places every slot row of the Voice, Prose and Copy tree files, with its tree kind and a standard from the Writer's own defaults", () => {
    const slots = writerIa().slots;
    expect([...slots.keys()].sort()).toEqual(rows.map(row => row.id).sort());
    for (const row of rows) expect(slots.get(row.id)?.targetKind, row.id).toBe(row.kind);
    expect([...slots.values()].filter(slot => typeof slot.defaults.standard !== "string").map(slot => slot.id)).toEqual([]);
  });

  it("places each slot at its tree L1 and L2, never an awaiting leaf or a retired id", () => {
    const foundry = writerIa();
    const positions = slotPositions("writer", foundry.ia);
    for (const tree of trees) for (const l1 of tree.nodes) for (const l2 of l1.children) for (const id of l2.leaves) {
      if (!tree.slots.some(row => row.id === id)) continue;
      expect(positions.get(id), id).toMatchObject({ l1: l1.id.split("/").join("."), l2: l2.id.split("/").pop() });
    }
    const awaiting = trees.flatMap(tree => tree.awaiting ?? []).map(leaf => leaf.id);
    const retired = (readWriter("src/catalog/retired.json") as { id: string }[]).map(row => row.id);
    expect([...awaiting, ...retired].filter(id => foundry.slots.has(id) || positions.has(id))).toEqual([]);
  });

  it("ia sync --check on the fixture: no standard drift, Writer behaviour drift at most the 4 base rows", () => {
    const behaviour = syncDrift(fixture, "writer").filter(finding => finding.kind === "behaviour");
    expect(behaviour.filter(finding => /\bstandard\b/.test(finding.detail)).map(finding => finding.slot)).toEqual([]);
    expect(behaviour.length).toBeLessThanOrEqual(4);
  });

  it("ia sync --apply on the fixture strips no Writer slot.json standard", () => {
    const state = syncState(fixture, "writer");
    const plan = syncPlan(fixture, "writer", refContext(fixture, "writer", state).known, state);
    if ("error" in plan) throw new Error(plan.error);
    const stripped = plan.writes.filter(([file]) => file.endsWith("slot.json") && existsSync(file)).flatMap(([file, bytes]) => {
      const before = JSON.parse(readFileSync(file, "utf8")) as { id: string; standard?: unknown };
      const after = JSON.parse(bytes) as { standard?: unknown };
      return before.standard !== undefined && after.standard !== before.standard ? [before.id] : [];
    });
    expect(stripped).toEqual([]);
  });
});
