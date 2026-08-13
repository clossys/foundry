import { describe, expect, it } from "vitest";
import type { Catalog, CatalogEntry } from "../catalog/index.js";
import { checkDependencyScope } from "./dependency-scope.js";

// checkDependencyScope is pure — no I/O — so these fixtures are plain
// in-memory Catalog objects, matching the pattern build-order.test.ts uses.
// Only "name", "dir", and "packageJson.dependencies" matter here.

const SCOPE = "@fixture-scope";

interface FixtureSpec {
  name: string;
  dependencies?: Record<string, string>;
}

function makeCatalog(specs: FixtureSpec[]): Catalog {
  const entries: CatalogEntry[] = specs.map((spec) => {
    const packageJson: Record<string, unknown> = { name: spec.name, version: "1.0.0" };
    if (spec.dependencies !== undefined) packageJson.dependencies = spec.dependencies;
    return {
      name: spec.name,
      version: "1.0.0",
      dir: `packages/${spec.name.split("/")[1]}`,
      private: false,
      packageJson,
    };
  });
  return { root: "/dependency-scope-fixture-root", entries, skipped: [] };
}

const NOW = new Date("2026-08-13T00:00:00Z");

describe("checkDependencyScope — first-party dependencies", () => {
  it("passes when every dependency is scope-prefixed", () => {
    const catalog = makeCatalog([
      { name: `${SCOPE}/a`, dependencies: { [`${SCOPE}/b`]: "^1.0.0" } },
      { name: `${SCOPE}/b` },
    ]);
    expect(checkDependencyScope(catalog, SCOPE, undefined, { now: NOW })).toEqual([]);
  });

  it("passes when no package declares any dependencies at all", () => {
    const catalog = makeCatalog([{ name: `${SCOPE}/a` }, { name: `${SCOPE}/b` }]);
    expect(checkDependencyScope(catalog, SCOPE, undefined, { now: NOW })).toEqual([]);
  });
});

describe("checkDependencyScope — third-party dependencies without an allowlist", () => {
  it("flags a single third-party dependency", () => {
    const catalog = makeCatalog([{ name: `${SCOPE}/a`, dependencies: { "left-pad": "^1.0.0" } }]);
    const findings = checkDependencyScope(catalog, SCOPE, undefined, { now: NOW });
    expect(findings).toEqual([
      {
        rule: "dependency-scope/third-party-dependency",
        severity: "error",
        message: expect.stringContaining("left-pad"),
        path: expect.stringContaining("left-pad"),
        package: `${SCOPE}/a`,
      },
    ]);
  });

  it("flags every third-party dependency across every package, not just the first", () => {
    const catalog = makeCatalog([
      { name: `${SCOPE}/a`, dependencies: { "left-pad": "^1.0.0", "right-pad": "^1.0.0" } },
      { name: `${SCOPE}/b`, dependencies: { lodash: "^4.0.0" } },
    ]);
    const findings = checkDependencyScope(catalog, SCOPE, undefined, { now: NOW });
    expect(findings).toHaveLength(3);
    expect(findings.every((f) => f.rule === "dependency-scope/third-party-dependency")).toBe(true);
    const flaggedNames = findings.map((f) => f.package).sort();
    expect(flaggedNames).toEqual([`${SCOPE}/a`, `${SCOPE}/a`, `${SCOPE}/b`]);
  });

  it("does not flag a dependency merely scoped differently but still under this repo's scope", () => {
    const catalog = makeCatalog([{ name: `${SCOPE}/a`, dependencies: { [`${SCOPE}/deep/nested`]: "^1.0.0" } }]);
    expect(checkDependencyScope(catalog, SCOPE, undefined, { now: NOW })).toEqual([]);
  });

  it("flags a dependency whose name merely starts with the scope string but isn't actually scope-prefixed", () => {
    // "@fixture-scope-evil/x" starts with "@fixture-scope" as a raw string
    // prefix but is NOT "@fixture-scope/..." — the check requires the "/"
    // boundary, not just a string prefix.
    const catalog = makeCatalog([{ name: `${SCOPE}/a`, dependencies: { "@fixture-scope-evil/x": "^1.0.0" } }]);
    const findings = checkDependencyScope(catalog, SCOPE, undefined, { now: NOW });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("dependency-scope/third-party-dependency");
  });
});

describe("checkDependencyScope — allowlist exemptions", () => {
  it("exempts a dependency named in a well-formed, unexpired allowlist entry", () => {
    const catalog = makeCatalog([{ name: `${SCOPE}/a`, dependencies: { "left-pad": "^1.0.0" } }]);
    const allowlist = {
      version: 1,
      entries: [{ name: "left-pad", reason: "needed for a padding shim", reviewBy: "2027-01-01" }],
    };
    expect(checkDependencyScope(catalog, SCOPE, allowlist, { now: NOW })).toEqual([]);
  });

  it("does not exempt a dependency not named in the allowlist", () => {
    const catalog = makeCatalog([{ name: `${SCOPE}/a`, dependencies: { "left-pad": "^1.0.0", lodash: "^4.0.0" } }]);
    const allowlist = {
      version: 1,
      entries: [{ name: "left-pad", reason: "needed for a padding shim", reviewBy: "2027-01-01" }],
    };
    const findings = checkDependencyScope(catalog, SCOPE, allowlist, { now: NOW });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("lodash");
  });

  it("does not exempt anything when the allowlist is present but empty", () => {
    const catalog = makeCatalog([{ name: `${SCOPE}/a`, dependencies: { "left-pad": "^1.0.0" } }]);
    const findings = checkDependencyScope(catalog, SCOPE, { version: 1, entries: [] }, { now: NOW });
    expect(findings).toHaveLength(1);
  });
});

describe("checkDependencyScope — allowlist expiry", () => {
  it("no longer exempts a dependency once its reviewBy date has passed, and reports the expiry itself", () => {
    const catalog = makeCatalog([{ name: `${SCOPE}/a`, dependencies: { "left-pad": "^1.0.0" } }]);
    const allowlist = {
      version: 1,
      entries: [{ name: "left-pad", reason: "needed once", reviewBy: "2020-01-01" }],
    };
    const findings = checkDependencyScope(catalog, SCOPE, allowlist, { now: NOW });
    const rules = findings.map((f) => f.rule).sort();
    expect(rules).toEqual(["dependency-scope/allowlist-expired", "dependency-scope/third-party-dependency"]);
  });

  it("still exempts a dependency on the exact reviewBy date (not yet past)", () => {
    const catalog = makeCatalog([{ name: `${SCOPE}/a`, dependencies: { "left-pad": "^1.0.0" } }]);
    const allowlist = {
      version: 1,
      entries: [{ name: "left-pad", reason: "needed", reviewBy: "2026-08-13" }],
    };
    const findings = checkDependencyScope(catalog, SCOPE, allowlist, { now: NOW });
    expect(findings).toEqual([]);
  });

  it("no longer exempts a dependency exactly one day past reviewBy", () => {
    const catalog = makeCatalog([{ name: `${SCOPE}/a`, dependencies: { "left-pad": "^1.0.0" } }]);
    const allowlist = {
      version: 1,
      entries: [{ name: "left-pad", reason: "needed", reviewBy: "2026-08-12" }],
    };
    const findings = checkDependencyScope(catalog, SCOPE, allowlist, { now: NOW });
    expect(findings.some((f) => f.rule === "dependency-scope/allowlist-expired")).toBe(true);
  });

  it("defaults now to the real current time when options.now is omitted", () => {
    const catalog = makeCatalog([{ name: `${SCOPE}/a`, dependencies: { "left-pad": "^1.0.0" } }]);
    const allowlist = {
      version: 1,
      entries: [{ name: "left-pad", reason: "needed", reviewBy: "2099-01-01" }],
    };
    // No `now` passed: exercises the real Date.now() default path directly.
    expect(checkDependencyScope(catalog, SCOPE, allowlist)).toEqual([]);
  });
});

describe("checkDependencyScope — malformed allowlist fails closed", () => {
  it("rejects a non-object allowlist", () => {
    const catalog = makeCatalog([{ name: `${SCOPE}/a` }]);
    const findings = checkDependencyScope(catalog, SCOPE, "not-an-object", { now: NOW });
    expect(findings).toEqual([
      {
        rule: "dependency-scope/allowlist-shape",
        severity: "error",
        message: expect.any(String),
        path: "allowlist",
      },
    ]);
  });

  it("rejects an allowlist with the wrong version", () => {
    const catalog = makeCatalog([{ name: `${SCOPE}/a` }]);
    const findings = checkDependencyScope(catalog, SCOPE, { version: 2, entries: [] }, { now: NOW });
    expect(findings[0]?.rule).toBe("dependency-scope/allowlist-shape");
  });

  it("rejects an allowlist whose entries is not an array", () => {
    const catalog = makeCatalog([{ name: `${SCOPE}/a` }]);
    const findings = checkDependencyScope(catalog, SCOPE, { version: 1, entries: "nope" }, { now: NOW });
    expect(findings[0]?.rule).toBe("dependency-scope/allowlist-shape");
  });

  it("a malformed allowlist never silently exempts anything — the underlying dependency still gets flagged", () => {
    const catalog = makeCatalog([{ name: `${SCOPE}/a`, dependencies: { "left-pad": "^1.0.0" } }]);
    const findings = checkDependencyScope(catalog, SCOPE, "garbage", { now: NOW });
    const rules = findings.map((f) => f.rule).sort();
    expect(rules).toEqual(["dependency-scope/allowlist-shape", "dependency-scope/third-party-dependency"]);
  });

  it.each([
    ["missing name", { reason: "x", reviewBy: "2027-01-01" }],
    ["empty name", { name: "", reason: "x", reviewBy: "2027-01-01" }],
    ["missing reason", { name: "left-pad", reviewBy: "2027-01-01" }],
    ["empty reason", { name: "left-pad", reason: "  ", reviewBy: "2027-01-01" }],
    ["missing reviewBy", { name: "left-pad", reason: "x" }],
    ["malformed reviewBy", { name: "left-pad", reason: "x", reviewBy: "01/01/2027" }],
    ["an invalid calendar date", { name: "left-pad", reason: "x", reviewBy: "2027-02-30" }],
    ["a non-string name", { name: 5, reason: "x", reviewBy: "2027-01-01" }],
  ])("rejects an allowlist entry with %s", (_label, entry) => {
    const catalog = makeCatalog([{ name: `${SCOPE}/a`, dependencies: { "left-pad": "^1.0.0" } }]);
    const allowlist = { version: 1, entries: [entry] };
    const findings = checkDependencyScope(catalog, SCOPE, allowlist, { now: NOW });
    expect(findings.some((f) => f.rule === "dependency-scope/allowlist-entry-shape")).toBe(true);
    // A malformed entry never exempts the dependency it names.
    expect(findings.some((f) => f.rule === "dependency-scope/third-party-dependency")).toBe(true);
  });

  it("rejects a duplicate allowlist entry name", () => {
    const catalog = makeCatalog([{ name: `${SCOPE}/a`, dependencies: { "left-pad": "^1.0.0" } }]);
    const allowlist = {
      version: 1,
      entries: [
        { name: "left-pad", reason: "first", reviewBy: "2027-01-01" },
        { name: "left-pad", reason: "second", reviewBy: "2027-06-01" },
      ],
    };
    const findings = checkDependencyScope(catalog, SCOPE, allowlist, { now: NOW });
    expect(findings.some((f) => f.rule === "dependency-scope/allowlist-duplicate")).toBe(true);
    // The first occurrence still stands as the active exemption.
    expect(findings.some((f) => f.rule === "dependency-scope/third-party-dependency")).toBe(false);
  });

  it("undefined allowlist is treated the same as a present-but-empty one, not as malformed", () => {
    const catalog = makeCatalog([{ name: `${SCOPE}/a` }]);
    const findings = checkDependencyScope(catalog, SCOPE, undefined, { now: NOW });
    expect(findings).toEqual([]);
  });
});
