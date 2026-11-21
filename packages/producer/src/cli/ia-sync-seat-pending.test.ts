/**
 * CONSISTENCY C1 (foundry-build-0048): `ia sync` and `ia sync --check` call one finding function and give one exit code.
 * A package seat placed in producer ia.json whose folder holds nothing is `seat-pending`: listed with the seat verb as
 * its remedy, failing neither path. A seat folder that holds a record but lost its slot.json is `slot-missing` and
 * fails both.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// Load the CLI first, as every caller does: owner.ts sits in an import cycle with the pipeline handlers.
import "./main.js";
import { runIaCli } from "./owner.js";
import { FIXTURE_CONSUMER_ROOT } from "../records/slot-model/fixture-consumer.test.js";
import { syncDrift, syncVerdict } from "../records/slot-model/ia-sync.js";

const temps: string[] = [];
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function copy(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ia-sync-seat-")));
  temps.push(root);
  cpSync(join(FIXTURE_CONSUMER_ROOT, "clossys"), join(root, "clossys"), { recursive: true });
  return root;
}
const seatDir = (root: string, id: string) => join(root, "clossys", "agents", "producer", id);
const firstSeat = (root: string) => readdirSync(join(root, "clossys", "agents", "producer")).filter(name => name.startsWith("seat.")).sort()[0]!;
// The seat tree only: the shared fixture's catalog agents carry drift of their own, judged by ia-sync.test.ts.
const both = async (root: string) => ({
  sync: await runIaCli(["sync", "--agent", "producer", "--root", root], root),
  check: await runIaCli(["sync", "--check", "--agent", "producer", "--root", root], root),
});

describe("ia sync: seat-pending (CONSISTENCY C1)", () => {
  it("lists an unseated seat step as seat-pending with the seat verb as its remedy, and both paths exit 0", async () => {
    const root = copy();
    const seat = firstSeat(root);
    rmSync(seatDir(root, seat), { recursive: true });
    const findings = syncDrift(join(root, "clossys"), "producer");
    expect(findings).toEqual([{ agent: "producer", kind: "seat-pending", slot: seat, detail: expect.stringContaining(`clossys seat ${seat.slice("seat.".length)} --by <who>`) }]);
    expect(findings[0]!.detail).toMatch(/--decided-by owner:queue\.<kind>#<id>\|planner/);
    expect(findings[0]!.detail).not.toMatch(/has no slot\.json/);
    const verdict = syncVerdict(join(root, "clossys"), ["producer"], false);
    expect(verdict).toMatchObject({ exitCode: 0, failing: [], pending: [{ kind: "seat-pending", slot: seat }] });
    const { sync, check } = await both(root);
    expect(sync.exitCode, sync.message).toBe(0);
    expect(check.exitCode, check.message).toBe(0);
    for (const result of [sync, check]) expect(result.message).toContain(`producer seat-pending: ${seat} waits on a seat decision`);
    // The write never seats a step: the folder is still empty after it.
    expect(existsSync(join(seatDir(root, seat), "slot.json"))).toBe(false);
  }, 60_000);

  it("keeps a seat folder that holds only empty folders (a refused seat verb's leftover) seat-pending", async () => {
    const root = copy();
    const seat = firstSeat(root);
    rmSync(seatDir(root, seat), { recursive: true });
    mkdirSync(join(seatDir(root, seat), "candidates"), { recursive: true });
    expect(syncDrift(join(root, "clossys"), "producer")).toMatchObject([{ kind: "seat-pending", slot: seat }]);
    const { sync, check } = await both(root);
    expect([sync.exitCode, check.exitCode]).toEqual([0, 0]);
  }, 60_000);

  it("fails both paths on a placed seat that lost its record (mutation a)", async () => {
    const root = copy();
    const seat = firstSeat(root);
    // The seat folder keeps its ledger: the seat was recorded, its slot.json is missing.
    rmSync(join(seatDir(root, seat), "slot.json"));
    expect(syncDrift(join(root, "clossys"), "producer")).toEqual([{ agent: "producer", kind: "slot-missing", slot: seat, detail: `${seat} is placed but has no slot.json` }]);
    const { sync, check } = await both(root);
    expect(sync.exitCode, sync.message).toBe(1);
    expect(check.exitCode, check.message).toBe(1);
    for (const result of [sync, check]) expect(result.message).toContain(`producer slot-missing: ${seat} is placed but has no slot.json`);
  }, 60_000);

  it("gives the dry write the same verdict: a finding no planned file repairs fails it", async () => {
    const root = copy();
    const seat = firstSeat(root);
    rmSync(join(seatDir(root, seat), "slot.json"));
    const dry = await runIaCli(["sync", "--dry", "--agent", "producer", "--root", root], root);
    expect(dry.exitCode, dry.message).toBe(1);
  }, 60_000);
});
