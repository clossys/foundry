import { describe, expect, it } from "vitest";
import { computeUnobservedSurface, type DeclaredSubject, type SubjectTelemetryRead } from "./unobserved-surface.js";

const declared: readonly DeclaredSubject[] = [
  { id: "gate:secret-scan" },
  { id: "gate:task-record" },
  { id: "gate:policy-drift" },
  { id: "gate:review-evidence" },
];

describe("computeUnobservedSurface", () => {
  it("sorts declared subjects into observed / unobserved / could-not-read", () => {
    const reads: readonly SubjectTelemetryRead[] = [
      { subject: "gate:secret-scan", presence: { state: "observed", eventCount: 12 } },
      { subject: "gate:task-record", presence: { state: "unobserved" } },
      { subject: "gate:policy-drift", presence: { state: "could-not-read", note: "no credential" } },
      // gate:review-evidence has no read at all.
    ];

    const report = computeUnobservedSurface(declared, reads);

    expect(report.declaredCount).toBe(4);
    expect(report.observed).toEqual(["gate:secret-scan"]);
    expect(report.unobserved).toEqual(["gate:task-record"]);
    expect(report.couldNotRead.sort()).toEqual(["gate:policy-drift", "gate:review-evidence"].sort());
  });

  it("treats a subject with no read supplied as could-not-read, never as unobserved", () => {
    // This is the structural guard: "nobody checked" must never silently
    // become "checked, and found nothing."
    const report = computeUnobservedSurface([{ id: "gate:never-read" }], []);
    expect(report.couldNotRead).toEqual(["gate:never-read"]);
    expect(report.unobserved).toEqual([]);
  });

  it("returns empty lists for an empty declared set", () => {
    const report = computeUnobservedSurface([], []);
    expect(report).toEqual({
      kind: "unobserved-surface",
      declaredCount: 0,
      observed: [],
      unobserved: [],
      couldNotRead: [],
    });
  });

  it("ignores a read for a subject that was never declared", () => {
    const reads: readonly SubjectTelemetryRead[] = [
      { subject: "gate:not-declared", presence: { state: "observed", eventCount: 1 } },
    ];
    const report = computeUnobservedSurface([{ id: "gate:secret-scan" }], reads);
    expect(report.observed).toEqual([]);
    expect(report.couldNotRead).toEqual(["gate:secret-scan"]);
  });
});
