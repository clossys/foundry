/**
 * BR-PIPELINE2 round 4 (o1): `ia sync` retires a producer seat whose step the package no longer defines
 * (pipeline/actions.json), the way `clossys retire --slot` retires a slot: it leaves producer ia.json with a
 * clossys.retire/1 `retired` row, and its folder moves whole to agents/producer/_retired/<seat>. Nothing is deleted.
 * A seat whose step the package still defines is never retired: placed but not a package leaf, it stays undeclared
 * and the sync refuses, writing nothing.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// Load the CLI first, as every caller does: owner.ts sits in an import cycle with the pipeline handlers.
import "./main.js";
import { runIaCli } from "./owner.js";
import { FIXTURE_CONSUMER_ROOT } from "../records/slot-model/fixture-consumer.test.js";
import { RETIRED_SEATS_DIR, SYNC_RETIRE_BY, syncState } from "../records/slot-model/ia-sync.js";
import { packageStepIds } from "../records/slot-model/pipeline-seats.js";
import { STATE_DIR } from "../engine/state-dir.js";

const temps: string[] = [];
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function copy(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ia-sync-seat-retire-")));
  temps.push(root);
  cpSync(join(FIXTURE_CONSUMER_ROOT, "clossys"), join(root, "clossys"), { recursive: true, filter: src => src !== join(FIXTURE_CONSUMER_ROOT, STATE_DIR) });
  return root;
}
const producer = (root: string) => join(root, "clossys", "agents", "producer");
const iaFile = (root: string) => join(producer(root), "ia.json");
type Ia = { nodes: { children: { slots: string[] }[] }[]; retired?: Record<string, unknown>[] };
const readIa = (root: string) => JSON.parse(readFileSync(iaFile(root), "utf8")) as Ia;
const placed = (ia: Ia) => ia.nodes.flatMap(node => node.children.flatMap(child => child.slots));
const sync = (root: string) => runIaCli(["sync", "--agent", "producer", "--at", "2026-11-21T00:00:00Z", "--root", root], root);

/** Place `seat` in producer ia.json (first group) with a folder copied from a package seat, as an old store holds it. */
function placeSeat(root: string, seat: string): string {
  const ia = readIa(root);
  const donor = placed(ia)[0]!;
  ia.nodes[0]!.children[0]!.slots.push(seat);
  writeFileSync(iaFile(root), `${JSON.stringify(ia, null, 2)}\n`);
  cpSync(join(producer(root), donor), join(producer(root), seat), { recursive: true });
  return readFileSync(join(producer(root), seat, "slot.json"), "utf8");
}

describe("ia sync retires a producer seat whose step the package no longer defines", { timeout: 120_000 }, () => {
  it("moves the seat folder whole to _retired/ with a retired row, leaves ia.json without it, and a re-run writes nothing", async () => {
    const root = copy();
    // A step id the package does not define (the shared fixture already records seat.writer.approve retired).
    const seat = "seat.gone.probe";
    expect(packageStepIds().has("gone.probe")).toBe(false);
    const slotBytes = placeSeat(root, seat);
    expect(syncState(join(root, "clossys"), "producer")).toMatchObject({ retiring: [seat], undeclared: [] });
    const result = await sync(root);
    expect(result.exitCode, result.message).toBe(0);
    expect(result.message).toContain(`retired ${seat}`);
    const ia = readIa(root);
    expect(placed(ia)).not.toContain(seat);
    expect(ia.retired?.filter(row => row.slot === `producer/${seat}`)).toEqual([{
      schema: "clossys.retire/1", slot: `producer/${seat}`, sha256: createHash("sha256").update(slotBytes).digest("hex"),
      by: SYNC_RETIRE_BY, reason: "not-needed: ia sync, the package defines no step gone.probe", at: "2026-11-21T00:00:00Z",
    }]);
    // Retired, never deleted: the folder and its bytes are kept at the retire place.
    expect(existsSync(join(producer(root), seat))).toBe(false);
    expect(readFileSync(join(producer(root), RETIRED_SEATS_DIR, seat, "slot.json"), "utf8")).toBe(slotBytes);
    const iaBytes = readFileSync(iaFile(root), "utf8");
    const again = await sync(root);
    expect(again.exitCode, again.message).toBe(0);
    expect(again.message).toMatch(/nothing written/);
    expect(readFileSync(iaFile(root), "utf8")).toBe(iaBytes);
  });

  it("never retires a seat whose step the package still defines: it stays undeclared and the sync refuses, writing nothing", async () => {
    const root = copy();
    // `compile` is a plumb step the package defines: it has no package seat, so seat.compile is placed but not packaged.
    const seat = "seat.compile";
    expect(packageStepIds().has("compile")).toBe(true);
    placeSeat(root, seat);
    expect(syncState(join(root, "clossys"), "producer")).toMatchObject({ retiring: [], undeclared: [seat] });
    const before = readFileSync(iaFile(root), "utf8");
    const result = await sync(root);
    expect(result.exitCode).not.toBe(0);
    expect(result.message).toMatch(/neither package leaves nor declared extensions: seat\.compile/);
    expect(readFileSync(iaFile(root), "utf8")).toBe(before);
    expect(existsSync(join(producer(root), seat, "slot.json"))).toBe(true);
    expect(existsSync(join(producer(root), RETIRED_SEATS_DIR, seat))).toBe(false);
  });

  it("retires no seat of the shared fixture, whose every placed seat names a step the package defines", () => {
    const state = syncState(join(FIXTURE_CONSUMER_ROOT, "clossys"), "producer");
    expect(state.retiring).toEqual([]);
    const steps = packageStepIds();
    expect(placed(readIa(FIXTURE_CONSUMER_ROOT)).filter(id => !steps.has(id.slice("seat.".length)))).toEqual([]);
  });
});
