import { describe, expect, it } from "vitest";
import { checkLocaleCoverage } from "./locale-coverage.js";
import type { CopyRegistry } from "./types.js";

// Obviously-fictional fixtures only — "Acme" mirrors the placeholder already
// used across this repository's own README examples and test fixtures.
// Never real copy.

function makeRegistry(locale: string, overrides: Partial<CopyRegistry> = {}): CopyRegistry {
  return {
    id: "acme-app",
    locale,
    revision: "2026-08-01",
    source: { kind: "consumer", reference: "editorial/revisions/1" },
    entries: [
      { id: "pagination.no-results", text: "No results found.", context: "search results page", status: "approved" },
      { id: "dashboard.welcome", text: "Welcome back.", context: "dashboard header", status: "approved" },
    ],
    ...overrides,
  };
}

describe("checkLocaleCoverage — the two implemented checks can genuinely fail", () => {
  it("reports missing-entry for a source entry absent from a target locale", () => {
    const en = makeRegistry("en");
    const fr = makeRegistry("fr", {
      entries: [{ id: "pagination.no-results", text: "Aucun résultat trouvé.", context: "search results page", status: "approved" }],
    });

    const report = checkLocaleCoverage({ en, fr }, "en", ["en", "fr"]);

    expect(report.complete).toBe(true);
    expect(report.checkedLocales).toEqual(["fr"]);
    const missing = report.findings.find((f) => f.rule === "locale-coverage:missing-entry");
    expect(missing).toBeDefined();
    expect(missing?.entryId).toBe("dashboard.welcome");
    expect(missing?.locale).toBe("fr");
    expect(missing?.severity).toBe("error");
  });

  it("reports orphaned-entry for a target entry with no counterpart in the source locale", () => {
    const en = makeRegistry("en", {
      entries: [{ id: "pagination.no-results", text: "No results found.", context: "search results page", status: "approved" }],
    });
    const fr = makeRegistry("fr", {
      entries: [
        { id: "pagination.no-results", text: "Aucun résultat trouvé.", context: "search results page", status: "approved" },
        { id: "legacy.retired-banner", text: "Bannière retirée.", context: "old banner", status: "approved" },
      ],
    });

    const report = checkLocaleCoverage({ en, fr }, "en", ["en", "fr"]);

    expect(report.complete).toBe(true);
    const orphan = report.findings.find((f) => f.rule === "locale-coverage:orphaned-entry");
    expect(orphan).toBeDefined();
    expect(orphan?.entryId).toBe("legacy.retired-banner");
    expect(orphan?.locale).toBe("fr");
    expect(orphan?.severity).toBe("warning");
  });

  it("is genuinely clean of missing/orphaned findings when both locales cover the exact same entry ids — the contrasting case that proves the failures above were real, not a bug", () => {
    const en = makeRegistry("en");
    const fr = makeRegistry("fr");

    const report = checkLocaleCoverage({ en, fr }, "en", ["en", "fr"]);

    expect(report.complete).toBe(true);
    expect(report.findings.filter((f) => f.rule === "locale-coverage:missing-entry")).toEqual([]);
    expect(report.findings.filter((f) => f.rule === "locale-coverage:orphaned-entry")).toEqual([]);
    expect(report.checkedLocales).toEqual(["fr"]);
    expect(report.skippedLocales).toEqual([]);
  });

  it("always reports the staleness-not-checked notice, even on an otherwise clean run", () => {
    const en = makeRegistry("en");
    const fr = makeRegistry("fr");

    const report = checkLocaleCoverage({ en, fr }, "en", ["en", "fr"]);

    const staleness = report.findings.find((f) => f.rule === "locale-coverage:staleness-not-checked");
    expect(staleness).toBeDefined();
    expect(staleness?.severity).toBe("warning");
  });
});

describe("checkLocaleCoverage — fail-closed: a check that passes because it checked nothing must never look clean", () => {
  it("declines with a distinct finding, complete: false, on an empty registry set", () => {
    const report = checkLocaleCoverage({}, "en", ["en", "fr"]);

    expect(report.complete).toBe(false);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.rule).toBe("locale-coverage:no-registries");
    expect(report.findings[0]?.severity).toBe("error");
  });

  it("declines with a distinct finding, complete: false, when declaredLocales is empty", () => {
    const en = makeRegistry("en");
    const report = checkLocaleCoverage({ en }, "en", []);

    expect(report.complete).toBe(false);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.rule).toBe("locale-coverage:no-declared-locales");
  });

  it("declines with a distinct finding, complete: false, when sourceLocale is not among declaredLocales", () => {
    const en = makeRegistry("en");
    const fr = makeRegistry("fr");
    const report = checkLocaleCoverage({ en, fr }, "en", ["fr"]);

    expect(report.complete).toBe(false);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.rule).toBe("locale-coverage:source-locale-not-declared");
  });

  it("declines with a distinct finding, complete: false, when the source locale has zero entries", () => {
    const en = makeRegistry("en", { entries: [] });
    const fr = makeRegistry("fr");
    const report = checkLocaleCoverage({ en, fr }, "en", ["en", "fr"]);

    expect(report.complete).toBe(false);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.rule).toBe("locale-coverage:source-locale-empty");
  });

  it("declines with a distinct finding, complete: false, when the declared source locale has no registry at all", () => {
    const fr = makeRegistry("fr");
    const report = checkLocaleCoverage({ fr }, "en", ["en", "fr"]);

    expect(report.complete).toBe(false);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.rule).toBe("locale-coverage:source-locale-missing");
  });

  it("declines with a distinct finding, complete: false, when the source registry is structurally invalid", () => {
    const report = checkLocaleCoverage({ en: { id: "acme-app" }, fr: makeRegistry("fr") }, "en", ["en", "fr"]);

    expect(report.complete).toBe(false);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.rule).toBe("locale-coverage:source-registry-invalid");
  });

  it("declines with a distinct finding, complete: false, when the source registry's own locale disagrees with its map key", () => {
    const mislabeled = makeRegistry("de"); // registry.locale is "de" but keyed under "en"
    const report = checkLocaleCoverage({ en: mislabeled, fr: makeRegistry("fr") }, "en", ["en", "fr"]);

    expect(report.complete).toBe(false);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.rule).toBe("locale-coverage:source-registry-locale-mismatch");
  });

  it("reports a declared target locale that is entirely absent as its own loud finding, and marks the run incomplete, without abandoning locales that ARE present", () => {
    const en = makeRegistry("en");
    const fr = makeRegistry("fr");
    // "de" is declared but never supplied in the registry set at all.
    const report = checkLocaleCoverage({ en, fr }, "en", ["en", "fr", "de"]);

    expect(report.complete).toBe(false);
    expect(report.skippedLocales).toEqual([{ locale: "de", reason: "target-locale-missing" }]);
    const missingLocale = report.findings.find((f) => f.rule === "locale-coverage:target-locale-missing");
    expect(missingLocale).toBeDefined();
    expect(missingLocale?.locale).toBe("de");
    // "fr" was present and valid, so it was still checked — one declared
    // locale being entirely absent must not silently swallow the others.
    expect(report.checkedLocales).toEqual(["fr"]);
  });

  it("skips a target locale whose registry is structurally invalid, with its own finding, rather than throwing or silently ignoring it", () => {
    const en = makeRegistry("en");
    const report = checkLocaleCoverage({ en, fr: { id: "acme-app", locale: "fr" } }, "en", ["en", "fr"]);

    expect(report.complete).toBe(false);
    expect(report.skippedLocales).toEqual([{ locale: "fr", reason: "target-registry-invalid" }]);
    expect(report.findings.some((f) => f.rule === "locale-coverage:target-registry-invalid" && f.locale === "fr")).toBe(true);
  });

  it("skips a target locale whose registry's own locale disagrees with its map key", () => {
    const en = makeRegistry("en");
    const mislabeled = makeRegistry("es"); // registry.locale is "es" but keyed under "fr"
    const report = checkLocaleCoverage({ en, fr: mislabeled }, "en", ["en", "fr"]);

    expect(report.complete).toBe(false);
    expect(report.skippedLocales).toEqual([{ locale: "fr", reason: "target-registry-locale-mismatch" }]);
  });

  it("never throws on wildly malformed input", () => {
    expect(() => checkLocaleCoverage({ en: null, fr: "not a registry", zh: 42 }, "en", ["en", "fr", "zh"])).not.toThrow();
    expect(() => checkLocaleCoverage({}, "", [])).not.toThrow();
  });
});
