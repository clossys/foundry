import { describe, expect, it } from "vitest";
import { evaluateLifecycleCoverage, validatePackageLifecycle } from "./index.js";

const active = { schemaVersion: 1, packages: [{ name: "@example/core", status: "active" }] };

describe("validatePackageLifecycle", () => {
  it("accepts an active package registry", () => {
    expect(validatePackageLifecycle(active)).toEqual([]);
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
        },
        {
          name: "@example/new",
          status: "active",
        },
      ],
    });
    expect(findings.map((finding) => finding.rule)).toEqual(["deprecated-on", "replacement-range"]);
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
      }],
    })).toEqual([]);
  });

  it("rejects unsafe shapes and sorts findings deterministically", () => {
    const sparse: unknown[] = [];
    sparse[1] = { name: "@example/core", status: "active" };
    expect(validatePackageLifecycle({ schemaVersion: 1, packages: sparse }).map((item) => item.rule)).toEqual(["packages-shape"]);

    const findings = validatePackageLifecycle({
      schemaVersion: 1,
      packages: [{ name: "@example/old", status: "deprecated", replacement: { name: "@example/new", range: "^1.0.0" }, deprecatedOn: "2026-08-11" }],
    });
    expect(findings.map((item) => item.rule)).toEqual(["evidence", "replacement-missing"]);

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
});
