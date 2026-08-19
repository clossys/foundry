import { describe, expect, it } from "vitest";
import { aggregateObservations } from "./observation-aggregate.js";
import { writeObservationBundle } from "./observation-bundle.js";
import type { ObservationBundleGateEntry } from "./observation-bundle.js";

const NOW = "2026-08-18T12:00:00.000Z";
const ONE_HOUR_MS = 60 * 60 * 1000;

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
    });

    expect(result.overall.verdict).toBe("indeterminate");
    expect(result.receivedCount).toBe(0);
    expect(result.unobservedRepositories).toEqual(["repo-a", "repo-b", "repo-c"]);
    expect(result.repositories.every((status) => status.result.verdict === "indeterminate")).toBe(true);
  });

  it("truly empty aggregation (no expected repositories, no bundles) is still indeterminate, never satisfied", () => {
    const result = aggregateObservations({ expectedRepositories: [], bundles: [], now: NOW, staleAfterMs: 0 });
    expect(result.overall.verdict).toBe("indeterminate");
    expect(result.repositories).toEqual([]);
  });

  it("expected-count vs received-count mismatch is explicit, and unobserved repositories are named, not folded into a footnote", () => {
    const result = aggregateObservations({
      expectedRepositories: ["repo-a", "repo-b", "repo-c", "repo-d", "repo-e"],
      bundles: [bundleFor("repo-a", [satisfiedGate("secret-scan")]), bundleFor("repo-b", [satisfiedGate("secret-scan")]), bundleFor("repo-c", [satisfiedGate("secret-scan")])],
      now: NOW,
      staleAfterMs: ONE_HOUR_MS,
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
    });

    const [status] = result.repositories;
    expect(status?.result.verdict).toBe("indeterminate");
    if (status?.result.verdict === "indeterminate") {
      expect(status.result.reason).toBe("stale-observation");
      expect(status.result.detail).toContain("repo-a");
      expect(status.result.detail).toContain("staleness threshold");
    }
  });

  it("a bundle exactly at the staleness threshold is still fresh (strictly greater-than is stale)", () => {
    const exactlyOneHourAgo = "2026-08-18T11:00:00.000Z";
    const result = aggregateObservations({
      expectedRepositories: ["repo-a"],
      bundles: [bundleFor("repo-a", [satisfiedGate("secret-scan")], exactlyOneHourAgo)],
      now: NOW,
      staleAfterMs: ONE_HOUR_MS,
    });
    expect(result.repositories[0]?.result.verdict).toBe("satisfied");
  });

  it("duplicate repository identity: reported as a named finding, never resolved by last-write-wins", () => {
    const result = aggregateObservations({
      expectedRepositories: ["repo-a"],
      bundles: [bundleFor("repo-a", [satisfiedGate("secret-scan")]), bundleFor("repo-a", [violatedGate("secret-scan")])],
      now: NOW,
      staleAfterMs: ONE_HOUR_MS,
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
    });

    expect(result.unattributedCount).toBe(1);
    expect(result.overall.verdict).toBe("indeterminate");
  });

  it("throws on a duplicate entry in expectedRepositories itself -- a caller precondition, not repository data", () => {
    expect(() =>
      aggregateObservations({ expectedRepositories: ["repo-a", "repo-a"], bundles: [], now: NOW, staleAfterMs: 0 }),
    ).toThrow();
  });

  it("throws on an unparseable now", () => {
    expect(() =>
      aggregateObservations({ expectedRepositories: ["repo-a"], bundles: [], now: "not-a-date", staleAfterMs: 0 }),
    ).toThrow();
  });

  it("throws on a negative staleAfterMs", () => {
    expect(() =>
      aggregateObservations({ expectedRepositories: ["repo-a"], bundles: [], now: NOW, staleAfterMs: -1 }),
    ).toThrow();
  });
});

it("an unattributed bundle forces overall indeterminate even when every expected repository is satisfied", () => {
  const report = aggregateObservations({
    expectedRepositories: ["alpha"],
    bundles: [bundleFor("alpha", [satisfiedGate("profile")]), { garbage: true }],
    now: NOW,
    staleAfterMs: ONE_HOUR_MS,
  });
  expect(report.repositories[0]?.result.verdict).toBe("satisfied");
  expect(report.unattributedCount).toBe(1);
  expect(report.overall.verdict).toBe("indeterminate");
  if (report.overall.verdict === "indeterminate") {
    expect(report.overall.reason).toBe("unattributed-bundle");
  }
});
