import { describe, expect, it } from "vitest";
import { gateResultToExitCode, isIndeterminate, isSatisfied, isViolated } from "../gates/result.js";
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

  it("is frozen", () => {
    expect(Object.isFrozen(LIVE_STATE_SURFACE_FINDING_KINDS)).toBe(true);
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

  // ---------------------------------------------------------------------
  // The proof #255 is actually about: a could-not-verify report can never
  // be read as a verified one, by any of the three ways a caller could try
  // to read "did this pass" off a LiveStateSubjectReport.
  // ---------------------------------------------------------------------
  describe("could-not-verify can never be read as verified", () => {
    const verified = liveStateVerified("subject-a");
    const couldNotVerify = liveStateCouldNotVerify("subject-a", "missing PACKAGES_READ_TOKEN credential");

    it("fails the type-narrowing guard a caller would branch on", () => {
      expect(isSatisfied(verified.result)).toBe(true);
      expect(isSatisfied(couldNotVerify.result)).toBe(false);
      expect(isIndeterminate(couldNotVerify.result)).toBe(true);
      expect(isViolated(couldNotVerify.result)).toBe(false);
    });

    it("fails the exit-code projection a CI gate would actually branch its pass/fail on", () => {
      // 0 = satisfied/clean, 1 = violated/findings, 2 = indeterminate/could
      // not run -- see gates/result.ts's own header. A caller who reduces a
      // LiveStateSubjectReport straight to this repository's real CI
      // pass/fail signal still cannot land on 0 for a could-not-verify
      // report: it is a distinct, always-nonzero exit code, never quietly
      // folded into the same "0 = fine" bucket a violated result also
      // avoids.
      expect(gateResultToExitCode(verified.result)).toBe(0);
      expect(gateResultToExitCode(couldNotVerify.result)).toBe(2);
      expect(gateResultToExitCode(couldNotVerify.result)).not.toBe(0);
    });

    it("carries no boolean field a careless caller could truthy-check into a false pass", () => {
      // The only field every LiveStateReconciliationResult carries in
      // common is `verdict`, a string literal union -- there is no `ok`,
      // `passed`, or `success` boolean anywhere on the shape that a caller
      // could accidentally treat as truthy for an indeterminate result.
      const keys = new Set(Object.keys(couldNotVerify.result));
      expect(keys.has("ok")).toBe(false);
      expect(keys.has("passed")).toBe(false);
      expect(keys.has("success")).toBe(false);
      expect(couldNotVerify.result.verdict).not.toBe("satisfied");
    });
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
    expect(isSatisfied(report.result)).toBe(false);
  });

  it("could-not-verify when an attempted read reports its own blocker", () => {
    const report = reconcileLiveState<string, string>({
      subject: "s",
      declared: { value: "1.0.0" },
      observation: { attempted: true, blocker: "API returned 500" },
      agrees: (a, b) => a === b,
    });
    expect(report.result.verdict).toBe("indeterminate");
    expect(isSatisfied(report.result)).toBe(false);
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

  // ---------------------------------------------------------------------
  // #313: declaredAt/liveObservedAt are compared as instants, not as
  // strings. Two ISO 8601 timestamps with different UTC offsets can
  // disagree about ordering when compared lexicographically even though
  // one is genuinely earlier -- see the module's own doc comment on
  // reconcileLiveState for the reproduction this guards against.
  // ---------------------------------------------------------------------
  describe("declaredAt/liveObservedAt are compared as instants, not strings", () => {
    it("catches a predate that a string comparison would miss (mixed offsets, direction 1)", () => {
      // "+02:00" is 07:00 UTC -- genuinely earlier than "08:00Z" -- but as
      // plain strings "09:00:00+02:00" > "08:00:00Z", so a naive `<` string
      // comparison would say the live artifact is NOT earlier. It is.
      const report = reconcileLiveState<string, string>({
        subject: "s",
        declared: { value: "1.0.0", declaredAt: "2026-08-10T08:00:00Z" },
        observation: {
          attempted: true,
          live: "1.0.0",
          liveObservedAt: "2026-08-10T09:00:00+02:00", // 07:00 UTC, earlier than declaredAt
        },
        agrees: (a, b) => a === b,
      });
      expect(report.result.verdict).toBe("violated");
      if (report.result.verdict === "violated") {
        expect(report.result.findings.map((f) => f.kind)).toEqual(["live-artifact-predates-its-declaration"]);
      }
    });

    it("does not false-positive a predate a string comparison would wrongly claim (mixed offsets, direction 2)", () => {
      // Same two clock-face strings as the previous test, roles reversed:
      // the live artifact's instant (08:00 UTC) is actually AFTER the
      // declaration's instant (07:00 UTC, written with a "+02:00" offset).
      // A naive string comparison of "08:00:00Z" < "09:00:00+02:00" is
      // true (lexicographically, "08" < "09"), so a buggy string-comparing
      // implementation would wrongly report a predate here. It is not one.
      const report = reconcileLiveState<string, string>({
        subject: "s",
        declared: { value: "1.0.0", declaredAt: "2026-08-10T09:00:00+02:00" }, // 07:00 UTC
        observation: {
          attempted: true,
          live: "1.0.0",
          liveObservedAt: "2026-08-10T08:00:00Z", // 08:00 UTC, later than declaredAt
        },
        agrees: (a, b) => a === b,
      });
      expect(report.result.verdict).toBe("satisfied");
    });

    it("treats identical instants written with different offset spellings as equal, not a predate", () => {
      const report = reconcileLiveState<string, string>({
        subject: "s",
        declared: { value: "1.0.0", declaredAt: "2026-08-10T08:00:00+00:00" },
        observation: { attempted: true, live: "1.0.0", liveObservedAt: "2026-08-10T08:00:00Z" },
        agrees: (a, b) => a === b,
      });
      expect(report.result.verdict).toBe("satisfied");
    });

    it("compares fractional seconds correctly", () => {
      const report = reconcileLiveState<string, string>({
        subject: "s",
        declared: { value: "1.0.0", declaredAt: "2026-08-10T08:00:00.500Z" },
        observation: {
          attempted: true,
          live: "1.0.0",
          liveObservedAt: "2026-08-10T08:00:00.100Z", // earlier by 400ms
        },
        agrees: (a, b) => a === b,
      });
      expect(report.result.verdict).toBe("violated");
      if (report.result.verdict === "violated") {
        expect(report.result.findings.map((f) => f.kind)).toEqual(["live-artifact-predates-its-declaration"]);
      }
    });

    it("does not flag a predate when fractional-second ordering is the other way", () => {
      const report = reconcileLiveState<string, string>({
        subject: "s",
        declared: { value: "1.0.0", declaredAt: "2026-08-10T08:00:00.100Z" },
        observation: { attempted: true, live: "1.0.0", liveObservedAt: "2026-08-10T08:00:00.500Z" },
        agrees: (a, b) => a === b,
      });
      expect(report.result.verdict).toBe("satisfied");
    });

    // -----------------------------------------------------------------
    // An unparseable timestamp is reported as a `declared-but-not-
    // verifiable` FINDING, not as an outcome-level `could-not-verify`
    // returned early -- an early return there would discard whatever
    // `agrees` already found. But the finding's KIND, not merely its
    // presence, decides the verdict: alongside a real drift finding it
    // rides in a `drifted` report; on its own -- values agree, only the
    // timestamp is unparseable -- nothing was actually confirmed wrong,
    // so the subject is `indeterminate`, never a manufactured `violated`.
    // See reconcileLiveState's own doc comment for why both directions
    // matter: a confirmed finding must never read as unverified, and an
    // unverifiable dimension must never read as a confirmed violation.
    // -----------------------------------------------------------------

    it("is indeterminate -- never violated -- when values agree and only declaredAt is unparseable", () => {
      const report = reconcileLiveState<string, string>({
        subject: "s",
        declared: { value: "1.0.0", declaredAt: "not-a-real-timestamp" },
        observation: { attempted: true, live: "1.0.0", liveObservedAt: "2026-08-10T08:00:00Z" },
        agrees: (a, b) => a === b,
      });
      expect(report.result.verdict).toBe("indeterminate");
      expect(isIndeterminate(report.result)).toBe(true);
      expect(isViolated(report.result)).toBe(false);
      expect(isSatisfied(report.result)).toBe(false);
      expect(gateResultToExitCode(report.result)).toBe(2);
      if (report.result.verdict === "indeterminate") {
        expect(report.result.reason).toBe("declared-but-not-verifiable");
        expect(report.result.detail).toContain("declaredAt");
        expect(report.result.detail).toContain("not-a-real-timestamp");
      }
    });

    it("is indeterminate -- never violated -- when values agree and only liveObservedAt is unparseable", () => {
      const report = reconcileLiveState<string, string>({
        subject: "s",
        declared: { value: "1.0.0", declaredAt: "2026-08-10T08:00:00Z" },
        observation: { attempted: true, live: "1.0.0", liveObservedAt: "also-not-a-timestamp" },
        agrees: (a, b) => a === b,
      });
      expect(report.result.verdict).toBe("indeterminate");
      expect(isIndeterminate(report.result)).toBe(true);
      expect(isViolated(report.result)).toBe(false);
      expect(isSatisfied(report.result)).toBe(false);
      expect(gateResultToExitCode(report.result)).toBe(2);
      if (report.result.verdict === "indeterminate") {
        expect(report.result.reason).toBe("declared-but-not-verifiable");
        expect(report.result.detail).toContain("liveObservedAt");
        expect(report.result.detail).toContain("also-not-a-timestamp");
      }
    });

    it("is indeterminate -- never violated -- when values agree and both timestamps are unparseable", () => {
      const report = reconcileLiveState<string, string>({
        subject: "s",
        declared: { value: "1.0.0", declaredAt: "bogus-declared" },
        observation: { attempted: true, live: "1.0.0", liveObservedAt: "bogus-live" },
        agrees: (a, b) => a === b,
      });
      expect(report.result.verdict).toBe("indeterminate");
      expect(isIndeterminate(report.result)).toBe(true);
      expect(isViolated(report.result)).toBe(false);
      if (report.result.verdict === "indeterminate") {
        expect(report.result.reason).toBe("declared-but-not-verifiable");
        expect(report.result.detail).toContain("bogus-declared");
        expect(report.result.detail).toContain("bogus-live");
      }
    });

    it("an unverifiable-only timestamp is never read as satisfied through any of the three ways a caller could check", () => {
      // The same proof the #255 could-not-verify suite runs above for the
      // outcome-level case, run again here for the case reached only
      // through the finding-level path: a subject whose *values* agree
      // but whose declaredAt/liveObservedAt is garbage must not be
      // readable as "passed" by type-narrowing, by the CI exit-code
      // projection, or by a truthy-checked boolean field.
      const report = reconcileLiveState<string, string>({
        subject: "s",
        declared: { value: "1.0.0", declaredAt: "garbage" },
        observation: { attempted: true, live: "1.0.0", liveObservedAt: "2026-08-10T08:00:00Z" },
        agrees: (a, b) => a === b,
      });
      expect(isSatisfied(report.result)).toBe(false);
      expect(isIndeterminate(report.result)).toBe(true);
      expect(isViolated(report.result)).toBe(false);
      expect(gateResultToExitCode(report.result)).toBe(2);
      expect(gateResultToExitCode(report.result)).not.toBe(0);
      const keys = new Set(Object.keys(report.result));
      expect(keys.has("ok")).toBe(false);
      expect(keys.has("passed")).toBe(false);
      expect(keys.has("success")).toBe(false);
    });

    it("exit code 2 is reachable from reconcileLiveState -- the unverifiable-timestamp-only path is the only one that produces it here", () => {
      // reconcileLiveState's other two indeterminate paths (observation
      // never attempted, or attempted with its own blocker) are exercised
      // above under "could-not-verify when the read was never attempted"
      // and "...reports its own blocker". This pins that the THIRD path
      // introduced by this fix -- a completed read whose declaredAt/
      // liveObservedAt could not be parsed, with no other drift found --
      // also reaches the same distinct, non-zero exit code, not a
      // reused/aliased 1 or a silent 0.
      const report = reconcileLiveState<string, string>({
        subject: "s",
        declared: { value: "1.0.0", declaredAt: "2026-08-10T08:00:00Z" },
        observation: { attempted: true, live: "1.0.0", liveObservedAt: "unparseable" },
        agrees: (a, b) => a === b,
      });
      expect(gateResultToExitCode(report.result)).toBe(2);
    });

    // -----------------------------------------------------------------
    // The regression this section exists to pin: a subject with BOTH a
    // real value mismatch AND an unparseable timestamp must report BOTH
    // findings, and the verdict must be `drifted` -- a real drift finding
    // always wins the verdict, carrying the unverifiable one alongside
    // it. An early `return liveStateCouldNotVerify(...)` from inside the
    // timestamp block would discard the mismatch finding `agrees` already
    // collected -- exactly the defect a prior version of this fix had.
    // -----------------------------------------------------------------

    it("does not lose an already-found live-differs-from-declared finding when declaredAt is also unparseable", () => {
      const report = reconcileLiveState<string, string>({
        subject: "s",
        declared: { value: "1.0.0", declaredAt: "not-a-real-timestamp" },
        observation: { attempted: true, live: "2.0.0", liveObservedAt: "2026-08-10T08:00:00Z" },
        agrees: (a, b) => a === b,
      });
      expect(report.result.verdict).toBe("violated");
      if (report.result.verdict === "violated") {
        expect(report.result.findings.map((f) => f.kind).sort()).toEqual(
          ["declared-but-not-verifiable", "live-differs-from-declared"].sort(),
        );
        // The unverifiable dimension rides alongside the confirmed drift
        // rather than replacing it -- both facts survive in one report.
        expect(report.result.findings.some((f) => f.kind === "declared-but-not-verifiable")).toBe(true);
        expect(report.result.findings.some((f) => f.kind === "live-differs-from-declared")).toBe(true);
      }
    });

    it("does not lose an already-found live-differs-from-declared finding when liveObservedAt is also unparseable", () => {
      const report = reconcileLiveState<string, string>({
        subject: "s",
        declared: { value: "1.0.0", declaredAt: "2026-08-10T08:00:00Z" },
        observation: { attempted: true, live: "2.0.0", liveObservedAt: "also-not-a-timestamp" },
        agrees: (a, b) => a === b,
      });
      expect(report.result.verdict).toBe("violated");
      if (report.result.verdict === "violated") {
        expect(report.result.findings.map((f) => f.kind).sort()).toEqual(
          ["declared-but-not-verifiable", "live-differs-from-declared"].sort(),
        );
        expect(report.result.findings.some((f) => f.kind === "declared-but-not-verifiable")).toBe(true);
        expect(report.result.findings.some((f) => f.kind === "live-differs-from-declared")).toBe(true);
      }
    });

    it("does not lose an already-found live-differs-from-declared finding when both timestamps are unparseable", () => {
      const report = reconcileLiveState<string, string>({
        subject: "s",
        declared: { value: "1.0.0", declaredAt: "bogus-declared" },
        observation: { attempted: true, live: "2.0.0", liveObservedAt: "bogus-live" },
        agrees: (a, b) => a === b,
      });
      expect(report.result.verdict).toBe("violated");
      if (report.result.verdict === "violated") {
        expect(report.result.findings.map((f) => f.kind).sort()).toEqual(
          ["declared-but-not-verifiable", "live-differs-from-declared"].sort(),
        );
        expect(report.result.findings.some((f) => f.kind === "declared-but-not-verifiable")).toBe(true);
        expect(report.result.findings.some((f) => f.kind === "live-differs-from-declared")).toBe(true);
      }
    });
  });
});
