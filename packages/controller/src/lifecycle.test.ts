import { describe, expect, it } from "vitest";
import { evaluateDependencyInstallability, evaluateLifecycleCoverage, validatePackageLifecycle } from "./index.js";

const active = { schemaVersion: 1, packages: [{ name: "@example/core", status: "active" }] };

describe("validatePackageLifecycle", () => {
  it("accepts an active package registry", () => {
    expect(validatePackageLifecycle(active)).toEqual([]);
  });

  it("accepts explicit maturity states while retaining legacy active entries", () => {
    expect(validatePackageLifecycle({
      schemaVersion: 1,
      packages: [
        { name: "@example/incubating", status: "incubating" },
        { name: "@example/published", status: "published" },
        {
          name: "@example/qualified",
          status: "qualified",
          qualifiedEvidence: { reference: "https://example.invalid/ci/qualified-run", date: "2026-08-01" },
        },
        {
          name: "@example/adopted",
          status: "adopted",
          qualifiedEvidence: { reference: "https://example.invalid/ci/adopted-qualification-run", date: "2026-07-01" },
          adoptedEvidence: { reference: "https://example.invalid/consumers/adopted-integration", date: "2026-08-01" },
        },
        { name: "@example/legacy", status: "active" },
      ],
    })).toEqual([]);
  });

  it("requires qualifiedEvidence for a qualified package and both evidence fields for an adopted one", () => {
    const missingQualified = validatePackageLifecycle({
      schemaVersion: 1,
      packages: [{ name: "@example/qualified", status: "qualified" }],
    });
    expect(missingQualified.map((finding) => finding.rule)).toEqual(["qualified-evidence"]);

    const missingBoth = validatePackageLifecycle({
      schemaVersion: 1,
      packages: [{ name: "@example/adopted", status: "adopted" }],
    });
    expect(missingBoth.map((finding) => finding.rule)).toEqual(["adopted-evidence", "qualified-evidence"]);

    const missingAdoptedOnly = validatePackageLifecycle({
      schemaVersion: 1,
      packages: [{
        name: "@example/adopted",
        status: "adopted",
        qualifiedEvidence: { reference: "https://example.invalid/ci/run", date: "2026-08-01" },
      }],
    });
    expect(missingAdoptedOnly.map((finding) => finding.rule)).toEqual(["adopted-evidence"]);
  });

  it("rejects malformed promotion evidence — missing reference, invalid date, and a non-object value", () => {
    const findings = validatePackageLifecycle({
      schemaVersion: 1,
      packages: [{
        name: "@example/qualified",
        status: "qualified",
        qualifiedEvidence: { reference: "  ", date: "2026-02-30" },
      }],
    });
    expect(findings.map((finding) => finding.rule)).toEqual(["qualified-evidence", "qualified-evidence"]);

    expect(validatePackageLifecycle({
      schemaVersion: 1,
      packages: [{ name: "@example/qualified", status: "qualified", qualifiedEvidence: "trust me" }],
    }).map((finding) => finding.rule)).toEqual(["qualified-evidence"]);
  });

  it("allows promotion evidence to be recorded early or retained as historical evidence outside qualified/adopted", () => {
    expect(validatePackageLifecycle({
      schemaVersion: 1,
      packages: [{
        name: "@example/published",
        status: "published",
        qualifiedEvidence: { reference: "https://example.invalid/ci/early-qualification-run", date: "2026-08-01" },
      }],
    })).toEqual([]);
  });

  it("requires a dated, evidenced active replacement with a semver range", () => {
    const findings = validatePackageLifecycle({
      schemaVersion: 1,
      packages: [
        {
          name: "@example/old",
          status: "deprecated",
          replacement: { name: "@example/new", range: "not-a-range" },
          deprecatedOn: "2026-02-30",
          decision: "https://example.invalid/decisions/old",
          migration: "https://example.invalid/migrations/old",
          forwardsToReplacement: true,
        },
        {
          name: "@example/new",
          status: "active",
        },
      ],
    });
    expect(findings.map((finding) => finding.rule)).toEqual(["deprecated-on", "replacement-range"]);
  });

  it("accepts bounded prerelease/build ranges and rejects a large adversarial range", () => {
    const lifecycle = (range: string) => ({
      schemaVersion: 1,
      packages: [
        {
          name: "@example/old",
          status: "deprecated",
          replacement: { name: "@example/new", range },
          deprecatedOn: "2026-08-11",
          decision: "https://example.invalid/decisions/old",
          migration: "https://example.invalid/migrations/old",
          forwardsToReplacement: false,
        },
        { name: "@example/new", status: "published" },
      ],
    });
    expect(validatePackageLifecycle(lifecycle(">=1.2.3-rc.1+build.7 <2.0.0"))).toEqual([]);
    expect(validatePackageLifecycle(lifecycle(`0.0.0${"--".repeat(40_000)}`)).map((entry) => entry.rule)).toContain("replacement-range");
  });

  it("allows a documented terminal retirement without inventing a successor", () => {
    expect(validatePackageLifecycle({
      schemaVersion: 1,
      packages: [{
        name: "@example/retired",
        status: "deprecated",
        noReplacementReason: "The package has no remaining consumers or successor.",
        deprecatedOn: "2026-08-11",
        decision: "https://example.invalid/decisions/retirement",
        migration: "https://example.invalid/migrations/retirement",
        forwardsToReplacement: false,
      }],
    })).toEqual([]);
  });

  it("requires retirement evidence and permits a retired record after source removal", () => {
    const lifecycle = {
      schemaVersion: 1,
      packages: [
        { name: "@example/current", status: "published" },
        {
          name: "@example/retired",
          status: "retired",
          replacement: { name: "@example/current", range: "^1.0.0" },
          retiredOn: "2026-08-11",
          decision: "https://example.invalid/decisions/retired",
          migration: "https://example.invalid/migrations/retired",
        },
      ],
    };
    expect(validatePackageLifecycle(lifecycle)).toEqual([]);
    expect(evaluateLifecycleCoverage(lifecycle, ["@example/current"])).toEqual([]);
    expect(validatePackageLifecycle({ ...lifecycle, packages: [{ ...lifecycle.packages[0] }, { ...lifecycle.packages[1], retiredOn: "2026-02-30" }] }).map((finding) => finding.rule)).toEqual(["retired-on"]);
  });

  it("does not allow an incubating replacement for a terminal package", () => {
    expect(validatePackageLifecycle({
      schemaVersion: 1,
      packages: [
        { name: "@example/new", status: "incubating" },
        {
          name: "@example/old",
          status: "deprecated",
          replacement: { name: "@example/new", range: "^1.0.0" },
          deprecatedOn: "2026-08-11",
          decision: "https://example.invalid/decisions/old",
          migration: "https://example.invalid/migrations/old",
          forwardsToReplacement: true,
        },
      ],
    }).map((finding) => finding.rule)).toEqual(["replacement-not-active"]);
  });

  it("rejects unsafe shapes and sorts findings deterministically", () => {
    const sparse: unknown[] = [];
    sparse[1] = { name: "@example/core", status: "active" };
    expect(validatePackageLifecycle({ schemaVersion: 1, packages: sparse }).map((item) => item.rule)).toEqual(["packages-shape"]);

    const findings = validatePackageLifecycle({
      schemaVersion: 1,
      packages: [{ name: "@example/old", status: "deprecated", replacement: { name: "@example/new", range: "^1.0.0" }, deprecatedOn: "2026-08-11" }],
    });
    expect(findings.map((item) => item.rule)).toEqual(["evidence", "forwards-to-replacement", "replacement-missing"]);

    const withAccessor = { schemaVersion: 1, packages: [{ name: "@example/core", status: "active" }] } as Record<string, unknown>;
    Object.defineProperty(withAccessor, "packages", { enumerable: true, get: () => [] });
    expect(validatePackageLifecycle(withAccessor).map((item) => item.rule)).toContain("field-accessor");
  });

  it("requires coverage to match the actual package list in both directions", () => {
    const findings = evaluateLifecycleCoverage(active, ["@example/core", "@example/missing"]);
    expect(findings.map((finding) => finding.rule)).toEqual(["lifecycle-entry-missing"]);
    expect(evaluateLifecycleCoverage({ schemaVersion: 1, packages: [{ name: "@example/other", status: "active" }] }, ["@example/core"]).map((finding) => finding.rule)).toEqual([
      "lifecycle-entry-missing",
      "catalog-package-missing",
    ]);
  });

  it("requires forwardsToReplacement on a deprecated package but not on a retired one", () => {
    const missing = validatePackageLifecycle({
      schemaVersion: 1,
      packages: [{
        name: "@example/old",
        status: "deprecated",
        noReplacementReason: "No successor exists.",
        deprecatedOn: "2026-08-11",
        decision: "https://example.invalid/decisions/old",
        migration: "https://example.invalid/migrations/old",
      }],
    });
    expect(missing.map((finding) => finding.rule)).toEqual(["forwards-to-replacement"]);

    expect(validatePackageLifecycle({
      schemaVersion: 1,
      packages: [{
        name: "@example/retired",
        status: "retired",
        noReplacementReason: "No successor exists.",
        retiredOn: "2026-08-11",
        decision: "https://example.invalid/decisions/retired",
        migration: "https://example.invalid/migrations/retired",
      }],
    })).toEqual([]);
  });

  it("accepts a working-shim (true) or hard-break (false) forwardsToReplacement on a deprecated package", () => {
    for (const forwardsToReplacement of [true, false]) {
      expect(validatePackageLifecycle({
        schemaVersion: 1,
        packages: [{
          name: "@example/old",
          status: "deprecated",
          noReplacementReason: "No successor exists.",
          deprecatedOn: "2026-08-11",
          decision: "https://example.invalid/decisions/old",
          migration: "https://example.invalid/migrations/old",
          forwardsToReplacement,
        }],
      })).toEqual([]);
    }
  });

  it("rejects a non-boolean forwardsToReplacement and rejects it entirely on a non-terminal package", () => {
    expect(validatePackageLifecycle({
      schemaVersion: 1,
      packages: [{
        name: "@example/old",
        status: "deprecated",
        noReplacementReason: "No successor exists.",
        deprecatedOn: "2026-08-11",
        decision: "https://example.invalid/decisions/old",
        migration: "https://example.invalid/migrations/old",
        forwardsToReplacement: "yes",
      }],
    }).map((finding) => finding.rule)).toEqual(["forwards-to-replacement"]);

    expect(validatePackageLifecycle({
      schemaVersion: 1,
      packages: [{ name: "@example/current", status: "published", forwardsToReplacement: true }],
    }).map((finding) => finding.rule)).toEqual(["forwards-to-replacement"]);
  });

  it("retains documented terminal packages after their workspace source is removed", () => {
    expect(evaluateLifecycleCoverage({
      schemaVersion: 1,
      packages: [
        { name: "@example/current", status: "active" },
        {
          name: "@example/retired",
          status: "retired",
          replacement: { name: "@example/current", range: "^1.0.0" },
          deprecatedOn: "2026-08-11",
          retiredOn: "2026-08-11",
          decision: "https://example.invalid/decisions/retired",
          migration: "https://example.invalid/migrations/retired",
        },
      ],
    }, ["@example/current"])).toEqual([]);
  });

  it("retains still-published predecessor-scope packages while the candidate scope is source-only", () => {
    const currentScope = "@clossys";
    const predecessorScope = `@${["vespene", "ventures"].join("")}`;
    const current = `${currentScope}/current`;
    const lifecycle = {
      schemaVersion: 1,
      packages: [
        { name: current, status: "active" },
        { name: `${predecessorScope}/current`, status: "published" },
      ],
    };
    expect(evaluateLifecycleCoverage(lifecycle, [current], new Map([[current, "1.0.0"]]), currentScope)).toEqual([]);
    expect(evaluateLifecycleCoverage(
      { ...lifecycle, packages: [...lifecycle.packages, { name: `${currentScope}/missing`, status: "published" }] },
      [current],
      new Map([[current, "1.0.0"]]),
      currentScope,
    ).map((finding) => finding.rule)).toEqual(["catalog-package-missing"]);
  });

  it("flags a replacement range that does not cover the replacement's actual current version", () => {
    const lifecycle = {
      schemaVersion: 1,
      packages: [
        { name: "@example/current", status: "published" },
        {
          name: "@example/old",
          status: "deprecated",
          replacement: { name: "@example/current", range: "^0.1.0" },
          deprecatedOn: "2026-08-11",
          decision: "https://example.invalid/decisions/old",
          migration: "https://example.invalid/migrations/old",
          forwardsToReplacement: false,
        },
      ],
    };
    const findings = evaluateLifecycleCoverage(lifecycle, ["@example/current"], new Map([["@example/current", "0.3.0"]]));
    expect(findings.map((finding) => finding.rule)).toEqual(["replacement-range-stale"]);
    expect(findings[0]?.message).toContain('"@example/current"');
    expect(findings[0]?.message).toContain("0.3.0");

    // No `packageVersions` map at all: the existing coverage checks still
    // run, but the range-staleness check is simply not evaluated rather
    // than forcing every caller to fabricate versions to call this at all.
    expect(evaluateLifecycleCoverage(lifecycle, ["@example/current"])).toEqual([]);
  });

  it("passes a replacement range that does cover the replacement's actual current version", () => {
    const lifecycle = {
      schemaVersion: 1,
      packages: [
        { name: "@example/current", status: "published" },
        {
          name: "@example/old",
          status: "deprecated",
          replacement: { name: "@example/current", range: "^0.3.0" },
          deprecatedOn: "2026-08-11",
          decision: "https://example.invalid/decisions/old",
          migration: "https://example.invalid/migrations/old",
          forwardsToReplacement: false,
        },
      ],
    };
    expect(evaluateLifecycleCoverage(lifecycle, ["@example/current"], new Map([["@example/current", "0.3.0"]]))).toEqual([]);
  });

  it("does not flag replacement-range-stale when the replacement's version is unknown or the range is unparseable", () => {
    const unknownVersion = {
      schemaVersion: 1,
      packages: [
        { name: "@example/current", status: "published" },
        {
          name: "@example/old",
          status: "deprecated",
          replacement: { name: "@example/current", range: "^0.1.0" },
          deprecatedOn: "2026-08-11",
          decision: "https://example.invalid/decisions/old",
          migration: "https://example.invalid/migrations/old",
          forwardsToReplacement: false,
        },
      ],
    };
    expect(evaluateLifecycleCoverage(unknownVersion, ["@example/current"], new Map())).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// evaluateDependencyInstallability
//
// The ordering constraint on a retirement. A package that is still
// installable must not depend on one that is not, or `npm install
// <depender>` cannot resolve. The real case this was written for: a
// deprecated package declaring two dependencies that a proposed
// retirement would have removed from the registry, where every existing
// gate reported PASS with zero findings for both the safe ordering and
// the broken one.
// ---------------------------------------------------------------------

const installabilityDoc = {
  schemaVersion: 1,
  packages: [
    { name: "@scope/live", status: "published" },
    { name: "@scope/donor", status: "deprecated" },
    { name: "@scope/older", status: "deprecated" },
    { name: "@scope/gone", status: "retired" },
  ],
};

describe("evaluateDependencyInstallability", () => {
  it("reports a still-installable package depending on a retired one", () => {
    const findings = evaluateDependencyInstallability(installabilityDoc, [
      { name: "@scope/donor", dependencies: ["@scope/gone"] },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("dependency-not-installable");
    expect(findings[0].message).toContain("cannot resolve");
  });

  // The asymmetry, asserted in both directions. A weaker implementation
  // that keys only on the DEPENDENCY's status passes the test above and
  // fails this one — it would fire on the current tree, where a deprecated
  // package depending on a deprecated package is correct and intended.
  it("stays silent when a deprecated package depends on a deprecated package — both are installable", () => {
    expect(
      evaluateDependencyInstallability(installabilityDoc, [{ name: "@scope/donor", dependencies: ["@scope/older"] }]),
    ).toEqual([]);
  });

  // The other half of the asymmetry: once the depender is retired too,
  // nothing can install either one, so no edge between them can break.
  it("stays silent when a retired package depends on a retired package — retiring together is the fix, not a fault", () => {
    const doc = { ...installabilityDoc, packages: [...installabilityDoc.packages, { name: "@scope/alsogone", status: "retired" }] };
    expect(evaluateDependencyInstallability(doc, [{ name: "@scope/gone", dependencies: ["@scope/alsogone"] }])).toEqual([]);
  });

  it("stays silent on a healthy edge between two published packages", () => {
    expect(
      evaluateDependencyInstallability(installabilityDoc, [{ name: "@scope/live", dependencies: ["@scope/donor"] }]),
    ).toEqual([]);
  });

  // A package absent from the registry is a different rule's finding.
  // Reporting it here would double-count it against lifecycle-entry-missing.
  it("ignores an edge whose depender or dependency has no lifecycle entry", () => {
    expect(evaluateDependencyInstallability(installabilityDoc, [{ name: "@scope/unknown", dependencies: ["@scope/gone"] }])).toEqual([]);
    expect(evaluateDependencyInstallability(installabilityDoc, [{ name: "@scope/donor", dependencies: ["@scope/unknown"] }])).toEqual([]);
  });

  it("is deterministic across edge and dependency ordering", () => {
    const doc = { ...installabilityDoc, packages: [...installabilityDoc.packages, { name: "@scope/gone2", status: "retired" }] };
    const a = evaluateDependencyInstallability(doc, [
      { name: "@scope/older", dependencies: ["@scope/gone2", "@scope/gone"] },
      { name: "@scope/donor", dependencies: ["@scope/gone"] },
    ]);
    const b = evaluateDependencyInstallability(doc, [
      { name: "@scope/donor", dependencies: ["@scope/gone"] },
      { name: "@scope/older", dependencies: ["@scope/gone", "@scope/gone2"] },
    ]);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
  });
});
