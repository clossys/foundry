import { describe, expect, it } from "vitest";
import { AT, cleanSpec, contextOf, expectCatches, sha, type WorkspaceSpec } from "../__fixtures__/workspace.js";
import { pinIssues, pinSchema } from "./R09-pin-schema.js";

const clean = () => contextOf(cleanSpec());
const broken = (edit: (spec: WorkspaceSpec) => void) => { const spec = cleanSpec(); edit(spec); return contextOf(spec); };
const base = { candidate: "button-v1.json", sha256: sha("x"), decidedBy: "planner", basis: "planner", at: AT };
const CONFIRMED = { by: "owner", ref: "clossys/workspace#46 issuecomment-123", at: AT };

describe("R09 one pin schema", () => {
  it("passes valid pins, Producer seats included", () => {
    expect(pinSchema(clean())).toEqual([]);
    expect(pinIssues(base)).toEqual([]);
    expect(pinIssues({ ...base, decidedBy: "agent:designer", basis: "agent", confirmed: CONFIRMED })).toEqual([]);
  });

  it("flags extra keys, missing keys, bad patterns and broken pairings", () => {
    expect(pinIssues({ ...base, recited: {} }).join("\n")).toMatch(/recited/);
    expect(pinIssues({ candidate: "button-v1.json" }).length).toBeGreaterThan(0);
    expect(pinIssues({ ...base, sha256: "abc" }).join("\n")).toMatch(/sha256/);
    expect(pinIssues({ ...base, basis: "agent" })).toContain("basis agent and decidedBy agent:<seat> go together");
    expect(pinIssues({ ...base, confirmed: CONFIRMED })).toContain("confirmed is only on an agent pick (basis agent)");
    expect(pinIssues({ ...base, at: "2026-13-45T99:99Z" })).toContain("at is not a real timestamp");
  });

  it("emits one row per invalid pin in every agent tree", () => {
    const rows = expectCatches(pinSchema, clean(), broken(spec => {
      spec.producer!.director!.pin = { ...base, candidate: "director-v1.json", owner: "calvin" };
      spec.writer!["home.hero"]!.pin = "not json" as unknown as Record<string, unknown>;
    }));
    expect(rows.map(row => `${row.agent}:${row.slot}`).sort()).toEqual(["producer:director", "writer:home.hero"]);
    expect(rows.find(row => row.agent === "writer")!.reason).toMatch(/unreadable/);
  });
});
