import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../cli/args.js";
import { runCheck } from "../cli/check.js";
import { buildGreen, evaluateDelta, formatDelta, greenDigest, IA_POSITION_KIND, isIaPositionEvent, ledgerRecordView, POSITION_FIELDS, readGreen, rowKey, seedGrowth, slotRecordView, slotWriteKind, verifyGreen, type GreenReport } from "./green.js";
import { singleReaderRows } from "./rules/r11.js";
import { runConstitution } from "./run.js";
import { cleanSpec, NO_HISTORY, slotDoc, writeWorkspace, type WorkspaceSpec } from "./__fixtures__/workspace.js";

const WS = "(no package.json)";

/** A clean workspace with one pre-existing enforced finding: ui.button is unpinned (R04). */
function baselineSpec(): WorkspaceSpec {
  const spec = cleanSpec();
  spec.designer!["ui.button"]!.pin = false;
  return spec;
}

const run = (spec: WorkspaceSpec) => {
  const { root, consumer } = writeWorkspace(spec);
  const report = runConstitution({ root, consumer, history: () => NO_HISTORY, index: true, now: () => 0 });
  return { root, consumer, report, index: report.index! };
};

const scope = (report: ReturnType<typeof run>["report"]) => ({ rules: report.rules.map(rule => rule.id) });

/** Writes a green report file and reads it back the way the CLI does. */
function stored(green: GreenReport | Record<string, unknown>) {
  const path = join(mkdtempSync(join(tmpdir(), "constitution-green-")), "constitution-green.json");
  writeFileSync(path, `${JSON.stringify(green, null, 2)}\n`);
  return { path, read: readGreen(path, WS) };
}

const r04 = (rows: readonly { check: string; agent: string; slot: string }[]) => rows.filter(row => row.check === "R04").map(row => `${row.agent}/${row.slot}`);

describe("constitution delta gate (until E2)", () => {
  it("passes a pre-existing finding and blocks a new one", () => {
    const base = run(baselineSpec());
    expect(r04(base.report.rows)).toEqual(["designer/ui.button"]);
    const green = buildGreen(base.report.rows, base.index, { workspace: WS, commit: "unknown" });
    expect(verifyGreen(green)).toEqual([]);
    // The same records again: the pre-existing R04 row is listed, never blocking.
    const same = evaluateDelta(base.report.rows, base.index, stored(green).read, scope(base.report));
    expect(same).toMatchObject({ ok: true, newRows: 0, changedRows: 0, stale: [], tampered: [] });
    expect(same.blocking).toEqual([]);
    expect(same.enforced).toBeGreaterThan(0);
    // A new finding (producer seat unpinned) blocks, as a new key and as a changed record.
    const spec = baselineSpec();
    spec.producer!["seat.director"]!.pin = false;
    const next = run(spec);
    const delta = evaluateDelta(next.report.rows, next.index, stored(green).read, scope(next.report));
    expect(delta.ok).toBe(false);
    expect(r04(delta.blocking)).toEqual(["producer/seat.director"]);
    expect(delta.newRows).toBeGreaterThan(0);
    // (b) alone: a key the green report lacks blocks even on an unchanged record.
    const { "R04 designer/ui.button .": _dropped, ...keys } = green.keys as Record<string, number>;
    expect(_dropped).toBe(1);
    const lacking = { ...green, keys, enforced: green.enforced - 1 };
    const onlyNew = evaluateDelta(base.report.rows, base.index, stored({ ...lacking, digest: greenDigest(lacking) }).read, scope(base.report));
    expect(onlyNew).toMatchObject({ ok: false, newRows: 1, changedRows: 0 });
    expect(onlyNew.blocking.map(rowKey)).toEqual(["R04 designer/ui.button ."]);
  });

  it("G1: counts a pre-existing finding on a changed record and on its R07 dependants, never blocking on it", () => {
    const spec = baselineSpec();
    spec.designer!["ui.card"]!.pin = false; // a pre-existing finding on a dependant (ui.card uses ui.button)
    const base = run(spec);
    expect(r04(base.report.rows)).toEqual(["designer/ui.button", "designer/ui.card"]);
    const green = buildGreen(base.report.rows, base.index, { workspace: WS, commit: "unknown" });
    // Change ui.button's record only (its candidate bytes); no finding is new.
    const changed = baselineSpec();
    changed.designer!["ui.card"]!.pin = false;
    changed.designer!["ui.button"]!.candidates = { "button-v1.json": { name: "button", type: "registry:ui", files: [{ path: "ui/button.tsx", type: "registry:ui", content: "export const Button = 2;\n" }] } };
    const next = run(changed);
    expect(next.report.rows.map(rowKey)).toEqual(base.report.rows.map(rowKey));
    const delta = evaluateDelta(next.report.rows, next.index, stored(green).read, scope(next.report));
    expect(delta).toMatchObject({ ok: true, newRows: 0, changedRecords: ["designer/ui.button"] });
    expect(delta.dependantRecords).toEqual(["designer/ui.card", "publisher/site.home"]);
    expect(delta.blocking).toEqual([]);
    // Both pre-existing R04 rows sit on the changed record or its dependant: counted, printed, not blocking.
    expect(delta.changedRows).toBeGreaterThanOrEqual(2);
    expect(formatDelta(delta, "enforced")).toMatch(new RegExp(`PASS {2}new 0, changed-record ${delta.changedRows} \\(not blocking until E2\\), stale 0`));
    // A new finding on the same changed record still blocks, alone.
    const worse = structuredClone(changed);
    worse.producer!["seat.director"]!.pin = false;
    const after = run(worse);
    const blocked = evaluateDelta(after.report.rows, after.index, stored(green).read, scope(after.report));
    expect(blocked.ok).toBe(false);
    expect(r04(blocked.blocking)).toEqual(["producer/seat.director"]);
    expect(blocked.newRows).toBe(blocked.blocking.length);
  });

  it("fails a hand-edited green report (digest mismatch); a key no longer produced is listed stale, not blocking", () => {
    const base = run(baselineSpec());
    const green = buildGreen(base.report.rows, base.index, { workspace: WS, commit: "unknown" });
    // Whitelisting a new finding by hand (the producer seat) without the generator: the digest fails.
    const spec = baselineSpec();
    spec.producer!["seat.director"]!.pin = false;
    const next = run(spec);
    const newKey = "R04 producer/seat.director .";
    expect(next.report.rows.map(rowKey)).toContain(newKey);
    const edited = { ...green, keys: { ...green.keys, [newKey]: 1 } };
    const tampered = stored(edited);
    expect(tampered.read.report).toBeUndefined();
    expect(tampered.read.tampered.join("\n")).toMatch(/digest does not match/);
    expect(evaluateDelta(next.report.rows, next.index, tampered.read, scope(next.report)).ok).toBe(false);
    // A careful hand edit that also recomputes the digest still fails: the key is not produced here.
    const invented = { ...green, keys: { ...green.keys, "R04 designer/ui.ghost .": 1 } };
    const forged = stored({ ...invented, digest: greenDigest(invented) });
    expect(forged.read.tampered).toEqual([]);
    const delta = evaluateDelta(base.report.rows, base.index, forged.read, scope(base.report));
    expect(delta).toMatchObject({ ok: true, blocking: [] });
    expect(delta.stale).toEqual([{ key: "R04 designer/ui.ghost .", recorded: 1, produced: 0 }]);
    expect(formatDelta(delta, "enforced")).toMatch(/stale 1 \(not blocking\)/);
  });

  it("D1: an order-only renumber by the ia verb does not change a record; its pre-existing finding stays passing", () => {
    const { root, consumer } = writeWorkspace(baselineSpec());
    const again = () => runConstitution({ root, consumer, history: () => NO_HISTORY, index: true, now: () => 0 });
    const base = again();
    const green = buildGreen(base.rows, base.index!, { workspace: WS, commit: "unknown" });
    // What followPositions writes for a later slot when a slot is placed above it: ia.order only, in jsonBytes.
    const file = join(consumer, "agents/designer/ui.button/slot.json");
    const doc = JSON.parse(readFileSync(file, "utf8")) as { ia: Record<string, unknown> };
    writeFileSync(file, `${JSON.stringify({ ...doc, ia: { ...doc.ia, order: 7 } }, null, 2)}\n`);
    const renumbered = again();
    expect(renumbered.index!.digests).toEqual(base.index!.digests);
    const delta = evaluateDelta(renumbered.rows, renumbered.index!, stored(green).read, scope(renumbered));
    expect(delta).toMatchObject({ ok: true, changedRecords: [], dependantRecords: [], changedRows: 0, newRows: 0 });
    expect(r04(delta.blocking)).toEqual([]);
  });

  it("D1: only the named position fields are left out; any other slot.json change changes the record", () => {
    expect(POSITION_FIELDS).toEqual(["ia.l0", "ia.l1", "ia.l2", "ia.order"]);
    const doc = slotDoc("designer", "ui.button");
    const record = (value: unknown) => ({ path: "slot.json", text: `${JSON.stringify(value, null, 2)}\n`, value });
    const before = slotRecordView(record(doc));
    // Each position field alone: not a change.
    for (const field of ["l0", "l1", "l2", "order"]) {
      expect(slotRecordView(record({ ...doc, ia: { ...(doc.ia as object), [field]: field === "order" ? 9 : "moved" } }))).toBe(before);
    }
    // Every other field, top level and inside ia: a change.
    const bump = (value: unknown): unknown => typeof value === "string" ? `${value}-x` : typeof value === "boolean" ? !value : typeof value === "number" ? value + 1 : Array.isArray(value) ? [...value, "x"] : { ...(value as object), x: 1 };
    const others = Object.keys(doc).filter(key => key !== "ia");
    expect(others.length).toBeGreaterThan(4);
    for (const key of others) expect(slotRecordView(record({ ...doc, [key]: bump(doc[key]) })), key).not.toBe(before);
    expect(slotRecordView(record({ ...doc, added: 1 }))).not.toBe(before);
    expect(slotRecordView(record({ ...doc, ia: { ...(doc.ia as object), extra: 1 } }))).not.toBe(before);
    // A slot.json the view cannot normalise is digested as its bytes: a renumber there still counts.
    const loose = { path: "slot.json", text: JSON.stringify(doc), value: doc };
    expect(slotRecordView({ ...loose, text: JSON.stringify({ ...doc, ia: { ...(doc.ia as object), order: 9 } }) })).not.toBe(slotRecordView(loose));
  });

  it("D1: only ia-position events leave the ledger view, and only a position-only slot.json write is one", () => {
    const doc = slotDoc("designer", "ui.button");
    const bytes = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
    const before = bytes(doc);
    expect(slotWriteKind(before, bytes({ ...doc, ia: { ...(doc.ia as object), order: 3 } }))).toBe(IA_POSITION_KIND);
    expect(slotWriteKind(before, bytes({ ...doc, ia: { ...(doc.ia as object), l1: "moved", order: 3 } }))).toBe(IA_POSITION_KIND);
    // Any other change, a new file, the same bytes or unnormalised bytes: an `ia` event.
    expect(slotWriteKind(before, bytes({ ...doc, contract: { other: 1 } }))).toBe("ia");
    expect(slotWriteKind(before, bytes({ ...doc, ia: { ...(doc.ia as object), order: 3 }, uses: ["x"] }))).toBe("ia");
    expect(slotWriteKind(null, before)).toBe("ia");
    expect(slotWriteKind(before, before)).toBe("ia");
    expect(slotWriteKind(JSON.stringify(doc), JSON.stringify({ ...doc, ia: { ...(doc.ia as object), order: 3 } }))).toBe("ia");
    const event = (fields: Record<string, unknown>) => ({ op: "slot", verb: "ia", kind: IA_POSITION_KIND, records: [{ file: "slot.json", sha256: "a".repeat(64) }], ...fields });
    expect(isIaPositionEvent(event({}))).toBe(true);
    for (const other of [{ kind: "ia" }, { verb: "retire" }, { op: "pin" }, { records: [{ file: "pin.json", sha256: null }] }, { records: [{ file: "slot.json", sha256: null }, { file: "pin.json", sha256: null }] }]) expect(isIaPositionEvent(event(other)), JSON.stringify(other)).toBe(false);
    const ledger = (events: unknown[]) => { const value = { schema: "clossys.ledger/1", events }; return { path: "ledger.json", text: bytes(value), value }; };
    const submit = { op: "submit", verb: "submit", name: "button-v1.json" };
    expect(ledgerRecordView(ledger([submit, event({})]))).toBe(ledgerRecordView(ledger([submit])));
    expect(ledgerRecordView(ledger([submit, event({ kind: "ia" })]))).not.toBe(ledgerRecordView(ledger([submit])));
    const loose = ledger([submit, event({})]);
    expect(ledgerRecordView({ ...loose, text: JSON.stringify(loose.value) })).toBe(JSON.stringify(loose.value));
  });

  it("D2: a finding key never embeds a line number; a line shift keeps the key, a changed snippet does not", () => {
    const at = (line: number, text = "mkdirSync(dirname(path), { recursive: true })") => singleReaderRows([{ file: "packages/producer/src/cli/owner.ts", line, text, kind: "reader" }]).r111[0]!;
    const before = at(100), shifted = at(126);
    expect(before.path).toBe("packages/producer/src/cli/owner.ts:100");
    expect(rowKey(before)).toMatch(/^R11\.1 \*\/\* packages\/producer\/src\/cli\/owner\.ts @[0-9a-f]{12}$/);
    expect(rowKey(before)).not.toMatch(/:\d/);
    expect(rowKey(shifted)).toBe(rowKey(before));
    expect(rowKey(at(100, "rmdirSync(dir)"))).not.toBe(rowKey(before));
    expect(rowKey({ ...before, path: "packages/producer/studio/lib/y.ts:3:14" })).toBe(rowKey({ ...before, path: "packages/producer/studio/lib/y.ts:40" }));
    // Through the gate: the shifted finding is neither new nor stale.
    const index = { digests: {}, dependsOn: {} };
    const green = buildGreen([before], index, { workspace: WS, commit: "unknown" });
    const delta = evaluateDelta([shifted], index, stored(green).read, { rules: ["R11"] });
    expect(delta).toMatchObject({ ok: true, newRows: 0, stale: [] });
    // A path without a line is keyed as before (no anchor).
    expect(rowKey({ ...before, path: "packages/producer/scripts/check-compile-pure.mjs" })).toBe("R11.1 */* packages/producer/scripts/check-compile-pure.mjs");
  });

  it("wires check --constitution: --record-green seeds, --enforced gates the delta, --strict the whole set, both counts printed", async () => {
    const { consumer } = writeWorkspace(baselineSpec());
    const path = join(mkdtempSync(join(tmpdir(), "constitution-green-")), "green.json");
    const cli = (...flags: string[]) => runCheck(parseArgs(["check", "--constitution", "--green", path, "--root", consumer, ...flags]), consumer);
    const unseeded = await cli("--enforced");
    expect(unseeded.exitCode).toBe(1);
    expect(unseeded.message).toMatch(/baseline: no green report/);
    const seeded = await cli("--record-green");
    expect(seeded.exitCode).toBe(0);
    expect(seeded.message).toMatch(/--record-green: seeded/);
    expect(verifyGreen(JSON.parse(readFileSync(path, "utf8")))).toEqual([]);
    const enforced = await cli("--enforced");
    expect(enforced.exitCode).toBe(0);
    expect(enforced.message).toMatch(/--enforced \(delta gate until E2\): PASS {2}new 0, changed-record 0 \(not blocking until E2\), stale 0 \(not blocking\) of enforced [1-9]\d*; total rows \d+/);
    const strict = await cli("--strict");
    expect(strict.exitCode).toBe(1);
    // Building rows (R03, R05, R15, R16 in this fixture) are report-only outside --strict, so the seeded
    // green report lacks their keys: under --strict they, and only they, are new.
    const building = (strict.output as { building: number }).building;
    expect(strict.message).toMatch(new RegExp(`--strict \\(full gate\\): FAIL {2}enforced findings [1-9]\\d* block; new ${building},`));
    const plain = await cli();
    expect(plain.message).toMatch(/constitution delta: new 0, .* of enforced/);
    expect(() => parseArgs(["check", "--constitution", "--record-green", "--rule", "R04"])).toThrow(/full run/);
    // A hand edit fails the step and refuses a re-record.
    const doc = JSON.parse(readFileSync(path, "utf8")) as GreenReport;
    writeFileSync(path, JSON.stringify({ ...doc, keys: { ...doc.keys, "R04 producer/seat.director .": 1 } }));
    expect((await cli("--enforced")).exitCode).toBe(1);
    const refused = await cli("--record-green");
    expect(refused.exitCode).toBe(1);
    expect(refused.message).toMatch(/REFUSED: .*integrity/);
  });
  it("G2: --record-green refuses to add a key; with removals only it rewrites and re-seals the report", async () => {
    const spec = baselineSpec();
    spec.designer!["ui.card"]!.pin = false; // two pre-existing findings: ui.button and ui.card unpinned
    const path = join(mkdtempSync(join(tmpdir(), "constitution-green-")), "green.json");
    let consumer = writeWorkspace(spec).consumer;
    const cli = (...flags: string[]) => runCheck(parseArgs(["check", "--constitution", "--green", path, "--root", consumer, ...flags]), consumer);
    expect((await cli("--record-green")).exitCode).toBe(0);
    const seeded = JSON.parse(readFileSync(path, "utf8")) as GreenReport;
    expect(Object.keys(seeded.keys)).toEqual(expect.arrayContaining(["R04 designer/ui.button .", "R04 designer/ui.card ."]));
    // A new finding (the producer seat unpinned): --enforced blocks it and --record-green refuses, writing nothing.
    const worse = structuredClone(spec);
    worse.producer!["seat.director"]!.pin = false;
    consumer = writeWorkspace(worse).consumer;
    expect((await cli("--enforced")).exitCode).toBe(1);
    const refused = await cli("--record-green");
    expect(refused.exitCode).toBe(1);
    expect(refused.message).toMatch(/REFUSED: the new report would add 1 key\(s\) .*R04 producer\/seat\.director \. \(recorded 0, produced 1\)/);
    expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify(seeded, null, 2)}\n`);
    // ui.card fixed and its record changed: the key is stale (not blocking), and a re-record drops it.
    const fixed = structuredClone(spec);
    delete fixed.designer!["ui.card"]!.pin;
    consumer = writeWorkspace(fixed).consumer;
    const stale = await cli("--enforced");
    expect(stale.exitCode).toBe(0);
    expect(stale.message).toMatch(/stale 1 \(not blocking\)/);
    const rerecorded = await cli("--record-green");
    expect(rerecorded.exitCode).toBe(0);
    expect(rerecorded.message).toMatch(/--record-green: recorded \(1 fixed key\(s\) removed, 0 count\(s\) lowered, nothing added\)/);
    const next = JSON.parse(readFileSync(path, "utf8")) as GreenReport;
    expect(verifyGreen(next)).toEqual([]);
    expect(Object.keys(next.keys).every(key => key in seeded.keys)).toBe(true);
    expect(Object.keys(next.keys)).toEqual(Object.keys(seeded.keys).filter(key => key !== "R04 designer/ui.card ."));
    expect(next.enforced).toBe(seeded.enforced - 1);
    const clean = await cli("--enforced");
    expect(clean.exitCode).toBe(0);
    expect(clean.message).toMatch(/new 0, changed-record 0 .*stale 0/);
  });

  it("G1(b): a hand-edited report blocks even when the run has no enforced finding", () => {
    const index = { digests: {}, dependsOn: {} };
    const green = buildGreen([], index, { workspace: WS, commit: "unknown" });
    expect(evaluateDelta([], index, stored(green).read, { rules: ["R04"] })).toMatchObject({ ok: true, enforced: 0 });
    const tampered = stored({ ...green, keys: { "R04 designer/ui.ghost .": 1 } });
    const delta = evaluateDelta([], index, tampered.read, { rules: ["R04"] });
    expect(delta).toMatchObject({ ok: false, enforced: 0, blocking: [] });
    expect(delta.tampered.join("\n")).toMatch(/digest does not match/);
  });

  it("G2: seedGrowth names every added key and raised count, and nothing for removals", () => {
    const old = { keys: { a: 2, b: 1 } };
    expect(seedGrowth(old, { keys: { a: 2, b: 1 } })).toEqual([]);
    expect(seedGrowth(old, { keys: { a: 1 } })).toEqual([]);
    expect(seedGrowth(old, { keys: { a: 3, b: 1, c: 1 } })).toEqual([{ key: "a", recorded: 2, produced: 3 }, { key: "c", recorded: 0, produced: 1 }]);
  });
});
