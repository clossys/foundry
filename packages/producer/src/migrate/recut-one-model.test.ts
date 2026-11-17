/**
 * foundry-build-0038 (G1): one slot model. After `clossys migrate recut --apply` every slot.json is `clossys.slot/2`,
 * and the readers that judge slot shape read that format: the constitution's R01.2 and R01.8, and the slot writes
 * behind `clossys options` and the not-needed decision. Synthetic: a tmp copy of test-fixtures/consumer, recut in tmp.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runConstitution } from "../constitution/run.js";
import { NO_HISTORY } from "../constitution/__fixtures__/workspace.js";
import { PRODUCER_ROOT } from "../package-path.js";
import { SLOT_SCHEMA, serializeSlot, validateSlot } from "../records/slot.js";
import { readSlot } from "../records/slots.js";
import type { Slot } from "../records/types.js";
import { writeNotNeeded, writeSlotOptions } from "../records/slot-write.js";
import { applyRecut, planRecut, RECUT_AGENTS } from "./recut.js";

const AT = "2026-11-15T10:00:00Z";
let root: string | undefined;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = undefined; });

/** A recut copy of test-fixtures/consumer. */
function recut() {
  root = mkdtempSync(join(tmpdir(), "recut-one-model-"));
  cpSync(join(PRODUCER_ROOT, "test-fixtures", "consumer", "clossys"), join(root, "clossys"), { recursive: true });
  applyRecut(planRecut(root, { at: AT }));
  const consumer = join(root, "clossys");
  const file = (agent: string, id: string) => join(consumer, "agents", agent, id, "slot.json");
  const read = (agent: string, id: string) => JSON.parse(readFileSync(file(agent, id), "utf8")) as Slot;
  const write = (agent: string, id: string, slot: unknown) => writeFileSync(file(agent, id), `${JSON.stringify(slot, null, 2)}\n`);
  /** Every recut slot.json, by agent. */
  const slots = (agent: string) => readdirSync(join(consumer, "agents", agent)).filter(id => existsSync(file(agent, id)));
  return { root, consumer, file, read, write, slots };
}

const rowsOf = (w: ReturnType<typeof recut>, check: string) => runConstitution({ root: w.root, consumer: w.consumer, rule: "R01", history: () => NO_HISTORY })
  .rows.filter(row => row.check === check);
const perSlot = (rows: readonly { slot: string }[]) => rows.filter(row => row.slot !== "*");

describe("recut, then the constitution: slot shape is green on clossys.slot/2", () => {
  it("leaves every slot.json in the current format and raises no R01.2 or per-slot R01.8 row", () => {
    const w = recut();
    let current = 0;
    for (const agent of RECUT_AGENTS) for (const id of w.slots(agent)) {
      const doc = w.read(agent, id) as unknown as Record<string, unknown>;
      if (doc.schema === SLOT_SCHEMA) current++;
    }
    expect(current).toBeGreaterThan(100);
    expect(rowsOf(w, "R01.2").map(row => `${row.agent}/${row.slot}: ${row.reason}`)).toEqual([]);
    expect(perSlot(rowsOf(w, "R01.8")).map(row => `${row.agent}/${row.slot}: ${row.reason}`)).toEqual([]);
  });

  // Mutation: the R01.2 slot/2 branch still judges shape, kind and contract (nothing is waved through).
  it("flags a slot/2 file with an unknown key, a kind its agent does not hold, or a foreign id", () => {
    const w = recut();
    const [designer] = w.slots("designer"), [writer] = w.slots("writer"), [director] = w.slots("director");
    w.write("designer", designer!, { ...w.read("designer", designer!), extension: {} });
    w.write("writer", writer!, { ...w.read("writer", writer!), kind: "page" });
    w.write("director", director!, { ...w.read("director", director!), id: "context.market.elsewhere" });
    const text = rowsOf(w, "R01.2").map(row => `${row.agent}/${row.slot}: ${row.reason}`).join("\n");
    expect(text).toContain(`designer/${designer}: slot.json is invalid:`);
    expect(text).toMatch(/extension/);
    expect(text).toContain(`kind page is not one of writer's kinds`);
    expect(text).toContain(`director/${director}: slot.json is invalid: `);
    expect(text).toMatch(/id must be [a-z.-]+, the folder and IA id/);
  });

  // Mutation: R01.8 compares a slot/2 ia with the slash paths of its ia.json placement.
  it("flags a slot/2 ia that is not where ia.json places the leaf, and the dotted slot/1 form of the right place", () => {
    const w = recut();
    const [moved, dotted] = w.slots("designer");
    const slot = w.read("designer", moved!);
    w.write("designer", moved!, { ...slot, ia: { ...slot.ia, l2: `${slot.ia.l1}/elsewhere` } });
    const other = w.read("designer", dotted!);
    w.write("designer", dotted!, { ...other, ia: { ...other.ia, l1: other.ia.l1.split("/").slice(1).join(".") } });
    const rows = perSlot(rowsOf(w, "R01.8"));
    expect(rows.map(row => row.slot).sort()).toEqual([moved, dotted].sort());
    expect(rows.find(row => row.slot === moved)!.reason).toMatch(/slot\.json ia is .*\/elsewhere, but ia\.json places the leaf at /);
  });
});

describe("slot writes on clossys.slot/2 (options, not-needed)", () => {
  const consumerAdded = (w: ReturnType<typeof recut>) => {
    for (const agent of ["director", "writer", "designer"] as const) for (const id of w.slots(agent)) {
      const slot = w.read(agent, id);
      if (slot.schema === SLOT_SCHEMA && slot.base === null) return { agent, id };
    }
    throw new Error("the recut fixture has no consumer-added slot/2");
  };

  it("writeSlotOptions writes options and varyOn into the slot/2 file, which stays valid, and reads back", () => {
    const w = recut();
    const { agent, id } = consumerAdded(w);
    expect(writeSlotOptions(w.consumer, agent, id, { options: 3, varyOn: "angle", at: "2026-11-16T00:00:00Z" })).toBe(true);
    const after = w.read(agent, id);
    expect(after).toMatchObject({ schema: SLOT_SCHEMA, options: 3, varyOn: "angle", updatedAt: "2026-11-16T00:00:00Z" });
    expect(validateSlot(after)).toEqual([]);
    expect(readFileSync(w.file(agent, id), "utf8")).toBe(serializeSlot(after));
    expect(readSlot(w.consumer, agent, id)).toMatchObject({ options: 3, varyOn: "angle" });
    // Same class again: nothing to write.
    expect(writeSlotOptions(w.consumer, agent, id, { options: 3, varyOn: "angle", at: "2026-11-16T01:00:00Z" })).toBe(false);
    expect(writeSlotOptions(w.consumer, agent, id, { options: 1, at: "2026-11-16T02:00:00Z" })).toBe(true);
    expect(w.read(agent, id)).not.toHaveProperty("options");
  });

  it("writeNotNeeded parks the slot/2 file with contract.notNeeded, and the reader sees the marker", () => {
    const w = recut();
    const { agent, id } = consumerAdded(w);
    const marker = { reason: "covered elsewhere", since: "2026-11-16", decidedBy: "owner" };
    writeNotNeeded(w.consumer, agent, id, marker, { at: "2026-11-16T00:00:00Z" });
    const after = w.read(agent, id);
    expect(after).toMatchObject({ schema: SLOT_SCHEMA, status: "parked", contract: { notNeeded: marker } });
    expect(validateSlot(after)).toEqual([]);
    expect(readSlot(w.consumer, agent, id).notNeeded).toEqual(marker);
  });

  it("refuses to write a computed field into a slot synced from a package base", () => {
    const w = recut();
    let synced: { agent: "director" | "writer" | "designer"; id: string } | undefined;
    for (const agent of ["director", "writer", "designer"] as const) for (const id of w.slots(agent)) if (!synced && w.read(agent, id).base !== null) synced = { agent, id };
    if (!synced) return; // the fixture syncs no slot from a package base
    const before = readFileSync(w.file(synced.agent, synced.id), "utf8");
    expect(() => writeSlotOptions(w.consumer, synced!.agent, synced!.id, { options: 2, varyOn: "tone" })).toThrow(/synced from @clossys\//);
    expect(readFileSync(w.file(synced.agent, synced.id), "utf8")).toBe(before);
  });
});
