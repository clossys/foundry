import { describe, expect, it } from "vitest";
import { isLifecycleCondition, isLifecycleStatus, LIFECYCLE_CONDITIONS, LIFECYCLE_STATUSES } from "./lifecycle.js";

describe("lifecycle vocabulary (#1228)", () => {
  // This is the local copy's premise guard: issue #1228 records these exact
  // six statuses and three conditions as the one shared vocabulary. If a
  // future edit to this file drifts from that list, this test — not a
  // downstream consumer discovering mismatched words — is what should fail.
  it("matches issue #1228's statuses exactly, in its own order", () => {
    expect(LIFECYCLE_STATUSES).toEqual(["absent", "found", "draft", "approved", "verified", "retired"]);
  });

  it("matches issue #1228's conditions exactly, in its own order", () => {
    expect(LIFECYCLE_CONDITIONS).toEqual(["current", "stale", "blocked"]);
  });

  it("does not admit the retired pack-specific words #1228 folds away", () => {
    for (const retired of ["in-review", "kept", "published"]) {
      expect(isLifecycleStatus(retired)).toBe(false);
    }
  });

  it("type guards accept only list members", () => {
    for (const status of LIFECYCLE_STATUSES) expect(isLifecycleStatus(status)).toBe(true);
    for (const condition of LIFECYCLE_CONDITIONS) expect(isLifecycleCondition(condition)).toBe(true);
    expect(isLifecycleStatus("not-a-status")).toBe(false);
    expect(isLifecycleCondition("not-a-condition")).toBe(false);
    expect(isLifecycleStatus(undefined)).toBe(false);
    expect(isLifecycleCondition(42)).toBe(false);
  });
});
