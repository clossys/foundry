import { describe, expect, it } from "vitest";
import { foldLiveStateReports } from "./report.js";
import { liveStateCouldNotVerify, liveStateDrifted, liveStateVerified } from "../live-state.js";

describe("foldLiveStateReports", () => {
  it("folds to satisfied/exit 0 when every subject verifies", () => {
    const report = foldLiveStateReports([liveStateVerified("a"), liveStateVerified("b")]);
    expect(report.overall.verdict).toBe("satisfied");
    expect(report.exitCode).toBe(0);
    expect(report.rows).toHaveLength(2);
  });

  it("folds to violated/exit 1 when a subject drifted and none could-not-verify", () => {
    const report = foldLiveStateReports([
      liveStateVerified("a"),
      liveStateDrifted("b", [{ kind: "declared-but-not-live", subject: "b", message: "gone" }]),
    ]);
    expect(report.overall.verdict).toBe("violated");
    expect(report.exitCode).toBe(1);
  });

  it("folds to indeterminate/exit 2 when any subject could not be verified -- indeterminate dominates", () => {
    const report = foldLiveStateReports([
      liveStateDrifted("a", [{ kind: "declared-but-not-live", subject: "a", message: "gone" }]),
      liveStateCouldNotVerify("b", "no credential"),
    ]);
    expect(report.overall.verdict).toBe("indeterminate");
    expect(report.exitCode).toBe(2);
  });

  it("folds an empty run to indeterminate/exit 2 -- reconciling nothing is not a pass", () => {
    const report = foldLiveStateReports([]);
    expect(report.overall.verdict).toBe("indeterminate");
    expect(report.exitCode).toBe(2);
    if (report.overall.verdict === "indeterminate") {
      expect(report.overall.reason).toBe("no-subjects-reconciled");
    }
  });
});
