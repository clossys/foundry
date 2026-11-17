/**
 * foundry-build-0031: `clossys check` judges a recut consumer (clossys.slot/2). Synthetic: a tmp copy of
 * test-fixtures/consumer, recut in tmp, then the slot resolve that `clossys check` runs.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PRODUCER_ROOT } from "../package-path.js";
import { applyRecut, planRecut } from "../migrate/recut.js";
import { OLD_SLOT_FORMAT } from "../records/slot-current.js";
import { runSlotResolve } from "./slot-resolve.js";

const AT = "2026-11-15T10:00:00Z";
let root: string | undefined;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = undefined; });

function recut() {
  root = mkdtempSync(join(tmpdir(), "check-current-"));
  const consumer = join(root, "clossys");
  cpSync(join(PRODUCER_ROOT, "test-fixtures", "consumer", "clossys"), consumer, { recursive: true });
  const slot = join(consumer, "agents", "director", "advantage.proposition.promise", "slot.json");
  const before = readFileSync(slot, "utf8");
  applyRecut(planRecut(root, { at: AT }));
  return { consumer, slot, before };
}

describe("clossys check on a recut consumer (current slot format)", () => {
  it("judges it: no schema-version rows, no unreadable inputs, no missing slot.json", async () => {
    const w = recut();
    expect(JSON.parse(readFileSync(w.slot, "utf8")).schema).toBe("clossys.slot/2");
    const result = await runSlotResolve(w.consumer);
    const messages = result.findings.map(row => row.message);
    expect(result.exitCode).not.toBe(2);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(messages.filter(message => /could not be read/.test(message))).toEqual([]);
    expect(messages.filter(message => /schema must be|unknown key|slot\.json is missing/.test(message))).toEqual([]);
    expect(messages).not.toContain(OLD_SLOT_FORMAT);
  });

  it("names an old-format slot.json once, pointing at clossys migrate recut", async () => {
    const w = recut();
    writeFileSync(w.slot, w.before);
    const result = await runSlotResolve(w.consumer);
    const old = result.findings.filter(row => row.message === OLD_SLOT_FORMAT);
    expect(old).toHaveLength(1);
    expect(result.findings.filter(row => /advantage\.proposition\.promise/.test(row.path ?? "") && /schema must be/.test(row.message))).toEqual([]);
  });
});
