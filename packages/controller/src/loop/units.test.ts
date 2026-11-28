import { describe, expect, it } from "vitest";
import { unitRunStatus, UNIT_RUN_STALE_AFTER_MS } from "./staleness.js";
import { validateLoopState } from "./state.js";
import { emptyLoopState, failedCloudLaunches, markLatestLaunchFailed, recordUnitLaunch, refreshUnitRuns } from "./units.js";
import type { UnitRun } from "./types.js";

const launch = (overrides: Partial<UnitRun> = {}): UnitRun => ({
  unit: "CP1-EXAMPLE", env: "cloud", tier: "mid", at: "2026-11-28T10:00:00.000Z",
  branch: "claude/example", headAtLaunch: null, status: "launched", ...overrides,
});
const minutes = (count: number) => new Date(new Date("2026-11-28T10:00:00.000Z").getTime() + count * 60_000);

describe("the planner's launch log", () => {
  it("records a launch on the loop state, which stays valid", () => {
    const state = recordUnitLaunch(emptyLoopState("planner"), launch());
    expect(state.units?.["CP1-EXAMPLE"]).toHaveLength(1);
    expect(validateLoopState(state)).toEqual([]);
  });

  it("rejects a launch with an unknown env or a failed launch with no reason", () => {
    const state = recordUnitLaunch(emptyLoopState("planner"), launch({ env: "laptop" as never, status: "failed" }));
    const rules = validateLoopState(state).map((finding) => finding.path);
    expect(rules).toContain("units.CP1-EXAMPLE[0].env");
    expect(rules).toContain("units.CP1-EXAMPLE[0].reason");
  });

  it("counts failed cloud launches only", () => {
    let state = recordUnitLaunch(emptyLoopState("planner"), launch());
    state = markLatestLaunchFailed(state, "CP1-EXAMPLE", "preflight push refused").state;
    state = recordUnitLaunch(state, launch({ env: "local" }));
    state = markLatestLaunchFailed(state, "CP1-EXAMPLE", "lease lost").state;
    expect(failedCloudLaunches(state, "CP1-EXAMPLE")).toBe(1);
  });
});

describe("unit run staleness", () => {
  it("flags a launch with no pushed progress after 90 minutes as stale", () => {
    expect(UNIT_RUN_STALE_AFTER_MS).toBe(90 * 60_000);
    expect(unitRunStatus(launch(), minutes(89), null)).toBe("launched");
    expect(unitRunStatus(launch(), minutes(90), null)).toBe("stale");
    expect(unitRunStatus(launch({ headAtLaunch: "abc" }), minutes(200), "abc")).toBe("stale");
  });

  it("is progressed once the branch moved, whenever that was", () => {
    expect(unitRunStatus(launch(), minutes(200), "def")).toBe("progressed");
    expect(unitRunStatus(launch({ headAtLaunch: "abc", status: "stale" }), minutes(300), "def")).toBe("progressed");
  });

  it("refreshes every open launch and returns the stale ones", () => {
    let state = recordUnitLaunch(emptyLoopState("planner"), launch());
    state = recordUnitLaunch(state, launch({ unit: "CP1-OTHER", branch: "claude/other" }));
    const refreshed = refreshUnitRuns(state, minutes(95), (branch) => (branch === "claude/other" ? "f00" : null));
    expect(refreshed.stale.map((run) => run.unit)).toEqual(["CP1-EXAMPLE"]);
    expect(refreshed.state.units?.["CP1-OTHER"]?.[0]?.status).toBe("progressed");
  });
});
