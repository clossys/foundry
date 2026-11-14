import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jsonBytes } from "../records/slot-model/layout.js";
import { validateSlotDoc } from "../records/slot-model/validate.js";
import { listSeats, readSeatText, seatStates } from "../records/slots.js";
import { planSeatsToSlots, runSeatsToSlots, SAMPLE_SEAT } from "./seats-to-slots.js";

let consumer: string;
const producer = () => join(consumer, "agents", "producer");
const SEAT = { by: "planner", llm: null, human: { procedure: "pick one", command: "clossys pin designer" } };

function oldSeat(step: string, value: unknown | undefined) {
  mkdirSync(join(producer(), step, "candidates"), { recursive: true });
  if (value === undefined) return;
  const bytes = jsonBytes(value), name = `${step}-v1.json`;
  writeFileSync(join(producer(), step, "candidates", name), bytes);
  writeFileSync(join(producer(), step, "pin.json"), jsonBytes({ candidate: name, sha256: createHash("sha256").update(bytes).digest("hex"), decidedBy: "owner", basis: "picked", at: "2026-11-11T00:00:00.000Z" }));
}

beforeEach(() => {
  consumer = mkdtempSync(join(tmpdir(), "seats-to-slots-"));
  mkdirSync(producer(), { recursive: true });
  writeFileSync(join(producer(), "ia.json"), jsonBytes({
    schema: "clossys.ia/1", source: "@clossys/producer#steps", extensions: [],
    nodes: [{ id: "design", label: "Design", children: [{ id: "design.pin", label: "Pin", slots: ["pin.designer", "pick.designer"] }] }],
  }));
  oldSeat("pin.designer", SEAT);
  oldSeat("pick.designer", undefined);
});
afterEach(() => rmSync(consumer, { recursive: true, force: true }));

describe("migrate seats-to-slots", () => {
  it("moves each placed seat to seat.<step>, writes its slot.json and renames the IA ids, idempotently", () => {
    expect(() => listSeats(consumer)).toThrow(/Invalid producer IA/);
    expect(runSeatsToSlots(consumer, { check: true }).exitCode).toBe(1);
    expect(runSeatsToSlots(consumer)).toEqual({ exitCode: 0, message: "seats-to-slots: moved 2 folder(s), wrote 2 slot.json, ia.json rewritten" });
    expect(existsSync(join(producer(), "pin.designer"))).toBe(false);
    const doc = JSON.parse(readFileSync(join(producer(), "seat.pin.designer", "slot.json"), "utf8"));
    expect(validateSlotDoc(doc)).toEqual([]);
    expect(doc).toMatchObject({ id: "seat.pin.designer", agent: "producer", kind: "seat", ia: { l1: "design", l2: "design.pin", order: 0 }, contract: { step: "pin.designer", fixture: { step: "pin.designer", seat: SEAT } } });
    expect(JSON.parse(readFileSync(join(producer(), "seat.pick.designer", "slot.json"), "utf8")).contract.fixture.seat).toEqual(SAMPLE_SEAT);
    expect(seatStates(consumer)).toEqual([{ id: "seat.pin.designer", step: "pin.designer", state: "pinned" }, { id: "seat.pick.designer", step: "pick.designer", state: "open" }]);
    expect(JSON.parse(readSeatText(consumer, "pin.designer")!)).toEqual(SEAT);
    expect(runSeatsToSlots(consumer, { check: true })).toEqual({ exitCode: 0, message: "seats-to-slots: current" });
    expect(runSeatsToSlots(consumer).message).toBe("seats-to-slots: current");
  });

  it("refuses an unplaced seat folder and a move onto an existing folder, writing nothing", () => {
    mkdirSync(join(producer(), "stray"));
    mkdirSync(join(producer(), "seat.pin.designer"));
    const plan = planSeatsToSlots(consumer);
    expect(plan.findings).toEqual([
      "agents/producer/stray is not a seat producer ia.json places; left as it is",
      "agents/producer/pin.designer and agents/producer/seat.pin.designer both exist; resolve by hand",
    ]);
    expect(runSeatsToSlots(consumer).exitCode).toBe(1);
    expect(existsSync(join(producer(), "pin.designer", "pin.json"))).toBe(true);
    expect(existsSync(join(producer(), "seat.pick.designer"))).toBe(false);
  });
});
