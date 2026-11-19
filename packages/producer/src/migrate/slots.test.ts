/**
 * `clossys migrate slots` (foundry-build-0048 U13): one format for a consumer store. Run on temp copies of the
 * legacy tree (slot/1 slots, slot/1 seats, pin/1 pins, headerless candidates): the store converts to slot/2,
 * pin/2 and clossys.candidate/1 only, a rerun writes nothing, a run stopped mid-apply finishes on the rerun with
 * nothing lost, a symbolic link or a journal path outside the consumer refuses, and `--check` exits 1 while
 * anything is pending. Once converted, a newly written slot/1 or pin/1 is refused by the readers.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../records/hash.js";
import { consumerCopy, CONSUMER } from "../records/__fixtures__/slot2-workspace.js";
import { checkSlotModel } from "../records/slot-check.js";
import { inspectSlot, readPin } from "../records/slots.js";
import { isConvertedStore, storeFormatPath } from "../records/store-format.js";
import { runCli } from "../cli/main.js";
import { applySlotsMigration, guardedPath, planSlotsMigration, slotsPending, SLOTS_JOURNAL } from "./slots.js";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
const OPTIONS = { at: "2026-11-18T09:12:00Z", version: "0.0.0-test" };

/** sha256 of every file under `dir`, by relative path (lock folders and the scorecard cache skipped). */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string): void => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else out[relative(dir, path)] = sha256Hex(readFileSync(path));
    }
  };
  walk(dir);
  return out;
}

/** Every slot.json and pin.json schema in the store, counted. */
function formats(consumer: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const agents = join(consumer, "agents");
  for (const agent of readdirSync(agents)) {
    if (!statSync(join(agents, agent)).isDirectory()) continue;
    for (const id of readdirSync(join(agents, agent))) {
      for (const file of ["slot.json", "pin.json"]) {
        const path = join(agents, agent, id, file);
        if (!existsSync(path)) continue;
        const schema = (JSON.parse(readFileSync(path, "utf8")) as { schema?: string }).schema ?? "pin/1 (no schema)";
        counts[`${file} ${schema}`] = (counts[`${file} ${schema}`] ?? 0) + 1;
      }
    }
  }
  return counts;
}

function apply(root: string) {
  const plan = planSlotsMigration(root, OPTIONS);
  expect(plan.findings).toEqual([]);
  return { plan, applied: applySlotsMigration(root, plan, OPTIONS) };
}

describe("clossys migrate slots on a copy of the legacy tree (a mixed store)", () => {
  it("converts every slot, seat, pin and candidate to the one format, and a rerun writes nothing (idempotent)", () => {
    const original = tree(CONSUMER);
    const ws = consumerCopy();
    const consumer = join(ws.root, "clossys");
    const before = formats(consumer);
    expect(before["slot.json clossys.slot/1"]).toBeGreaterThan(400);
    const { plan, applied } = apply(ws.root);
    expect(slotsPending(plan)).toBeGreaterThan(0);
    expect(applied.marker).toBe(true);
    expect(isConvertedStore(consumer)).toBe(true);
    const after = formats(consumer);
    expect(Object.keys(after).filter(key => key.startsWith("slot.json")).sort()).toEqual(["slot.json clossys.slot/2"]);
    expect(Object.keys(after).filter(key => key.startsWith("pin.json") && key !== "pin.json clossys.pin/2" && key !== "pin.json clossys.pin-map/1")).toEqual([]);
    // Seats too: a slot/2 of kind seat, read back as the same seat.
    const seat = JSON.parse(readFileSync(join(consumer, "agents", "producer", "seat.critic", "slot.json"), "utf8"));
    expect(seat).toMatchObject({ schema: "clossys.slot/2", kind: "seat", agent: "producer", contract: { step: "critic" } });
    expect(existsSync(join(consumer, SLOTS_JOURNAL))).toBe(false);
    expect(checkSlotModel(consumer, { current: true }).filter(row => /OLD_SLOT_FORMAT|slot\/1|pin\/1/.test(JSON.stringify(row)))).toEqual([]);
    // Idempotent: the converted store plans nothing and a second apply changes no byte.
    const snapshot = tree(ws.root);
    const again = planSlotsMigration(ws.root, OPTIONS);
    expect(again.changes).toEqual([]);
    expect(slotsPending(again)).toBe(0);
    applySlotsMigration(ws.root, again, OPTIONS);
    expect(tree(ws.root)).toEqual(snapshot);
    expect(tree(CONSUMER)).toEqual(original);
  }, 120_000);

  it("finishes a run stopped mid-apply on the rerun, from its journal, losing no file", () => {
    const ws = consumerCopy();
    const consumer = join(ws.root, "clossys");
    const plan = planSlotsMigration(ws.root, OPTIONS);
    let renames = 0;
    const crash = { rename: (from: string, to: string) => { if (++renames > 40) throw new Error("simulated crash"); renameSync(from, to); } };
    expect(() => applySlotsMigration(ws.root, plan, OPTIONS, crash)).toThrow(/simulated crash/);
    expect(existsSync(join(consumer, SLOTS_JOURNAL))).toBe(true);
    expect(isConvertedStore(consumer)).toBe(false);
    // Every planned file is still there, either as it was or as it will be: nothing lost.
    for (const change of plan.changes) {
      const path = join(consumer, change.file);
      expect(existsSync(path), change.file).toBe(true);
      expect([change.from.sha256, change.to.sha256]).toContain(sha256Hex(readFileSync(path)));
    }
    const resumed = planSlotsMigration(ws.root, OPTIONS);
    expect(resumed.resumed).toBe(true);
    applySlotsMigration(ws.root, resumed, OPTIONS);
    expect(existsSync(join(consumer, SLOTS_JOURNAL))).toBe(false);
    expect(isConvertedStore(consumer)).toBe(true);
    for (const change of plan.changes) expect(sha256Hex(readFileSync(join(consumer, change.file))), change.file).toBe(change.to.sha256);
  }, 120_000);

  it("keeps the old file when a written file does not read back as written (verify before replace)", () => {
    const ws = consumerCopy();
    const consumer = join(ws.root, "clossys");
    const plan = planSlotsMigration(ws.root, OPTIONS);
    const target = plan.changes.find(change => change.kind === "slot")!;
    const before = readFileSync(join(consumer, target.file));
    const corrupt = { reread: (file: string) => file.includes(target.file.split("/").slice(0, -1).join("/")) && file.endsWith(".migrate-slots.tmp") ? "{}" : readFileSync(file, "utf8") };
    expect(() => applySlotsMigration(ws.root, plan, OPTIONS, corrupt)).toThrow(/did not read back as written/);
    expect(readFileSync(join(consumer, target.file))).toEqual(before);
    expect(readdirSync(join(consumer, target.file, "..")).filter(name => name.endsWith(".migrate-slots.tmp"))).toEqual([]);
  }, 120_000);

  it("refuses a symbolic link anywhere in the store and writes nothing", () => {
    const ws = consumerCopy();
    const consumer = join(ws.root, "clossys");
    const dir = join(consumer, "agents", "designer");
    const id = readdirSync(dir).find(name => existsSync(join(dir, name, "slot.json")))!;
    const outside = join(ws.root, "outside.json");
    writeFileSync(outside, readFileSync(join(dir, id, "slot.json")));
    rmSync(join(dir, id, "slot.json"));
    symlinkSync(outside, join(dir, id, "slot.json"));
    const snapshot = tree(consumer);
    const plan = planSlotsMigration(ws.root, OPTIONS);
    expect(plan.findings.map(row => row.detail).join("\n")).toMatch(/symbolic link|a link/);
    expect(() => applySlotsMigration(ws.root, plan, OPTIONS)).toThrow(/finding/);
    expect(tree(consumer)).toEqual(snapshot);
    expect(readFileSync(outside, "utf8")).toBe(readFileSync(join(dir, id, "slot.json"), "utf8"));
  }, 120_000);

  it("never writes outside the consumer: a journal path that leaves it is refused", () => {
    const ws = consumerCopy();
    const consumer = join(ws.root, "clossys");
    expect(() => guardedPath(consumer, consumer, "../outside/slot.json")).toThrow();
    expect(() => guardedPath(consumer, consumer, "agents/designer/../../../x/slot.json")).toThrow();
    const plan = planSlotsMigration(ws.root, OPTIONS);
    const first = plan.changes[0]!;
    const journal = { schema: "clossys.migrate-slots-journal/1", startedAt: OPTIONS.at, changes: [{ ...first, file: `../${first.file}` }] };
    writeFileSync(join(consumer, SLOTS_JOURNAL), `${JSON.stringify(journal, null, 2)}\n`);
    const refused = planSlotsMigration(ws.root, OPTIONS);
    expect(refused.findings.map(row => row.detail).join("\n")).toMatch(/outside agents/);
    expect(() => applySlotsMigration(ws.root, refused, OPTIONS)).toThrow(/finding/);
    expect(existsSync(join(ws.root, first.file))).toBe(false);
  }, 120_000);

  it("--check exits 1 while anything is pending and 0 once converted; --apply with --check is a usage error", async () => {
    const ws = consumerCopy();
    const pending = await runCli(["migrate", "slots", "--check", "--root", ws.root, "--json"], ws.root);
    expect(pending.exitCode, pending.message).toBe(1);
    expect(existsSync(storeFormatPath(join(ws.root, "clossys")))).toBe(false);
    expect((await runCli(["migrate", "slots", "--check", "--apply", "--root", ws.root], ws.root)).exitCode).toBe(2);
    const applied = await runCli(["migrate", "slots", "--apply", "--at", OPTIONS.at, "--root", ws.root], ws.root);
    expect(applied.exitCode, applied.message).toBe(0);
    const clean = await runCli(["migrate", "slots", "--check", "--root", ws.root], ws.root);
    expect(clean.exitCode, clean.message).toBe(0);
  }, 180_000);
});

describe("a converted store fails closed on the old formats", () => {
  /** A placed designer slot of the copy, and a pin/1 for it (the legacy tree has no pins). */
  const place = (root: string) => {
    const consumer = join(root, "clossys");
    const dir = join(consumer, "agents", "designer");
    const id = readdirSync(dir).filter(name => existsSync(join(dir, name, "slot.json"))).sort()[0]!;
    const pin1 = `${JSON.stringify({ candidate: "example-v1.json", sha256: "0".repeat(64), decidedBy: "planner:U13", basis: "planner", at: OPTIONS.at }, null, 2)}\n`;
    return { consumer, dir: join(dir, id), id, pin1 };
  };

  it("an unconverted store still reads a pin/1 and a slot/1 (the control)", () => {
    const ws = consumerCopy();
    const p = place(ws.root);
    writeFileSync(join(p.dir, "pin.json"), p.pin1);
    expect(readPin(p.consumer, "designer", p.id)).toMatchObject({ candidate: "example-v1.json", basis: "planner" });
    expect(() => inspectSlot(p.consumer, "designer", p.id)).not.toThrow();
  }, 120_000);

  it("refuses a newly written slot/1 slot or pin/1 pin: the check names it and the readers do not read it", () => {
    const ws = consumerCopy();
    const p = place(ws.root);
    const slot1 = readFileSync(join(p.dir, "slot.json"), "utf8");
    apply(ws.root);
    expect(json(join(p.dir, "slot.json")).schema).toBe("clossys.slot/2");
    expect(() => inspectSlot(p.consumer, "designer", p.id)).not.toThrow();
    // A pin/1 dropped in after the conversion: no pin, and the check names it.
    writeFileSync(join(p.dir, "pin.json"), p.pin1);
    expect(readPin(p.consumer, "designer", p.id)).toBeNull();
    expect(checkSlotModel(p.consumer, {}).filter(row => row.path.includes(`${p.id}/pin.json`)).map(row => row.message).join("\n")).toMatch(/clossys migrate slots|clossys\.pin\/2/);
    rmSync(join(p.dir, "pin.json"));
    // A slot/1 slot.json dropped in after the conversion: the readers refuse it and the check names it.
    writeFileSync(join(p.dir, "slot.json"), slot1);
    expect(() => inspectSlot(p.consumer, "designer", p.id)).toThrow(/clossys migrate slots|slot\/2/);
    expect(checkSlotModel(p.consumer, {}).filter(row => row.path.includes(`${p.id}/slot.json`)).length).toBeGreaterThan(0);
  }, 120_000);
});
