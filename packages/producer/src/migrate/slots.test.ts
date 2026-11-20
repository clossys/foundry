/**
 * `clossys migrate slots` (foundry-build-0048 U13): one format for a consumer store. Run on temp copies of the
 * legacy tree (slot/1 slots, slot/1 seats, pin/1 pins, headerless candidates): the store converts to slot/2,
 * pin/2 and clossys.candidate/1 only, a rerun writes nothing, a run stopped mid-apply finishes on the rerun with
 * nothing lost, a symbolic link or a journal path outside the consumer refuses, and `--check` exits 1 while
 * anything is pending. Once converted, a newly written slot/1 or pin/1 is refused by the readers.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import "../constitution/guard.js"; // the migrate guard runs on every folder (U13 r4)
import { sha256Hex } from "../records/hash.js";
import { skillFile, skillPath } from "../records/ledger.js";
import { consumerCopy, CONSUMER } from "../records/__fixtures__/slot2-workspace.js";
import { checkSlotModel } from "../records/slot-check.js";
import { SLOT_LOCK } from "../records/slot-write.js";
import { inspectSlot, readLedger, readPin } from "../records/slots.js";
import { pinGate } from "../constitution/pin-gate.js";
import { runConstitution } from "../constitution/run.js";
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
  }, 360_000);

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
  }, 360_000);

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
  }, 360_000);

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
  }, 360_000);

  it("never writes outside the consumer: a journal path that leaves it is refused", () => {
    const ws = consumerCopy();
    const consumer = join(ws.root, "clossys");
    expect(() => guardedPath(consumer, consumer, "../outside/slot.json")).toThrow();
    expect(() => guardedPath(consumer, consumer, "agents/designer/../../../x/slot.json")).toThrow();
    // A file inside the consumer but outside agents/<agent>/<slot>/ is refused by name, before any realpath check.
    expect(() => guardedPath(consumer, realpathSync(consumer), "clossys.config.ts")).toThrow(/is outside agents\/<agent>\/<slot>\//);
    const plan = planSlotsMigration(ws.root, OPTIONS);
    const first = plan.changes[0]!;
    const journal = { schema: "clossys.migrate-slots-journal/1", startedAt: OPTIONS.at, changes: [{ ...first, file: `../${first.file}` }] };
    writeFileSync(join(consumer, SLOTS_JOURNAL), `${JSON.stringify(journal, null, 2)}\n`);
    const refused = planSlotsMigration(ws.root, OPTIONS);
    expect(refused.findings.map(row => row.detail).join("\n")).toMatch(/outside agents/);
    expect(() => applySlotsMigration(ws.root, refused, OPTIONS)).toThrow(/finding/);
    expect(existsSync(join(ws.root, first.file))).toBe(false);
  }, 360_000);

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

/** The plan's changes by slot folder (`agents/<agent>/<slot>`, consumer-relative), as apply groups them. */
function folders(changes: readonly { readonly file: string }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const change of changes) {
    const key = change.file.split("/").slice(0, 3).join("/");
    out.set(key, [...(out.get(key) ?? []), change.file]);
  }
  return out;
}

const migrateEvents = (consumer: string, folder: string) =>
  (readLedger(join(consumer, folder))?.events ?? []).filter(event => event.op === "migrate" && event.migration === "slots");

/** The checks a migration must not introduce (diagnosis U13 r4 section 5: R02.3, R14.1, R05, R08.2), as row keys. */
const MIGRATION_CHECKS = /^(R02\.3|R14\.1|R05\.|R08\.2)$/;
const migrationRows = (root: string) => runConstitution({ root, consumer: join(root, "clossys"), rule: ["R02", "R05", "R08", "R14"] }).rows
  .filter(row => !row.pending && MIGRATION_CHECKS.test(row.check)).map(row => `${row.check} ${row.path} ${row.reason}`).sort();

describe("clossys migrate slots records itself in each folder's ledger (U13 r4, B3)", () => {
  it("appends one migrate event per converted folder naming its recuts and record states; a rerun appends none", () => {
    const ws = consumerCopy();
    const consumer = join(ws.root, "clossys");
    const plan = planSlotsMigration(ws.root, OPTIONS);
    const byFolder = folders(plan.changes);
    const { applied } = apply(ws.root);
    expect(applied.ledgerEvents).toBe(byFolder.size);
    for (const [folder] of byFolder) {
      const events = migrateEvents(consumer, folder);
      expect(events, folder).toHaveLength(1);
      const recuts = plan.changes.filter(change => change.kind === "candidate" && change.file.startsWith(`${folder}/`) && change.from.sha256 !== change.to.sha256)
        .map(change => ({ name: change.file.slice(`${folder}/candidates/`.length), from: change.from.sha256, to: change.to.sha256 }));
      expect(events[0]!.files, folder).toEqual(recuts);
      const records = events[0]!.records ?? [];
      expect(records.length, folder).toBeGreaterThan(0);
      for (const state of records) {
        const path = join(consumer, folder, state.file);
        expect(state.sha256, `${folder}/${state.file}`).toBe(existsSync(path) ? sha256Hex(readFileSync(path)) : null);
      }
    }
    const again = applySlotsMigration(ws.root, planSlotsMigration(ws.root, OPTIONS), OPTIONS);
    expect(again.ledgerEvents).toBe(0);
    for (const [folder] of byFolder) expect(migrateEvents(consumer, folder), folder).toHaveLength(1);
  }, 240_000);

  it("introduces no R02.3, R14.1, R05 or R08.2 row on either fixture consumer", () => {
    for (const fixture of ["consumer", "consumer-legacy-tree"]) {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "migrate-slots-rows-")));
      cpSync(join(CONSUMER, "..", fixture), root, { recursive: true });
      const before = migrationRows(root);
      apply(root);
      const after = migrationRows(root);
      expect(after.filter(row => /^(R02\.3|R14\.1|R05\.)/.test(row)), fixture).toEqual([]);
      expect(after.filter(row => !before.includes(row)), fixture).toEqual([]);
    }
  }, 600_000);

  it("the CHOOSE gate accepts a pinned candidate the migration recut (no changed-since-submit refusal)", () => {
    const ws = consumerCopy();
    const consumer = join(ws.root, "clossys");
    const dir = join(consumer, "agents", "designer");
    const id = readdirSync(dir).filter(name => existsSync(join(dir, name, "slot.json"))).sort()[0]!;
    const cell = join(dir, id);
    const bytes = `${JSON.stringify({ name: "example", type: "registry:item", files: [], meta: { source: { kind: "registry", ref: ["shadcn-aria/button@4.23.0"] } } }, null, 2)}\n`;
    mkdirSync(join(cell, "candidates"), { recursive: true });
    writeFileSync(join(cell, "candidates", "valid-v1.json"), bytes);
    // The legacy tree's pin/1, naming the headerless bytes the migration then recuts.
    const pin = `${JSON.stringify({ candidate: "valid-v1.json", sha256: sha256Hex(bytes), decidedBy: "planner:U13", basis: "planner", at: OPTIONS.at }, null, 2)}\n`;
    writeFileSync(join(cell, "pin.json"), pin);
    // U13 r4: the guarded migration refuses a folder whose files have no provenance (R14.1), so the legacy ledger
    // records the submit and the pin the way the slot/1 writers did, citing the installed action skills (R14.2).
    const skill = (path: string) => ({ path, sha256: sha256Hex(readFileSync(skillFile(path))) });
    const ledger = JSON.parse(readFileSync(join(cell, "ledger.json"), "utf8")) as { schema: string; events: Record<string, unknown>[] };
    ledger.events.push(
      { op: "submit", at: OPTIONS.at, by: "planner", verb: "submit", skill: skill(skillPath("designer", "designer.candidates")), model: "none", tier: "none", name: "valid-v1.json", sha256: sha256Hex(bytes) },
      { op: "pin", at: OPTIONS.at, by: "planner:U13", verb: "pin", skill: skill(skillPath("producer", "pin.designer")), model: "none", tier: "none", candidate: "valid-v1.json", sha256: sha256Hex(bytes), decidedBy: "planner:U13", basis: "planner", records: [{ file: "pin.json", sha256: sha256Hex(pin) }] },
    );
    writeFileSync(join(cell, "ledger.json"), `${JSON.stringify(ledger, null, 2)}\n`);
    apply(ws.root);
    const recut = readFileSync(join(cell, "candidates", "valid-v1.json"), "utf8");
    expect(recut).not.toBe(bytes);
    expect(readPin(consumer, "designer", id)).toMatchObject({ candidate: "valid-v1.json", sha256: sha256Hex(recut) });
    const gate = pinGate(ws.root, consumer, "designer", id, "valid-v1.json", OPTIONS.at);
    expect(gate.refusals.filter(reason => /changed since its submit|no submit|invalid frontmatter|header/i.test(reason))).toEqual([]);
  }, 240_000);

  it("waits on no folder another decision write holds: apply refuses under a held slot lock, keeps the journal, and the rerun finishes (N7)", () => {
    const ws = consumerCopy();
    const consumer = join(ws.root, "clossys");
    const plan = planSlotsMigration(ws.root, OPTIONS);
    const held = [...folders(plan.changes).keys()].sort()[1]!;
    const lock = join(consumer, held, SLOT_LOCK);
    mkdirSync(lock);
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, host: hostname(), at: Date.now() }));
    const heldBefore = tree(join(consumer, held));
    expect(() => applySlotsMigration(ws.root, plan, OPTIONS)).toThrow(/Slot is unavailable or another decision write is in progress/);
    expect(tree(join(consumer, held))).toEqual(heldBefore);
    expect(migrateEvents(consumer, held)).toHaveLength(0);
    expect(existsSync(join(consumer, SLOTS_JOURNAL))).toBe(true);
    expect(isConvertedStore(consumer)).toBe(false);
    rmSync(lock, { recursive: true });
    const resumed = planSlotsMigration(ws.root, OPTIONS);
    expect(resumed.resumed).toBe(true);
    expect(applySlotsMigration(ws.root, resumed, OPTIONS).marker).toBe(true);
    expect(migrateEvents(consumer, held)).toHaveLength(1);
  }, 240_000);
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
  }, 360_000);

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
  }, 360_000);
});
