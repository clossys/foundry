/**
 * foundry-build-0038 (G1): one slot model. After `clossys migrate recut --apply` every slot.json is `clossys.slot/2`,
 * and the readers that judge slot shape read that format: the constitution's R01.2 and R01.8, and the slot writes
 * behind `clossys options` and the not-needed decision. Synthetic: a tmp copy of test-fixtures/consumer-int2, recut in tmp.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../cli/main.js";
import { runConstitution } from "../constitution/run.js";
import { NO_HISTORY } from "../constitution/__fixtures__/workspace.js";
import { PRODUCER_ROOT } from "../package-path.js";
import { SLOT_SCHEMA, serializeSlot, validateSlot } from "../records/slot.js";
import { readSlot } from "../records/slots.js";
import type { Slot } from "../records/types.js";
import { writeNotNeeded, writeSlotOptions } from "../records/slot-write.js";
import { applyRecut, planRecut } from "./recut.js";

const AT = "2026-11-15T10:00:00Z";
let root: string | undefined;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = undefined; });

/** A recut copy of test-fixtures/consumer-int2. */
function recut() {
  root = mkdtempSync(join(tmpdir(), "recut-one-model-"));
  cpSync(join(PRODUCER_ROOT, "test-fixtures", "consumer-int2", "clossys"), join(root, "clossys"), { recursive: true });
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
/** The rows about a slot.json that exists and is clossys.slot/2 (an IA leaf with no folder is the separate ia-gap reading). */
const onCurrentFiles = <T extends { agent: string; slot: string }>(w: ReturnType<typeof recut>, rows: readonly T[]): T[] =>
  rows.filter(row => row.slot !== "*" && existsSync(w.file(row.agent, row.slot)) && (w.read(row.agent, row.slot) as unknown as { schema?: unknown }).schema === SLOT_SCHEMA);

describe("recut, then the constitution: slot shape is green on clossys.slot/2", () => {
  it("leaves every Director, Designer and Writer slot.json in the current format and raises no R01.2 or R01.8 row on one", () => {
    const w = recut();
    let current = 0, old = 0;
    for (const agent of ["director", "designer", "writer"] as const) for (const id of w.slots(agent)) {
      if ((w.read(agent, id) as unknown as Record<string, unknown>).schema === SLOT_SCHEMA) current++; else old++;
    }
    expect(current).toBeGreaterThan(100);
    expect(old).toBe(0);
    const shape = rowsOf(w, "R01.2");
    expect(onCurrentFiles(w, shape).map(row => `${row.agent}/${row.slot}: ${row.reason}`)).toEqual([]);
    // What R01.2 still reports is the IA-gap reading only: a leaf ia.json lists with no slot folder.
    expect(shape.filter(row => row.reason !== "live slot has no folder")).toEqual([]);
    expect(onCurrentFiles(w, rowsOf(w, "R01.8")).map(row => `${row.agent}/${row.slot}: ${row.reason}`)).toEqual([]);
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
    const rows = perSlot(rowsOf(w, "R01.8")).filter(row => row.agent === "designer");
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
    expect(writeSlotOptions(w.consumer, agent, id, { options: 2, varyOn: "tone", at: "2026-11-16T00:00:00Z" })).toBe(true);
    const after = w.read(agent, id);
    expect(after).toMatchObject({ schema: SLOT_SCHEMA, options: 2, varyOn: "tone", updatedAt: "2026-11-16T00:00:00Z" });
    expect(validateSlot(after)).toEqual([]);
    expect(readFileSync(w.file(agent, id), "utf8")).toBe(serializeSlot(after));
    expect(readSlot(w.consumer, agent, id)).toMatchObject({ options: 2, varyOn: "tone" });
    // Same class again: nothing to write.
    expect(writeSlotOptions(w.consumer, agent, id, { options: 2, varyOn: "tone", at: "2026-11-16T01:00:00Z" })).toBe(false);
    expect(writeSlotOptions(w.consumer, agent, id, { options: 1, at: "2026-11-16T02:00:00Z" })).toBe(true);
    expect(w.read(agent, id)).not.toHaveProperty("options");
    expect(w.read(agent, id)).not.toHaveProperty("varyOn");
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

  // Mutation: the slot/1 options rules hold on slot/2 too (slotReadIssues), for the writer and for the checks.
  it("refuses options 2 with no varyOn, and a varyOn that is not an axis id, on a recut slot", () => {
    const w = recut();
    const { agent, id } = consumerAdded(w);
    const before = readFileSync(w.file(agent, id), "utf8");
    expect(() => writeSlotOptions(w.consumer, agent, id, { options: 2, at: "2026-11-16T00:00:00Z" })).toThrow(/options refused: .*varyOn is required when options > 1/);
    expect(() => writeSlotOptions(w.consumer, agent, id, { options: 3, varyOn: "Not An Axis!", at: "2026-11-16T00:00:00Z" })).toThrow(/options refused: .*varyOn must be an axis id/);
    expect(readFileSync(w.file(agent, id), "utf8")).toBe(before);
  });

  it("flags a hand-set options 2 with no varyOn in clossys check and in R01.2", async () => {
    const w = recut();
    const { agent, id } = consumerAdded(w);
    const baseline = await runCli(["check", "--root", w.root]);
    expect(baseline.message).not.toMatch(/varyOn is required/);
    const { varyOn: dropped, ...slot } = w.read(agent, id) as unknown as Record<string, unknown>;
    expect(dropped).toBeDefined();
    w.write(agent, id, { ...slot, options: 2 });
    const check = await runCli(["check", "--root", w.root]);
    // An invalid slot.json fails the slot model inputs closed (exit 2), and the row names the file and the rule.
    expect(check.exitCode).toBe(2);
    expect(check.message).toMatch(new RegExp(`${agent}/${id}[^\n]*varyOn is required when options > 1`));
    expect(rowsOf(w, "R01.2").filter(row => row.agent === agent && row.slot === id).map(row => row.reason)).toEqual([expect.stringMatching(/^slot\.json is invalid: .*varyOn is required when options > 1/)]);
  });

  // Mutation: the slot/1 contract semantics hold on slot/2 too (slotReadIssues): a clossys.slot-contract/1 names its own slot, a fixture has its kind's shape.
  it("flags a slot/2 contract that names another slot, and a brief fixture with no headings, in R01.2", () => {
    const w = recut();
    const section = "sections.producer.team-strip", brief = "advantage.defensibility.moat";
    const sectionSlot = w.read("designer", section) as unknown as Record<string, unknown> & { contract: Record<string, unknown> };
    const briefSlot = w.read("director", brief) as unknown as Record<string, unknown> & { contract: Record<string, unknown> };
    expect(sectionSlot.contract).toMatchObject({ schema: "clossys.slot-contract/1", slot: section });
    expect(briefSlot.contract.fixture).toMatchObject({ headings: expect.any(Array) });
    const before = rowsOf(w, "R01.2").filter(row => (row.agent === "designer" && row.slot === section) || (row.agent === "director" && row.slot === brief));
    expect(before.map(row => row.reason).join("\n")).not.toMatch(/contract\.slot must be|contract\.fixture headings/);
    w.write("designer", section, { ...sectionSlot, contract: { ...sectionSlot.contract, slot: "sections.producer.elsewhere" } });
    w.write("director", brief, { ...briefSlot, contract: { ...briefSlot.contract, fixture: { headings: [] } } });
    const text = rowsOf(w, "R01.2").map(row => `${row.agent}/${row.slot}: ${row.reason}`).join("\n");
    expect(text).toMatch(new RegExp(`designer/${section}: slot\\.json is invalid: [^\\n]*contract\\.slot must be ${section}, the slot's own id`));
    expect(text).toMatch(new RegExp(`director/${brief}: slot\\.json is invalid: [^\\n]*contract\\.fixture headings must be a non-empty list of strings`));
  });

  it("refuses to write a computed field into a slot synced from a package base", () => {
    const w = recut();
    const { agent, id } = consumerAdded(w);
    // The recut fixture adds every slot itself, so one is marked as synced from its package base here.
    w.write(agent, id, { ...w.read(agent, id), base: { package: `@clossys/${agent}`, version: "0.0.0", path: `src/catalog/slots/${id}/slot.json`, sha256: "0".repeat(64) } });
    const before = readFileSync(w.file(agent, id), "utf8");
    expect(() => writeSlotOptions(w.consumer, agent, id, { options: 2, varyOn: "tone" })).toThrow(/synced from @clossys\//);
    expect(readFileSync(w.file(agent, id), "utf8")).toBe(before);
  });
});
