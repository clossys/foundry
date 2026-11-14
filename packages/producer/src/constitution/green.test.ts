import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../cli/args.js";
import { runCheck } from "../cli/check.js";
import { buildGreen, evaluateDelta, greenDigest, readGreen, rowKey, verifyGreen, type GreenReport } from "./green.js";
import { runConstitution } from "./run.js";
import { cleanSpec, NO_HISTORY, writeWorkspace, type WorkspaceSpec } from "./__fixtures__/workspace.js";

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

  it("blocks a pre-existing finding on a changed record and on its R07 dependants", () => {
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
    expect(delta).toMatchObject({ ok: false, newRows: 0, changedRecords: ["designer/ui.button"] });
    expect(delta.dependantRecords).toEqual(["designer/ui.card", "publisher/site.home"]);
    expect(r04(delta.blocking)).toEqual(["designer/ui.button", "designer/ui.card"]);
    expect(delta.changedRows).toBe(delta.blocking.length);
  });

  it("fails a hand-edited green report: a digest mismatch, and a key no longer produced", () => {
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
    expect(delta).toMatchObject({ ok: false, blocking: [] });
    expect(delta.stale).toEqual([{ key: "R04 designer/ui.ghost .", recorded: 1, produced: 0 }]);
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
    expect(enforced.message).toMatch(/--enforced \(delta gate until E2\): PASS {2}delta 0 \(new keys 0, on changed records 0\) of enforced [1-9]\d*; total rows \d+/);
    const strict = await cli("--strict");
    expect(strict.exitCode).toBe(1);
    expect(strict.message).toMatch(/--strict \(full gate\): FAIL {2}enforced findings [1-9]\d* block; delta 0/);
    const plain = await cli();
    expect(plain.message).toMatch(/constitution delta: delta 0 .* of enforced/);
    expect(() => parseArgs(["check", "--constitution", "--record-green", "--rule", "R04"])).toThrow(/full run/);
    // A hand edit fails the step and refuses a re-record.
    const doc = JSON.parse(readFileSync(path, "utf8")) as GreenReport;
    writeFileSync(path, JSON.stringify({ ...doc, keys: { ...doc.keys, "R04 producer/seat.director .": 1 } }));
    expect((await cli("--enforced")).exitCode).toBe(1);
    const refused = await cli("--record-green");
    expect(refused.exitCode).toBe(1);
    expect(refused.message).toMatch(/REFUSED: .*integrity/);
  });
});
