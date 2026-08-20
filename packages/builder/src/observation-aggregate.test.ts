import { describe, expect, it } from "vitest";
import { aggregateObservations, checkObservationAggregateFreshness } from "./observation-aggregate.js";
import { writeObservationBundle } from "./observation-bundle.js";
import type { ObservationBundleGateEntry } from "./observation-bundle.js";

const NOW = "2026-08-18T12:00:00.000Z";
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

function satisfiedGate(gateId: string): ObservationBundleGateEntry {
  return { gateId, result: { verdict: "satisfied", evaluated: 1 } };
}

function violatedGate(gateId: string): ObservationBundleGateEntry {
  return {
    gateId,
    result: { verdict: "violated", findings: [{ rule: "example/rule", severity: "high", message: "broke" }] },
  };
}

function bundleFor(repositoryId: string, gates: ObservationBundleGateEntry[], producedAt = NOW): unknown {
  return JSON.parse(writeObservationBundle({ repository: { id: repositoryId }, producedAt, gates }));
}

describe("aggregateObservations", () => {
  it("all-satisfied path: every expected repository observed, fresh, and clean folds to overall satisfied", () => {
    const result = aggregateObservations({
      expectedRepositories: ["repo-a", "repo-b"],
      bundles: [bundleFor("repo-a", [satisfiedGate("secret-scan")]), bundleFor("repo-b", [satisfiedGate("secret-scan")])],
      now: NOW,
      staleAfterMs: ONE_HOUR_MS,
      maxResultAgeMs: ONE_DAY_MS,
    });

    expect(result.overall.verdict).toBe("satisfied");
    expect(result.expectedCount).toBe(2);
    expect(result.receivedCount).toBe(2);
    expect(result.unobservedRepositories).toEqual([]);
    expect(result.repositories.map((status) => status.result.verdict)).toEqual(["satisfied", "satisfied"]);
  });

  it("empty bundle list: never satisfied, always indeterminate", () => {
    const result = aggregateObservations({
      expectedRepositories: ["repo-a", "repo-b", "repo-c"],
      bundles: [],
      now: NOW,
      staleAfterMs: ONE_HOUR_MS,
      maxResultAgeMs: ONE_DAY_MS,
    });

    expect(result.overall.verdict).toBe("indeterminate");
    expect(result.receivedCount).toBe(0);
    expect(result.unobservedRepositories).toEqual(["repo-a", "repo-b", "repo-c"]);
    expect(result.repositories.every((status) => status.result.verdict === "indeterminate")).toBe(true);
  });

  it("truly empty aggregation (no expected repositories, no bundles) is still indeterminate, never satisfied", () => {
    const result = aggregateObservations({ expectedRepositories: [], bundles: [], now: NOW, staleAfterMs: 0, maxResultAgeMs: 0 });
    expect(result.overall.verdict).toBe("indeterminate");
    expect(result.repositories).toEqual([]);
  });

  it("expected-count vs received-count mismatch is explicit, and unobserved repositories are named, not folded into a footnote", () => {
    const result = aggregateObservations({
      expectedRepositories: ["repo-a", "repo-b", "repo-c", "repo-d", "repo-e"],
      bundles: [bundleFor("repo-a", [satisfiedGate("secret-scan")]), bundleFor("repo-b", [satisfiedGate("secret-scan")]), bundleFor("repo-c", [satisfiedGate("secret-scan")])],
      now: NOW,
      staleAfterMs: ONE_HOUR_MS,
      maxResultAgeMs: ONE_DAY_MS,
    });

    expect(result.expectedCount).toBe(5);
    expect(result.receivedCount).toBe(3);
    expect(result.unobservedRepositories).toEqual(["repo-d", "repo-e"]);
    expect(result.overall.verdict).toBe("indeterminate");
    if (result.overall.verdict === "indeterminate") {
      expect(result.overall.reason).toBe("unobserved-repository");
    }
  });

  it("schema-invalid bundle: reported as indeterminate for the repository it claims to be about, never omitted", () => {
    const result = aggregateObservations({
      expectedRepositories: ["repo-a"],
      bundles: [{ schemaVersion: 1, repository: { id: "repo-a" }, producedAt: NOW, gates: [] }],
      now: NOW,
      staleAfterMs: ONE_HOUR_MS,
      maxResultAgeMs: ONE_DAY_MS,
    });

    expect(result.repositories).toHaveLength(1);
    const [status] = result.repositories;
    expect(status?.result.verdict).toBe("indeterminate");
    if (status?.result.verdict === "indeterminate") {
      expect(status.result.reason).toBe("invalid-bundle-schema");
    }
    expect(result.receivedCount).toBe(0);
  });

  it("a bundle that cannot even be FORMATTED (BigInt schemaVersion) never crashes the whole aggregation -- one bad repository stays indeterminate, every other repository still reports", () => {
    // Constructed directly, not via bundleFor/writeObservationBundle: JSON has no BigInt
    // literal, so this can only arise from a caller handing in-memory data straight to
    // aggregateObservations (exactly what its own module header says it accepts) rather
    // than something round-tripped through JSON.parse. This is the regression for the
    // defect where JSON.stringify(1n) inside a validation-diagnostic message threw,
    // taking parseObservationBundle -- and therefore the ENTIRE aggregateObservations
    // call, including every unrelated repository's result -- down with it.
    const malformedBundle = {
      schemaVersion: 1n,
      repository: { id: "repo-bad" },
      producedAt: NOW,
      gates: [satisfiedGate("secret-scan")],
    };

    let result: ReturnType<typeof aggregateObservations>;
    expect(() => {
      result = aggregateObservations({
        expectedRepositories: ["repo-a", "repo-bad", "repo-c"],
        bundles: [bundleFor("repo-a", [satisfiedGate("secret-scan")]), malformedBundle, bundleFor("repo-c", [satisfiedGate("secret-scan")])],
        now: NOW,
        staleAfterMs: ONE_HOUR_MS,
        maxResultAgeMs: ONE_DAY_MS,
      });
    }).not.toThrow();

    const byRepository = new Map(result!.repositories.map((status) => [status.repositoryId, status]));
    expect(byRepository.get("repo-a")?.result.verdict).toBe("satisfied");
    expect(byRepository.get("repo-c")?.result.verdict).toBe("satisfied");
    const bad = byRepository.get("repo-bad");
    expect(bad?.result.verdict).toBe("indeterminate");
    if (bad?.result.verdict === "indeterminate") {
      expect(bad.result.reason).toBe("invalid-bundle-schema");
      expect(bad.result.detail).toContain("1n");
    }
    // One indeterminate repository still makes the overall report indeterminate
    // (fail-closed precedence) -- but it does not erase the other two repositories'
    // real, individually-reported results.
    expect(result!.overall.verdict).toBe("indeterminate");
  });

  it("stale bundle: reported indeterminate with a legible reason, using caller-supplied now/threshold", () => {
    const twoHoursAgo = "2026-08-18T10:00:00.000Z";
    const result = aggregateObservations({
      expectedRepositories: ["repo-a"],
      bundles: [bundleFor("repo-a", [satisfiedGate("secret-scan")], twoHoursAgo)],
      now: NOW,
      staleAfterMs: ONE_HOUR_MS,
      maxResultAgeMs: ONE_DAY_MS,
    });

    const [status] = result.repositories;
    expect(status?.result.verdict).toBe("indeterminate");
    if (status?.result.verdict === "indeterminate") {
      expect(status.result.reason).toBe("stale-observation");
      expect(status.result.detail).toContain("repo-a");
      expect(status.result.detail).toContain("staleness threshold");
    }
  });

  it("a bundle stamped AFTER now is indeterminate, not fresh -- the same negative-age hole, one level down", () => {
    // The reviewer found this in the aggregate-result check; it was equally
    // present here and unflagged. A bundle whose producer's clock runs ahead
    // yields a negative age, which is below every staleness threshold, so a
    // bundle of genuinely unknown age reports as a fresh observation and
    // contributes its gates to a satisfied overall.
    const oneHourAhead = "2026-08-18T13:00:00.000Z";
    const result = aggregateObservations({
      expectedRepositories: ["repo-a"],
      bundles: [bundleFor("repo-a", [satisfiedGate("secret-scan")], oneHourAhead)],
      now: NOW,
      staleAfterMs: ONE_HOUR_MS,
      maxResultAgeMs: ONE_DAY_MS,
    });

    const [status] = result.repositories;
    expect(status?.result.verdict).toBe("indeterminate");
    if (status?.result.verdict === "indeterminate") {
      expect(status.result.reason).toBe("unusable-timestamp");
      expect(status.result.reason).not.toBe("stale-observation");
      expect(status.result.detail).toContain("clock disagreement");
    }
    // And it must not be quietly folded away as a passing contributor.
    expect(result.overall.verdict).toBe("indeterminate");
  });

  it("a bundle exactly at the staleness threshold is still fresh (strictly greater-than is stale)", () => {
    const exactlyOneHourAgo = "2026-08-18T11:00:00.000Z";
    const result = aggregateObservations({
      expectedRepositories: ["repo-a"],
      bundles: [bundleFor("repo-a", [satisfiedGate("secret-scan")], exactlyOneHourAgo)],
      now: NOW,
      staleAfterMs: ONE_HOUR_MS,
      maxResultAgeMs: ONE_DAY_MS,
    });
    expect(result.repositories[0]?.result.verdict).toBe("satisfied");
  });

  it("duplicate repository identity: reported as a named finding, never resolved by last-write-wins", () => {
    const result = aggregateObservations({
      expectedRepositories: ["repo-a"],
      bundles: [bundleFor("repo-a", [satisfiedGate("secret-scan")]), bundleFor("repo-a", [violatedGate("secret-scan")])],
      now: NOW,
      staleAfterMs: ONE_HOUR_MS,
      maxResultAgeMs: ONE_DAY_MS,
    });

    const [status] = result.repositories;
    expect(status?.result.verdict).toBe("indeterminate");
    if (status?.result.verdict === "indeterminate") {
      expect(status.result.reason).toBe("duplicate-repository-identity");
      // Neither the first nor the second bundle's verdict silently "wins" --
      // the repository-level result is indeterminate, not satisfied and not violated.
    }
    // Both duplicates still counted as schema-valid received bundles -- nothing about
    // being a duplicate makes a bundle itself invalid.
    expect(result.receivedCount).toBe(2);
  });

  it("a violated gate folds the repository (and overall) to violated, carrying the finding", () => {
    const result = aggregateObservations({
      expectedRepositories: ["repo-a"],
      bundles: [bundleFor("repo-a", [violatedGate("secret-scan")])],
      now: NOW,
      staleAfterMs: ONE_HOUR_MS,
      maxResultAgeMs: ONE_DAY_MS,
    });

    const [status] = result.repositories;
    expect(status?.result.verdict).toBe("violated");
    expect(result.overall.verdict).toBe("violated");
  });

  it("an indeterminate gate inside a bundle propagates as that repository's (and overall's) indeterminate reason", () => {
    const result = aggregateObservations({
      expectedRepositories: ["repo-a"],
      bundles: [
        bundleFor("repo-a", [{ gateId: "secret-scan", result: { verdict: "indeterminate", reason: "missing-credential" } }]),
      ],
      now: NOW,
      staleAfterMs: ONE_HOUR_MS,
      maxResultAgeMs: ONE_DAY_MS,
    });

    const [status] = result.repositories;
    expect(status?.result.verdict).toBe("indeterminate");
    if (status?.result.verdict === "indeterminate") {
      expect(status.result.reason).toBe("missing-credential");
    }
  });

  it("reports unexpected repositories separately, without letting them satisfy an expected one", () => {
    const result = aggregateObservations({
      expectedRepositories: ["repo-a"],
      bundles: [bundleFor("repo-a", [satisfiedGate("secret-scan")]), bundleFor("repo-z", [satisfiedGate("secret-scan")])],
      now: NOW,
      staleAfterMs: ONE_HOUR_MS,
      maxResultAgeMs: ONE_DAY_MS,
    });

    expect(result.unexpectedRepositories).toEqual(["repo-z"]);
    expect(result.repositories).toHaveLength(1);
    expect(result.overall.verdict).toBe("satisfied");
  });

  it("counts a completely unattributable bundle and refuses to report satisfied over it", () => {
    // This test previously asserted overall stayed "satisfied" with an
    // unattributed bundle present -- encoding the exact fail-open this
    // aggregator promises not to have: evidence arrived, was never
    // evaluated, and the report still read green. Unattributed bundles now
    // fold in as their own indeterminate result.
    const result = aggregateObservations({
      expectedRepositories: ["repo-a"],
      bundles: [bundleFor("repo-a", [satisfiedGate("secret-scan")]), { nonsense: true }],
      now: NOW,
      staleAfterMs: ONE_HOUR_MS,
      maxResultAgeMs: ONE_DAY_MS,
    });

    expect(result.unattributedCount).toBe(1);
    expect(result.overall.verdict).toBe("indeterminate");
  });

  it("throws on a duplicate entry in expectedRepositories itself -- a caller precondition, not repository data", () => {
    expect(() =>
      aggregateObservations({ expectedRepositories: ["repo-a", "repo-a"], bundles: [], now: NOW, staleAfterMs: 0, maxResultAgeMs: 0 }),
    ).toThrow();
  });

  it("throws on an unparseable now", () => {
    expect(() =>
      aggregateObservations({ expectedRepositories: ["repo-a"], bundles: [], now: "not-a-date", staleAfterMs: 0, maxResultAgeMs: 0 }),
    ).toThrow();
  });

  it("throws on a negative staleAfterMs", () => {
    expect(() =>
      aggregateObservations({ expectedRepositories: ["repo-a"], bundles: [], now: NOW, staleAfterMs: -1, maxResultAgeMs: 0 }),
    ).toThrow();
  });

  it("throws on a negative maxResultAgeMs", () => {
    expect(() =>
      aggregateObservations({ expectedRepositories: ["repo-a"], bundles: [], now: NOW, staleAfterMs: 0, maxResultAgeMs: -1 }),
    ).toThrow();
  });

  it("the result carries computedAt (echoing now) and maxResultAgeMs (echoing the caller's own declared threshold), so a persisted copy can be checked for freshness later without the original bundles", () => {
    const result = aggregateObservations({
      expectedRepositories: ["repo-a"],
      bundles: [bundleFor("repo-a", [satisfiedGate("secret-scan")])],
      now: NOW,
      staleAfterMs: ONE_HOUR_MS,
      maxResultAgeMs: ONE_DAY_MS,
    });

    expect(result.computedAt).toBe(NOW);
    expect(result.maxResultAgeMs).toBe(ONE_DAY_MS);
  });
});

describe("checkObservationAggregateFreshness", () => {
  // This is the check #340 exists for: an aggregate that ran once, computed
  // a real verdict, and is then never re-triggered (push-to-main only, no
  // schedule) cannot notice its own inputs changing underneath it. Nothing
  // inside `aggregateObservations` itself can ever fail this way -- its own
  // `computedAt` always equals the `now` it was just called with. This is
  // the separate, later check a caller performs against a PERSISTED result,
  // with a fresh `now` supplied at read time.

  it("a result read back well within its declared maxResultAgeMs is still fresh", () => {
    const result = checkObservationAggregateFreshness({
      computedAt: NOW,
      maxResultAgeMs: ONE_DAY_MS,
      now: "2026-08-18T13:00:00.000Z", // one hour later
    });
    expect(result.verdict).toBe("satisfied");
  });

  it("a result read back exactly at its declared maxResultAgeMs is still fresh (strictly greater-than is stale, matching stale-observation's own rule)", () => {
    const result = checkObservationAggregateFreshness({
      computedAt: NOW,
      maxResultAgeMs: ONE_DAY_MS,
      now: "2026-08-19T12:00:00.000Z", // exactly 24h later
    });
    expect(result.verdict).toBe("satisfied");
  });

  it("a result read back past its declared maxResultAgeMs is indeterminate with a distinct reason -- never a restated stale-observation verdict", () => {
    // This is the live #340 scenario: the aggregate computed a real verdict
    // at NOW, using whatever it could see about its inputs at the time --
    // and nothing has re-run it since. A reader checking this stored result
    // sixteen minutes past its own declared bound must not be told
    // "stale-observation" (that reason means one BUNDLE was old when this
    // ran) or, worse, be hand the stored `overall` unexamined -- it must be
    // told the AGGREGATE ITSELF can no longer vouch for its own age.
    const sixteenMinutesLater = "2026-08-18T12:16:00.000Z";
    const result = checkObservationAggregateFreshness({
      computedAt: NOW,
      maxResultAgeMs: 15 * 60 * 1000, // 15 minutes
      now: sixteenMinutesLater,
    });
    expect(result.verdict).toBe("indeterminate");
    if (result.verdict === "indeterminate") {
      expect(result.reason).toBe("stale-aggregate-result");
      expect(result.reason).not.toBe("stale-observation");
      expect(result.detail).toContain(NOW);
      expect(result.detail).toContain(sixteenMinutesLater);
    }
  });

  it("a result stamped AFTER now is indeterminate, not fresh -- a negative age must not slip under the bound", () => {
    // The hole this closes: age is `now - computedAt`, so a result stamped in
    // the future produces a NEGATIVE age, which is less than every maximum and
    // therefore passes as fresh. A clock-skewed writer could keep a verdict of
    // genuinely unknown age reading as current until the reader's clock caught
    // up. The separating assertion is the verdict, not the exit code: before
    // this guard the call returned satisfied, which no age-based test would
    // have caught, because the age it computed was a number and the comparison
    // it fed was true.
    const result = checkObservationAggregateFreshness({
      computedAt: "2026-08-18T13:00:00.000Z", // one hour AFTER `now`
      maxResultAgeMs: ONE_DAY_MS,
      now: NOW,
    });
    expect(result.verdict).toBe("indeterminate");
    if (result.verdict === "indeterminate") {
      // Distinct from staleness on purpose: an operator told "stale" goes
      // looking for a scheduler, an operator told this goes looking for a clock.
      expect(result.reason).toBe("unusable-timestamp");
      expect(result.reason).not.toBe("stale-aggregate-result");
      expect(result.detail).toContain("clock disagreement");
    }
  });

  it("folds with a stale-but-unanimous-pass stored overall to indeterminate, via the same foldGateResults this module already uses -- a stale verdict never silently stays satisfied", async () => {
    const { foldGateResults } = await import("@vespeneventures/controller/gates");

    const storedResult = aggregateObservations({
      expectedRepositories: ["repo-a"],
      bundles: [bundleFor("repo-a", [satisfiedGate("secret-scan")])],
      now: NOW,
      staleAfterMs: ONE_HOUR_MS,
      maxResultAgeMs: 15 * 60 * 1000,
    });
    expect(storedResult.overall.verdict).toBe("satisfied");

    const freshness = checkObservationAggregateFreshness({
      computedAt: storedResult.computedAt,
      maxResultAgeMs: storedResult.maxResultAgeMs,
      now: "2026-08-18T12:16:00.000Z", // 16 minutes later -- past the 15-minute bound
    });

    const effectiveOverall = foldGateResults([storedResult.overall, freshness], { emptyReason: "stale-aggregate-result" });
    expect(effectiveOverall.verdict).toBe("indeterminate");
    if (effectiveOverall.verdict === "indeterminate") {
      expect(effectiveOverall.reason).toBe("stale-aggregate-result");
    }
  });

  it("throws on an unparseable computedAt", () => {
    expect(() => checkObservationAggregateFreshness({ computedAt: "not-a-date", maxResultAgeMs: 0, now: NOW })).toThrow();
  });

  it("throws on an unparseable now", () => {
    expect(() => checkObservationAggregateFreshness({ computedAt: NOW, maxResultAgeMs: 0, now: "not-a-date" })).toThrow();
  });

  it("throws on a negative maxResultAgeMs", () => {
    expect(() => checkObservationAggregateFreshness({ computedAt: NOW, maxResultAgeMs: -1, now: NOW })).toThrow();
  });
});

it("an unattributed bundle forces overall indeterminate even when every expected repository is satisfied", () => {
  const report = aggregateObservations({
    expectedRepositories: ["alpha"],
    bundles: [bundleFor("alpha", [satisfiedGate("profile")]), { garbage: true }],
    now: NOW,
    staleAfterMs: ONE_HOUR_MS,
    maxResultAgeMs: ONE_DAY_MS,
  });
  expect(report.repositories[0]?.result.verdict).toBe("satisfied");
  expect(report.unattributedCount).toBe(1);
  expect(report.overall.verdict).toBe("indeterminate");
  if (report.overall.verdict === "indeterminate") {
    expect(report.overall.reason).toBe("unattributed-bundle");
  }
});
