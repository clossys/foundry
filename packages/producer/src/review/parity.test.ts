import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mechanicalVerdict, type MechanicalObservation } from "./review.js";

/**
 * Parity records: three mechanical results recorded before `clossys review` replaced the planner's own scripts (one
 * PASS, one FAIL on a new red, one base-red only), each with what this engine observed when run at the same head over
 * the same base (the related tests run alone at head and alone at the merge base, and the packet commands). The
 * review's own rules applied to that observation must give the recorded verdict and the recorded lists.
 */
interface ParityRecord {
  readonly id: string;
  readonly head: string;
  readonly base: string;
  readonly recorded: {
    readonly verdict: "PASS" | "FAIL";
    readonly newRed: readonly string[];
    /** The recorded base-red list, or null when the recorded result only says every head failure was base-red. */
    readonly baseRed: readonly string[] | null;
    readonly baseRedNonEmpty?: boolean;
    readonly commandReds: readonly string[];
  };
  readonly observed: MechanicalObservation;
  /** The lists this engine produced from the observation, pinned. */
  readonly observedNewRed: readonly string[];
  readonly observedBaseRed: readonly string[];
  /** Why observedNewRed differs from the recorded list, when it does (the engine ran tests the recording never ran). */
  readonly divergence?: string;
}

const DIR = new URL("./__fixtures__/parity/", import.meta.url);
const records = readdirSync(fileURLToPath(DIR)).filter(name => name.endsWith(".json")).sort()
  .map(name => JSON.parse(readFileSync(new URL(name, DIR), "utf8")) as ParityRecord);

describe("parity with the recorded mechanical results", () => {
  it("review matches the recorded mechanical verdicts", () => {
    expect(records.map(record => [record.id, record.recorded.verdict])).toEqual([["base-red-only", "PASS"], ["fail-new-red", "FAIL"], ["pass", "PASS"]]);
    for (const record of records) {
      const result = mechanicalVerdict(record.observed);
      expect(result.verdict, record.id).toBe(record.recorded.verdict);
      // Every recorded new red is found; a longer list is allowed only with a written divergence, and is pinned.
      expect(result.newRed, record.id).toEqual(expect.arrayContaining([...record.recorded.newRed]));
      expect(result.newRed, record.id).toEqual(record.observedNewRed);
      if (!record.divergence) expect(result.newRed, record.id).toEqual(record.recorded.newRed);
      expect(result.commandReds, record.id).toEqual(record.recorded.commandReds);
      if (record.recorded.baseRed) expect(result.baseRed, record.id).toEqual(record.recorded.baseRed);
      else if (record.recorded.baseRedNonEmpty !== undefined) expect(result.baseRed.length > 0, record.id).toBe(record.recorded.baseRedNonEmpty);
      expect(result.baseRed, record.id).toEqual(record.observedBaseRed);
      expect(record.observed.ran, record.id).toBeGreaterThan(0);
    }
  });
});
