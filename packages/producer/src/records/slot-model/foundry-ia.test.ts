/**
 * writerIa (foundry-build-0033 r1): the Writer's old five-layer store is retired as live IA, and slot-defaults.json
 * holds only the target leaves. A consumer that has not run the recut still places the old ids, so writerIa takes
 * each retired id's standard from the Writer's frozen retired-slot-defaults.json: `ia sync` reports no standard
 * drift on the fixture consumer and `--apply` strips no slot.json standard.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_CONSUMER } from "../../consumer-root.js";
import { writerIa } from "./foundry-ia.js";
import { refContext, syncDrift, syncPlan, syncState } from "./ia-sync.js";

const fixture = join(FIXTURE_CONSUMER, "clossys");

describe("writerIa", () => {
  it("gives every slot of the five-layer placement a standard from the Writer's own defaults", () => {
    const slots = [...writerIa().slots.values()];
    expect(slots).toHaveLength(137);
    expect(slots.filter(slot => typeof slot.defaults.standard !== "string").map(slot => slot.id)).toEqual([]);
  });

  it("ia sync --check on the fixture: no standard drift, Writer behaviour drift at most the 4 base rows", () => {
    const behaviour = syncDrift(fixture, "writer").filter(finding => finding.kind === "behaviour");
    expect(behaviour.filter(finding => /\bstandard\b/.test(finding.detail)).map(finding => finding.slot)).toEqual([]);
    expect(behaviour.length).toBeLessThanOrEqual(4);
  });

  it("ia sync --apply on the fixture strips no Writer slot.json standard", () => {
    const state = syncState(fixture, "writer");
    const plan = syncPlan(fixture, "writer", refContext(fixture, "writer", state).known, state);
    if ("error" in plan) throw new Error(plan.error);
    const stripped = plan.writes.filter(([file]) => file.endsWith("slot.json") && existsSync(file)).flatMap(([file, bytes]) => {
      const before = JSON.parse(readFileSync(file, "utf8")) as { id: string; standard?: unknown };
      const after = JSON.parse(bytes) as { standard?: unknown };
      return before.standard !== undefined && after.standard !== before.standard ? [before.id] : [];
    });
    expect(stripped).toEqual([]);
  });
});
