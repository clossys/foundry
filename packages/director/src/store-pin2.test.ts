import { reader } from "../test/store.js";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stagePassingSlot, strategyRoot } from "./__fixtures__/slot-model.js";
import { parseSlotPin } from "./format/slot.js";
import { readStrategyRoot, type StrategyModel } from "./store.js";

/**
 * After a recut, `clossys pin director/<id>` writes `clossys.pin/2` and the recut migrates every pin/1 to it
 * (@clossys/producer records/pin.ts buildPin). Director's store must read both; pin/1 validation is unchanged.
 */
const bases: string[] = [];
afterEach(() => { bases.splice(0).forEach(base => rmSync(base, { recursive: true, force: true })); });

const UPSTREAM = "context.customer.need";
const DOWNSTREAM = "focus.segment.core";

function consumer(): string {
  const base = mkdtempSync(join(tmpdir(), "director-pin2-")); bases.push(base);
  const root = strategyRoot(base);
  stagePassingSlot(root, UPSTREAM);
  stagePassingSlot(root, DOWNSTREAM, 1, { refs: [`${UPSTREAM}@1`] });
  return root;
}

/** The pin/2 document `clossys pin` writes for a pin/1 record (COMMON block + the same record). */
function pin2(slot: string, pin1: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "clossys.pin/2", id: `director/${slot}/pin`, agent: "director", kind: "pin", status: "pinned",
    createdBy: { actor: "code", cli: "clossys pin", version: "1.0.0" },
    createdAt: pin1.at, updatedAt: pin1.at,
    refs: [{ to: "producer/queue.pick", record: "20261116T0930Z-fixture", rel: "answers" }],
    ...pin1, decidedBy: "owner:queue.pick#20261116T0930Z-fixture", ...extra,
  };
}
const readPin = (root: string, slot: string) => JSON.parse(readFileSync(join(root, slot, "pin.json"), "utf8")) as Record<string, unknown>;
const writePin = (root: string, slot: string, value: unknown) => writeFileSync(join(root, slot, "pin.json"), `${JSON.stringify(value, null, 2)}\n`);

/** What `clossys director check direction` needs from the store: a full read, pinned cells, every cell citation resolved to a pinned slot. */
function directionReady(model: StrategyModel): string[] {
  const pinned = new Set(model.cells.filter(cell => cell.status === "active").map(cell => cell.id));
  const problems = model.issues.map(issue => `${issue.path}: ${issue.message}`);
  if (!model.cells.length) problems.push("no pinned Director cell");
  for (const cell of model.cells) for (const ref of cell.cites) if (ref.kind === "cell" && !pinned.has(ref.ref.cell)) problems.push(`${cell.id} cites unpinned ${ref.ref.cell}`);
  return problems;
}

describe("Director store reads clossys.pin/2", () => {
  it("reads every pin/2 pin as `clossys pin` writes it, and the direction check has nothing blocking", () => {
    const root = consumer();
    for (const slot of [UPSTREAM, DOWNSTREAM]) writePin(root, slot, pin2(slot, readPin(root, slot)));
    const model = readStrategyRoot(root, reader);
    expect(model.issues).toEqual([]);
    expect(directionReady(model)).toEqual([]);
    expect(model.cells.find(cell => cell.id === UPSTREAM)).toMatchObject({ status: "active", version: 1, pin: { decidedBy: "owner:queue.pick#20261116T0930Z-fixture", basis: "picked" } });
    expect(model.cells.find(cell => cell.id === DOWNSTREAM)?.cites).toContainEqual({ kind: "cell", ref: { cell: UPSTREAM, version: 1 } });
  });

  it("reads a mixed root: one pin/2 and one pin/1", () => {
    const root = consumer();
    writePin(root, UPSTREAM, pin2(UPSTREAM, readPin(root, UPSTREAM)));
    const model = readStrategyRoot(root, reader);
    expect(directionReady(model)).toEqual([]);
    for (const slot of [UPSTREAM, DOWNSTREAM]) expect(model.cells.find(cell => cell.id === slot)?.status).toBe("active");
  });

  it("still reads pin/1 and keeps its validation: a pin/1 with a foreign schema key is refused", () => {
    const root = consumer();
    expect(directionReady(readStrategyRoot(root, reader))).toEqual([]);
    writePin(root, UPSTREAM, { ...readPin(root, UPSTREAM), schema: "clossys.pin/1" });
    const model = readStrategyRoot(root, reader);
    expect(model.issues).toEqual([expect.objectContaining({ path: `${UPSTREAM}/pin.json`, reason: "invalid-format", message: expect.stringContaining("unknown key schema") })]);
    expect(model.cells.some(cell => cell.id === UPSTREAM)).toBe(false);
  });

  it("refuses a malformed pin/2", () => {
    const root = consumer();
    const pin1 = readPin(root, UPSTREAM);
    const malformed: [Record<string, unknown>, string][] = [
      [pin2(UPSTREAM, pin1, { surprise: true }), "unknown key surprise"],
      [pin2(UPSTREAM, pin1, { id: `director/${DOWNSTREAM}/pin` }), `id director/${DOWNSTREAM}/pin is not director/${UPSTREAM}/pin`],
      [pin2(UPSTREAM, pin1, { agent: "writer", id: `writer/${UPSTREAM}/pin` }), `agent writer is not director`],
      [pin2(UPSTREAM, pin1, { kind: "candidate" }), "kind must be pin"],
      [pin2(UPSTREAM, pin1, { createdBy: { actor: "code", cli: "clossys pin" } }), "createdBy.version"],
      [pin2(UPSTREAM, pin1, { refs: [{ to: "nowhere", rel: "answers" }] }), "refs[0].to"],
      [pin2(UPSTREAM, pin1, { sha256: "not-a-hash" }), "sha256 must be 64 lowercase hex"],
      [pin2(UPSTREAM, pin1, { at: "2026-10-29" }), "at must be an ISO timestamp"],
      [Object.fromEntries(Object.entries(pin2(UPSTREAM, pin1)).filter(([key]) => key !== "refs")), "missing key refs"],
    ];
    for (const [value, message] of malformed) {
      writePin(root, UPSTREAM, value);
      const model = readStrategyRoot(root, reader);
      expect(model.issues, message).toEqual([expect.objectContaining({ path: `${UPSTREAM}/pin.json`, reason: "invalid-format", message: expect.stringContaining(message) })]);
      expect(model.cells.some(cell => cell.id === UPSTREAM), message).toBe(false);
    }
  });

  it("parseSlotPin returns the pin/2 record without its COMMON block", () => {
    const record = { candidate: "fixture-v1.md", sha256: "a".repeat(64), decidedBy: "owner:x", basis: "picked", at: "2026-10-29T00:00:00Z" };
    expect(parseSlotPin(pin2(UPSTREAM, record), UPSTREAM)).toEqual({ ok: true, value: { ...record, decidedBy: "owner:queue.pick#20261116T0930Z-fixture" } });
    expect(parseSlotPin(pin2(UPSTREAM, record), DOWNSTREAM)).toMatchObject({ ok: false });
  });
});
