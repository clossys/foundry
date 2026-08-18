import { describe, expect, it } from "vitest";
import {
  LIVE_STATE_SURFACE_FINDING_KINDS,
  liveStateCouldNotVerify,
  liveStateDrifted,
  liveStateVerified,
  reconcileLiveState,
  validateLiveStateSurfaceDeclaration,
} from "./live-state.js";
import type { LiveStateSurfaceDeclaration } from "./live-state.js";

describe("LIVE_STATE_SURFACE_FINDING_KINDS", () => {
  it("names all five kinds, including declared-but-not-verifiable", () => {
    expect([...LIVE_STATE_SURFACE_FINDING_KINDS]).toEqual([
      "declared-but-not-live",
      "live-but-not-declared",
      "live-differs-from-declared",
      "live-artifact-predates-its-declaration",
      "declared-but-not-verifiable",
    ]);
  });
});

describe("liveStateVerified / liveStateDrifted / liveStateCouldNotVerify", () => {
  it("verified is satisfied with a positive evaluated count", () => {
    const report = liveStateVerified("subject-a");
    expect(report.subject).toBe("subject-a");
    expect(report.result.verdict).toBe("satisfied");
  });

  it("drifted requires non-empty findings", () => {
    expect(() => liveStateDrifted("subject-a", [])).toThrow();
    const report = liveStateDrifted("subject-a", [
      { kind: "declared-but-not-live", subject: "subject-a", message: "gone" },
    ]);
    expect(report.result.verdict).toBe("violated");
  });

  it("could-not-verify refuses a missing or empty blocker -- never a silent pass", () => {
    expect(() => liveStateCouldNotVerify("subject-a", "")).toThrow();
    expect(() => liveStateCouldNotVerify("subject-a", "   ")).toThrow();
  });

  it("could-not-verify carries the named blocker as detail, with the declared reason", () => {
    const report = liveStateCouldNotVerify("subject-a", "missing PACKAGES_READ_TOKEN credential");
    expect(report.result.verdict).toBe("indeterminate");
    if (report.result.verdict === "indeterminate") {
      expect(report.result.reason).toBe("declared-but-not-verifiable");
      expect(report.result.detail).toBe("missing PACKAGES_READ_TOKEN credential");
    }
  });

  it("the three constructors are the only way to reach the three outcomes -- a two-state result cannot be built", () => {
    // gateSatisfied/gateViolated/createGateReasons().indeterminate are the
    // only producers of a GateResult; there is no fourth constructor here
    // and no boolean shortcut anywhere in this module's exports.
    const outcomes = new Set([
      liveStateVerified("s").result.verdict,
      liveStateDrifted("s", [{ kind: "declared-but-not-live", subject: "s", message: "m" }]).result.verdict,
      liveStateCouldNotVerify("s", "blocker").result.verdict,
    ]);
    expect(outcomes).toEqual(new Set(["satisfied", "violated", "indeterminate"]));
  });
});

describe("reconcileLiveState", () => {
  it("throws when neither declared nor live is present -- caller error, not a finding", () => {
    expect(() =>
      reconcileLiveState({
        subject: "s",
        observation: { attempted: true },
        agrees: () => true,
      }),
    ).toThrow();
  });

  it("could-not-verify when the read was never attempted", () => {
    const report = reconcileLiveState<string, string>({
      subject: "s",
      declared: { value: "1.0.0" },
      observation: { attempted: false, blocker: "no credential" },
      agrees: (a, b) => a === b,
    });
    expect(report.result.verdict).toBe("indeterminate");
  });

  it("could-not-verify when an attempted read reports its own blocker", () => {
    const report = reconcileLiveState<string, string>({
      subject: "s",
      declared: { value: "1.0.0" },
      observation: { attempted: true, blocker: "API returned 500" },
      agrees: (a, b) => a === b,
    });
    expect(report.result.verdict).toBe("indeterminate");
  });

  it("live-but-not-declared when live exists with no declaration", () => {
    const report = reconcileLiveState<string, string>({
      subject: "s",
      observation: { attempted: true, live: "1.0.0" },
      agrees: (a, b) => a === b,
    });
    expect(report.result.verdict).toBe("violated");
    if (report.result.verdict === "violated") {
      expect(report.result.findings[0]?.kind).toBe("live-but-not-declared");
    }
  });

  it("declared-but-not-live when nothing was found live", () => {
    const report = reconcileLiveState<string, string>({
      subject: "s",
      declared: { value: "1.0.0" },
      observation: { attempted: true },
      agrees: (a, b) => a === b,
    });
    expect(report.result.verdict).toBe("violated");
    if (report.result.verdict === "violated") {
      expect(report.result.findings[0]?.kind).toBe("declared-but-not-live");
    }
  });

  it("live-differs-from-declared when both exist and disagree", () => {
    const report = reconcileLiveState<string, string>({
      subject: "s",
      declared: { value: "1.0.0" },
      observation: { attempted: true, live: "2.0.0" },
      agrees: (a, b) => a === b,
    });
    expect(report.result.verdict).toBe("violated");
    if (report.result.verdict === "violated") {
      expect(report.result.findings.map((f) => f.kind)).toContain("live-differs-from-declared");
    }
  });

  it("live-artifact-predates-its-declaration alongside agreement", () => {
    const report = reconcileLiveState<string, string>({
      subject: "s",
      declared: { value: "1.0.0", declaredAt: "2026-08-10T00:00:00Z" },
      observation: { attempted: true, live: "1.0.0", liveObservedAt: "2026-08-01T00:00:00Z" },
      agrees: (a, b) => a === b,
    });
    expect(report.result.verdict).toBe("violated");
    if (report.result.verdict === "violated") {
      expect(report.result.findings.map((f) => f.kind)).toEqual(["live-artifact-predates-its-declaration"]);
    }
  });

  it("verified when both exist, agree, and no predate issue", () => {
    const report = reconcileLiveState<string, string>({
      subject: "s",
      declared: { value: "1.0.0" },
      observation: { attempted: true, live: "1.0.0" },
      agrees: (a, b) => a === b,
    });
    expect(report.result.verdict).toBe("satisfied");
  });
});

describe("validateLiveStateSurfaceDeclaration", () => {
  const base: LiveStateSurfaceDeclaration = {
    store: "the GitHub Actions branch-protection API",
    readableByScript: true,
    readableBy: "policy-drift.mjs",
    note: "A green run here is not evidence this is live -- only policy-drift.mjs reading the real API says that.",
  };

  it("accepts a well-formed declaration", () => {
    expect(validateLiveStateSurfaceDeclaration(base)).toEqual([]);
  });

  it("requires store", () => {
    const findings = validateLiveStateSurfaceDeclaration({ ...base, store: "" });
    expect(findings.some((f) => f.rule === "live-state/missing-store")).toBe(true);
  });

  it("requires readableByScript to be an explicit boolean", () => {
    const findings = validateLiveStateSurfaceDeclaration({
      ...base,
      readableByScript: undefined as unknown as boolean,
    });
    expect(findings.some((f) => f.rule === "live-state/readable-by-script-not-boolean")).toBe(true);
  });

  it("requires readableBy when readableByScript is true", () => {
    const findings = validateLiveStateSurfaceDeclaration({ ...base, readableBy: undefined });
    expect(findings.some((f) => f.rule === "live-state/missing-readable-by")).toBe(true);
  });

  it("requires reconciledBy when readableByScript is false", () => {
    const findings = validateLiveStateSurfaceDeclaration({
      store: base.store,
      readableByScript: false,
      note: base.note,
    });
    expect(findings.some((f) => f.rule === "live-state/missing-reconciled-by")).toBe(true);
  });

  it("accepts readableByScript: false with reconciledBy", () => {
    const findings = validateLiveStateSurfaceDeclaration({
      store: base.store,
      readableByScript: false,
      reconciledBy: "the quarterly access review",
      note: base.note,
    });
    expect(findings).toEqual([]);
  });

  it("requires note", () => {
    const findings = validateLiveStateSurfaceDeclaration({ ...base, note: "" });
    expect(findings.some((f) => f.rule === "live-state/missing-note")).toBe(true);
  });

  it("requires note to state that a green check is not evidence of live state", () => {
    const findings = validateLiveStateSurfaceDeclaration({ ...base, note: "This is checked in CI." });
    expect(findings.some((f) => f.rule === "live-state/note-missing-caveat")).toBe(true);
  });
});
