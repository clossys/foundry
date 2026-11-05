import { describe, expect, it } from "vitest";
import { CONTENT_STAGES, STAGE_STATUSES, rollUpStageStatuses } from "./stages.js";

describe("stage vocabulary and worst-wins aggregation", () => {
  it("exposes exactly five stages and five statuses", () => {
    expect(CONTENT_STAGES).toEqual(["Define", "Assemble", "Review", "Approve", "Publish"]);
    expect(STAGE_STATUSES).toEqual(["Failing", "Needs input", "Waiting", "Done", "Not applicable"]);
    expect(Object.isFrozen(CONTENT_STAGES)).toBe(true);
    expect(Object.isFrozen(STAGE_STATUSES)).toBe(true);
  });
  it.each([
    ["Failing", ["Done", "Failing", "Needs input", "Waiting"]],
    ["Needs input", ["Done", "Waiting", "Needs input"]],
    ["Waiting", ["Done", "Waiting"]],
    ["Done", ["Not applicable", "Done"]],
    ["Not applicable", ["Not applicable"]],
    ["Not applicable", []],
  ] as const)("rolls up to %s", (expected, values) => {
    expect(rollUpStageStatuses(values)).toBe(expected);
    expect(rollUpStageStatuses([...values].reverse())).toBe(expected);
  });
  it("rejects unrecognized runtime statuses", () => {
    expect(() => rollUpStageStatuses(["green" as "Done"])).toThrow();
  });
});
