/**
 * The real tree (W2-C Done-when): a warm-cache certify run over every live candidate of the
 * workspace's consumer (`clossys/agents`) takes under 10 s, and the certifier source itself passes
 * R03.3 (no rung reads) and R05.3 (no borrowed fixtures). Skipped when the workspace consumer is
 * absent (a packed Producer).
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { liveSlotRecords } from "../checks/shared.js";
import { buildContext } from "../context.js";
import { r03_3 } from "../rules/r03.js";
import { r05_3 } from "../rules/r05.js";
import type { ConstitutionContext } from "../types.js";
import { certifyWorld } from "./index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const consumer = join(root, "clossys");
const present = existsSync(join(consumer, "agents"));
const WARM_BUDGET_MS = 10_000;

describe.skipIf(!present)("certify over the real tree", () => {
  const dir = mkdtempSync(join(tmpdir(), "w2c-certify-cache-"));
  const cache = join(dir, "certify.json");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it(`a warm-cache run over every live candidate takes under ${WARM_BUDGET_MS / 1000} s`, () => {
    const coldStart = performance.now();
    const cold = certifyWorld(buildContext(root, consumer), { cache });
    const coldMs = performance.now() - coldStart;

    const warmStart = performance.now();
    const ctx = buildContext(root, consumer);
    const warm = certifyWorld(ctx, { cache });
    const warmMs = performance.now() - warmStart;

    const candidates = [...liveSlotRecords(ctx)].reduce((sum, slot) => sum + slot.candidates.length, 0);
    console.log(`certify timing: ${candidates} candidates; cold ${Math.round(coldMs)} ms (${cold.misses} misses), warm ${Math.round(warmMs)} ms (${warm.hits} hits, ${warm.misses} misses)`);
    expect(warm.results.size).toBe(candidates);
    expect(cold.results.size).toBe(candidates);
    expect(warm.misses).toBe(0);
    expect(warm.hits).toBe(candidates);
    expect(warmMs).toBeLessThan(WARM_BUDGET_MS);
  }, 180_000);

  it("the certifier source reads no rung (R03.3) and no borrowed fixture (R05.3)", () => {
    const ctx = { root } as ConstitutionContext;
    expect(r03_3(ctx)).toEqual([]);
    expect(r05_3(ctx)).toEqual([]);
  });
});
