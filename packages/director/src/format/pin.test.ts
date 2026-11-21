import { describe, expect, it } from "vitest";
import { pinIssues } from "./pin.js";

const AT = "2026-11-21T00:00:00Z";
const base = { candidate: "hero-v1.json", sha256: "a".repeat(64), decidedBy: "planner", basis: "planner", at: AT };
const confirmed = { by: "owner", ref: "clossys/workspace#46 issuecomment-1", at: AT };

describe("DET-STEPS pin rules: code pins pair with basis scorecard and take the owner's confirmation", () => {
  it("passes a code pin, unconfirmed or owner-confirmed, and an agent pick", () => {
    expect(pinIssues({ ...base, decidedBy: "code:scorecard", basis: "scorecard" })).toEqual([]);
    expect(pinIssues({ ...base, decidedBy: "code:scorecard", basis: "scorecard", confirmed })).toEqual([]);
    expect(pinIssues({ ...base, decidedBy: "agent:designer", basis: "agent", confirmed })).toEqual([]);
  });

  it("refuses a broken scorecard pairing and a confirmation on an owner or planner pin", () => {
    expect(pinIssues({ ...base, decidedBy: "code:scorecard" }).join()).toMatch(/basis scorecard and decidedBy code:scorecard go together/);
    expect(pinIssues({ ...base, basis: "scorecard" }).join()).toMatch(/basis scorecard and decidedBy code:scorecard go together/);
    expect(pinIssues({ ...base, confirmed }).join()).toMatch(/confirmed is only on an agent or code pick/);
    expect(pinIssues({ ...base, decidedBy: "owner", basis: "bulk", confirmed }).join()).toMatch(/confirmed is only on an agent or code pick/);
  });
});
