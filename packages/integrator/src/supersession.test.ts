import { describe, expect, it } from "vitest";
import { detectSupersession, supersessionResultToExitCode, type SupersessionResult } from "./supersession.js";

/**
 * PROOF STANDARD: every test in the "substring matcher" describe block below
 * is constructed to pass a naive implementation that flags a manifest merely
 * because a superseded name's TEXT appears somewhere in it (as a substring
 * of a longer name, in a non-dependency field, or across a scope boundary),
 * and to fail the exact-match, dependency-position-scoped implementation
 * this module actually ships would instead demand. Each `it` block below
 * says, in its own description, which naive matcher it defeats.
 */

const map = (entries: Record<string, { replacement: string; since: string }>) => ({
  version: 1 as const,
  supersededBy: entries,
});

describe("detectSupersession -- substring-matcher-defeating proof", () => {
  it("does NOT flag a present package whose name merely CONTAINS the superseded name as a substring", () => {
    // A substring/`includes`-based matcher would see "foo" inside both
    // "foo-utils" and "@example-scope/foo-legacy" and report a conflict.
    // Neither is the legacy package "foo" itself, and "foo" itself is never
    // installed here, so the real answer is satisfied.
    const manifest = {
      dependencies: {
        "foo-utils": "1.0.0",
        "bar": "1.0.0", // the actual replacement, present
      },
      devDependencies: {
        "@example-scope/foo-legacy": "2.0.0",
      },
    };
    const supersessionMap = map({ foo: { replacement: "bar", since: "1.0.0" } });
    const result = detectSupersession(manifest, supersessionMap);
    expect(result.verdict).toBe("satisfied");
  });

  it("does NOT flag a superseded name that appears only in a non-dependency field (scripts, description, keywords)", () => {
    // A matcher that scans the whole serialized manifest text (or every
    // string value in the object) would trip on "foo" showing up in
    // `scripts`, `description`, and `keywords`. None of those are dependency
    // positions, so the real answer is satisfied -- "foo" was never actually
    // installed, only mentioned in prose and tooling config.
    const manifest = {
      description: "A package that migrated away from foo.",
      keywords: ["foo", "migration"],
      scripts: { build: "echo building foo replacement", postinstall: "node ./scripts/foo-cleanup.js" },
      dependencies: { bar: "1.0.0" },
    };
    const supersessionMap = map({ foo: { replacement: "bar", since: "1.0.0" } });
    const result = detectSupersession(manifest, supersessionMap);
    expect(result.verdict).toBe("satisfied");
  });

  it("does NOT cross-match a scoped legacy name against its unscoped-looking counterpart", () => {
    // The legacy name is "@example-scope/thing"; the manifest installs a
    // package that merely shares the trailing path component, "thing" with
    // no scope. A matcher that ignores scope when comparing names (e.g.
    // stripping "@scope/" before comparing) would treat these as the same
    // package. They are two different packages on the registry.
    const manifest = {
      dependencies: { thing: "1.0.0", "@example-scope/thing-v2": "1.0.0" },
    };
    const supersessionMap = map({ "@example-scope/thing": { replacement: "@example-scope/thing-v2", since: "1.0.0" } });
    const result = detectSupersession(manifest, supersessionMap);
    expect(result.verdict).toBe("satisfied");
  });

  it("does NOT cross-match an unscoped legacy name against a scoped package with the same trailing segment", () => {
    // The reverse direction of the previous case: legacy is unscoped
    // "widget"; only "@example-scope/widget" (a different, scoped package)
    // is installed, alongside the real replacement.
    const manifest = {
      dependencies: { "@example-scope/widget": "1.0.0", "widget-next": "1.0.0" },
    };
    const supersessionMap = map({ widget: { replacement: "widget-next", since: "1.0.0" } });
    const result = detectSupersession(manifest, supersessionMap);
    expect(result.verdict).toBe("satisfied");
  });

  it("flags the genuine conflict when both the legacy name and its replacement are present in the SAME position", () => {
    const manifest = { dependencies: { "legacy-panel": "1.4.0", "panel-next": "2.0.0" } };
    const supersessionMap = map({ "legacy-panel": { replacement: "panel-next", since: "2.0.0" } });
    const result = detectSupersession(manifest, supersessionMap);
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") {
      expect(result.count).toBe(1);
      expect(result.pairs).toEqual([
        {
          legacyName: "legacy-panel",
          legacyPositions: ["dependencies"],
          replacementName: "panel-next",
          replacementPositions: ["dependencies"],
          since: "2.0.0",
        },
      ]);
    }
  });

  it("flags the genuine conflict when the legacy name and its replacement are in TWO DIFFERENT dependency positions", () => {
    // A matcher that only ever compares within one field at a time (e.g.
    // checking dependencies against dependencies, devDependencies against
    // devDependencies, never cross-field) would miss this. The real
    // implementation indexes every position and looks up presence
    // regardless of which position each side landed in.
    const manifest = {
      dependencies: { "legacy-panel": "1.4.0" },
      devDependencies: { "panel-next": "2.0.0" },
    };
    const supersessionMap = map({ "legacy-panel": { replacement: "panel-next", since: "2.0.0" } });
    const result = detectSupersession(manifest, supersessionMap);
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") {
      expect(result.pairs[0]?.legacyPositions).toEqual(["dependencies"]);
      expect(result.pairs[0]?.replacementPositions).toEqual(["devDependencies"]);
    }
  });
});

describe("detectSupersession -- every dependency position", () => {
  const positionCases: Array<{ position: string; manifest: Record<string, unknown> }> = [
    { position: "dependencies", manifest: { dependencies: { "legacy-a": "1.0.0", "replacement-a": "1.0.0" } } },
    { position: "devDependencies", manifest: { devDependencies: { "legacy-a": "1.0.0", "replacement-a": "1.0.0" } } },
    { position: "peerDependencies", manifest: { peerDependencies: { "legacy-a": "1.0.0", "replacement-a": "1.0.0" } } },
    { position: "optionalDependencies", manifest: { optionalDependencies: { "legacy-a": "1.0.0", "replacement-a": "1.0.0" } } },
  ];

  for (const { position, manifest } of positionCases) {
    it(`flags a conflict living entirely in "${position}"`, () => {
      const supersessionMap = map({ "legacy-a": { replacement: "replacement-a", since: "1.0.0" } });
      const result = detectSupersession(manifest, supersessionMap);
      expect(result.verdict).toBe("violated");
    });
  }

  it("flags a conflict where the legacy name is pinned only via an npm `overrides` block, nested", () => {
    const manifest = {
      dependencies: { "replacement-a": "1.0.0" },
      overrides: {
        "some-consumer": {
          ".": "1.0.0",
          "legacy-a": "0.9.0", // nested override, not a top-level dependency
        },
      },
    };
    const supersessionMap = map({ "legacy-a": { replacement: "replacement-a", since: "1.0.0" } });
    const result = detectSupersession(manifest, supersessionMap);
    expect(result.verdict).toBe("violated");
  });

  it("does not mistake npm overrides' own \".\" self-marker for a package name", () => {
    const manifest = {
      dependencies: { "replacement-a": "1.0.0" },
      overrides: { "replacement-a": { ".": "1.0.0" } },
    };
    const supersessionMap = map({ "legacy-a": { replacement: "replacement-a", since: "1.0.0" } });
    const result = detectSupersession(manifest, supersessionMap);
    // legacy-a genuinely never appears anywhere -- "." must never be read as it.
    expect(result.verdict).toBe("satisfied");
  });

  it("flags a conflict where the legacy name is pinned only via a yarn `resolutions` selector path", () => {
    const manifest = {
      dependencies: { "replacement-a": "1.0.0" },
      resolutions: { "some-parent/legacy-a": "0.9.0" },
    };
    const supersessionMap = map({ "legacy-a": { replacement: "replacement-a", since: "1.0.0" } });
    const result = detectSupersession(manifest, supersessionMap);
    expect(result.verdict).toBe("violated");
  });

  it("resolves a scoped package correctly out of a yarn resolutions glob selector, without substring-matching the glob itself", () => {
    const manifest = {
      dependencies: { "@example-scope/replacement-a": "1.0.0" },
      resolutions: { "**/@example-scope/legacy-a": "0.9.0" },
    };
    const supersessionMap = map({ "@example-scope/legacy-a": { replacement: "@example-scope/replacement-a", since: "1.0.0" } });
    const result = detectSupersession(manifest, supersessionMap);
    expect(result.verdict).toBe("violated");
  });
});

describe("detectSupersession -- three-state contract", () => {
  it("is satisfied when the manifest holds ONLY the replacement", () => {
    const manifest = { dependencies: { "replacement-a": "1.0.0" } };
    const supersessionMap = map({ "legacy-a": { replacement: "replacement-a", since: "1.0.0" } });
    const result = detectSupersession(manifest, supersessionMap);
    expect(result).toEqual({ verdict: "satisfied", evaluated: 1, count: 0 });
  });

  it("is satisfied (not violated) when the manifest holds neither side", () => {
    const manifest = { dependencies: { "unrelated-package": "1.0.0" } };
    const supersessionMap = map({ "legacy-a": { replacement: "replacement-a", since: "1.0.0" } });
    const result = detectSupersession(manifest, supersessionMap);
    expect(result.verdict).toBe("satisfied");
  });

  it("is satisfied when only the legacy name is installed (not yet migrated, but not duplicated either)", () => {
    const manifest = { dependencies: { "legacy-a": "1.0.0" } };
    const supersessionMap = map({ "legacy-a": { replacement: "replacement-a", since: "1.0.0" } });
    const result = detectSupersession(manifest, supersessionMap);
    expect(result.verdict).toBe("satisfied");
  });

  it("reports every conflicting pair, not just the first, and the count matches", () => {
    const manifest = {
      dependencies: { "legacy-a": "1.0.0", "replacement-a": "1.0.0", "legacy-b": "1.0.0", "replacement-b": "1.0.0" },
    };
    const supersessionMap = map({
      "legacy-a": { replacement: "replacement-a", since: "1.0.0" },
      "legacy-b": { replacement: "replacement-b", since: "1.0.0" },
      "legacy-c": { replacement: "replacement-c", since: "1.0.0" }, // neither side installed -- not a pair
    });
    const result = detectSupersession(manifest, supersessionMap);
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") {
      expect(result.count).toBe(2);
      expect(result.pairs.map((p) => p.legacyName)).toEqual(["legacy-a", "legacy-b"]);
    }
  });

  it("is indeterminate, never satisfied, when the manifest text does not parse as JSON", () => {
    const supersessionMap = map({ "legacy-a": { replacement: "replacement-a", since: "1.0.0" } });
    const result = detectSupersession("{ not valid json", supersessionMap);
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "manifest-invalid" });
  });

  it("is indeterminate when the manifest parses but is not a JSON object", () => {
    const supersessionMap = map({ "legacy-a": { replacement: "replacement-a", since: "1.0.0" } });
    const result = detectSupersession(["not", "an", "object"], supersessionMap);
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "manifest-invalid" });
  });

  it("is indeterminate when a dependency-position field is not itself an object", () => {
    const manifest = { dependencies: "not-an-object" };
    const supersessionMap = map({ "legacy-a": { replacement: "replacement-a", since: "1.0.0" } });
    const result = detectSupersession(manifest, supersessionMap);
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "manifest-invalid" });
  });

  it("is indeterminate when the supersession map is missing version: 1", () => {
    const manifest = { dependencies: { "legacy-a": "1.0.0" } };
    const result = detectSupersession(manifest, { supersededBy: { "legacy-a": { replacement: "replacement-a", since: "1.0.0" } } });
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "supersession-map-invalid" });
  });

  it("is indeterminate when a map entry's replacement is not a validly-shaped package name", () => {
    const manifest = { dependencies: { "legacy-a": "1.0.0" } };
    const result = detectSupersession(manifest, map({ "legacy-a": { replacement: "Not A Valid Name", since: "1.0.0" } }));
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "supersession-map-invalid" });
  });

  it("is indeterminate when a map entry's since is not a real semantic version", () => {
    const manifest = { dependencies: { "legacy-a": "1.0.0" } };
    const result = detectSupersession(manifest, map({ "legacy-a": { replacement: "replacement-a", since: "not-a-version" } }));
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "supersession-map-invalid" });
  });

  it("is indeterminate when a map entry names itself as its own replacement", () => {
    const manifest = { dependencies: { "legacy-a": "1.0.0" } };
    const result = detectSupersession(manifest, map({ "legacy-a": { replacement: "legacy-a", since: "1.0.0" } }));
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "supersession-map-invalid" });
  });

  it("is indeterminate -- never a silent zero-pairs satisfied -- when the supersession map is syntactically valid but empty", () => {
    const manifest = { dependencies: { "legacy-a": "1.0.0" } };
    const result = detectSupersession(manifest, map({}));
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "supersession-map-empty" });
  });

  it("never returns satisfied on a code path that evaluated nothing", () => {
    // The meta-property this fleet's gate contract cares about most: a
    // result can only be `satisfied` while also naming a positive
    // `evaluated` count.
    const manifest = { dependencies: { "legacy-a": "1.0.0" } };
    const result = detectSupersession(manifest, map({}));
    expect(result.verdict).not.toBe("satisfied");
  });
});

describe("supersessionResultToExitCode", () => {
  const cases: Array<[SupersessionResult, 0 | 1 | 2]> = [
    [{ verdict: "satisfied", evaluated: 1, count: 0 }, 0],
    [{ verdict: "violated", pairs: [], count: 0 }, 1],
    [{ verdict: "indeterminate", reason: "manifest-invalid" }, 2],
  ];

  for (const [result, expected] of cases) {
    it(`maps verdict "${result.verdict}" to exit code ${expected}`, () => {
      expect(supersessionResultToExitCode(result)).toBe(expected);
    });
  }
});
