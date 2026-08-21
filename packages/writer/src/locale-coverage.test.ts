import { describe, expect, it } from "vitest";
import { computeCopyFingerprint } from "./fingerprint.js";
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

  it("never reports the removed staleness-not-checked notice — real staleness checking has landed", () => {
    const en = makeRegistry("en");
    const fr = makeRegistry("fr");

    const report = checkLocaleCoverage({ en, fr }, "en", ["en", "fr"]);

    expect(report.findings.some((f) => f.rule === "locale-coverage:staleness-not-checked")).toBe(false);
  });
});

describe("checkLocaleCoverage — stale-entry vs. provenance-missing: distinct, never collapsed", () => {
  it("reports no stale/provenance finding when a target entry's recorded sourceFingerprint matches the source's current text", () => {
    const en = makeRegistry("en");
    const fr = makeRegistry("fr", {
      entries: [
        {
          id: "pagination.no-results",
          text: "Aucun résultat trouvé.",
          context: "search results page",
          status: "approved",
          translation: {
            sourceFingerprint: computeCopyFingerprint("No results found."),
            fingerprintAlgorithm: "sha256",
            translatedAt: "2026-08-01T00:00:00.000Z",
          },
        },
        { id: "dashboard.welcome", text: "Content de vous revoir.", context: "dashboard header", status: "approved" },
      ],
    });

    const report = checkLocaleCoverage({ en, fr }, "en", ["en", "fr"]);

    expect(report.findings.filter((f) => f.rule === "locale-coverage:stale-entry")).toEqual([]);
    expect(
      report.findings.filter((f) => f.rule === "locale-coverage:provenance-missing" && f.entryId === "pagination.no-results"),
    ).toEqual([]);
  });

  it("reports stale-entry when the source text was edited after the recorded sourceFingerprint was computed", () => {
    const en = makeRegistry("en", {
      entries: [
        // Source text has since been edited — the fingerprint below was
        // computed against the OLD text, not this one.
        { id: "pagination.no-results", text: "No results found for that search.", context: "search results page", status: "approved" },
        { id: "dashboard.welcome", text: "Welcome back.", context: "dashboard header", status: "approved" },
      ],
    });
    const fr = makeRegistry("fr", {
      entries: [
        {
          id: "pagination.no-results",
          text: "Aucun résultat trouvé.",
          context: "search results page",
          status: "approved",
          translation: {
            sourceFingerprint: computeCopyFingerprint("No results found."), // the OLD source text
            fingerprintAlgorithm: "sha256",
            translatedAt: "2026-08-01T00:00:00.000Z",
          },
        },
        { id: "dashboard.welcome", text: "Content de vous revoir.", context: "dashboard header", status: "approved" },
      ],
    });

    const report = checkLocaleCoverage({ en, fr }, "en", ["en", "fr"]);

    const stale = report.findings.find((f) => f.rule === "locale-coverage:stale-entry");
    expect(stale).toBeDefined();
    expect(stale?.entryId).toBe("pagination.no-results");
    expect(stale?.locale).toBe("fr");
    expect(stale?.severity).toBe("warning");
  });

  it("reports provenance-missing, never stale-entry, for a target entry with no translation field at all", () => {
    const en = makeRegistry("en");
    const fr = makeRegistry("fr"); // makeRegistry's entries never set `translation`

    const report = checkLocaleCoverage({ en, fr }, "en", ["en", "fr"]);

    const missingProvenance = report.findings.filter((f) => f.rule === "locale-coverage:provenance-missing");
    expect(missingProvenance).toHaveLength(2); // both entries lack translation
    expect(missingProvenance.every((f) => f.severity === "warning")).toBe(true);
    expect(report.findings.some((f) => f.rule === "locale-coverage:stale-entry")).toBe(false);
  });

  it("keeps provenance-missing and stale-entry as genuinely different outcomes across a mixed registry", () => {
    const en = makeRegistry("en");
    const fr = makeRegistry("fr", {
      entries: [
        {
          // Current: fingerprint matches, so no finding at all for this one.
          id: "pagination.no-results",
          text: "Aucun résultat trouvé.",
          context: "search results page",
          status: "approved",
          translation: {
            sourceFingerprint: computeCopyFingerprint("No results found."),
            fingerprintAlgorithm: "sha256",
            translatedAt: "2026-08-01T00:00:00.000Z",
          },
        },
        {
          // No translation field at all: cannot tell.
          id: "dashboard.welcome",
          text: "Content de vous revoir.",
          context: "dashboard header",
          status: "approved",
        },
      ],
    });

    const report = checkLocaleCoverage({ en, fr }, "en", ["en", "fr"]);

    expect(report.findings.filter((f) => f.rule === "locale-coverage:stale-entry")).toEqual([]);
    const provenanceMissing = report.findings.filter((f) => f.rule === "locale-coverage:provenance-missing");
    expect(provenanceMissing).toHaveLength(1);
    expect(provenanceMissing[0]?.entryId).toBe("dashboard.welcome");
  });
});

describe("checkLocaleCoverage — interpolation parity, both directions", () => {
  it("reports interpolation-missing when a target translation drops a placeholder the source declares", () => {
    const en = makeRegistry("en", {
      entries: [
        {
          id: "pagination.range",
          text: "Showing {start}–{end} of {total} results.",
          context: "search results page, pagination footer",
          placeholders: ["start", "end", "total"],
          status: "approved",
        },
      ],
    });
    const fr = makeRegistry("fr", {
      entries: [
        {
          id: "pagination.range",
          // "total" was dropped from the translation's placeholders.
          text: "Affichage de {start} à {end}.",
          context: "search results page, pagination footer",
          placeholders: ["start", "end"],
          status: "approved",
        },
      ],
    });

    const report = checkLocaleCoverage({ en, fr }, "en", ["en", "fr"]);

    const missing = report.findings.find((f) => f.rule === "locale-coverage:interpolation-missing");
    expect(missing).toBeDefined();
    expect(missing?.entryId).toBe("pagination.range");
    expect(missing?.locale).toBe("fr");
    expect(missing?.severity).toBe("error");
  });

  it("reports interpolation-extra when a target translation declares a placeholder the source does not", () => {
    const en = makeRegistry("en", {
      entries: [
        {
          id: "pagination.range",
          text: "Showing {start}–{end}.",
          context: "search results page, pagination footer",
          placeholders: ["start", "end"],
          status: "approved",
        },
      ],
    });
    const fr = makeRegistry("fr", {
      entries: [
        {
          id: "pagination.range",
          // "total" was added to the translation's placeholders, but the
          // source entry never declared it.
          text: "Affichage de {start} à {end} sur {total}.",
          context: "search results page, pagination footer",
          placeholders: ["start", "end", "total"],
          status: "approved",
        },
      ],
    });

    const report = checkLocaleCoverage({ en, fr }, "en", ["en", "fr"]);

    const extra = report.findings.find((f) => f.rule === "locale-coverage:interpolation-extra");
    expect(extra).toBeDefined();
    expect(extra?.entryId).toBe("pagination.range");
    expect(extra?.locale).toBe("fr");
    expect(extra?.severity).toBe("error");
  });

  it("reports no interpolation finding when both locales declare the exact same placeholder set", () => {
    const en = makeRegistry("en", {
      entries: [
        {
          id: "pagination.range",
          text: "Showing {start}–{end}.",
          context: "search results page, pagination footer",
          placeholders: ["start", "end"],
          status: "approved",
        },
      ],
    });
    const fr = makeRegistry("fr", {
      entries: [
        {
          id: "pagination.range",
          text: "Affichage de {start} à {end}.",
          context: "search results page, pagination footer",
          placeholders: ["start", "end"],
          status: "approved",
        },
      ],
    });

    const report = checkLocaleCoverage({ en, fr }, "en", ["en", "fr"]);

    expect(report.findings.filter((f) => f.rule === "locale-coverage:interpolation-missing")).toEqual([]);
    expect(report.findings.filter((f) => f.rule === "locale-coverage:interpolation-extra")).toEqual([]);
  });

  it("checks interpolation parity independently of staleness/provenance — an entry with no translation field still gets checked", () => {
    const en = makeRegistry("en", {
      entries: [
        {
          id: "pagination.range",
          text: "Showing {start}–{end}.",
          context: "search results page, pagination footer",
          placeholders: ["start", "end"],
          status: "approved",
        },
      ],
    });
    const fr = makeRegistry("fr", {
      entries: [
        {
          id: "pagination.range",
          text: "Affichage de {start}.",
          context: "search results page, pagination footer",
          placeholders: ["start"], // "end" missing, and no `translation` field either
          status: "approved",
        },
      ],
    });

    const report = checkLocaleCoverage({ en, fr }, "en", ["en", "fr"]);

    expect(report.findings.some((f) => f.rule === "locale-coverage:interpolation-missing" && f.entryId === "pagination.range")).toBe(
      true,
    );
    expect(report.findings.some((f) => f.rule === "locale-coverage:provenance-missing" && f.entryId === "pagination.range")).toBe(
      true,
    );
  });

  it("combines missing coverage, orphaned entries, staleness, and interpolation findings across multiple target locales in one run", () => {
    const en = makeRegistry("en", {
      entries: [
        { id: "pagination.no-results", text: "No results found.", context: "search results page", status: "approved" },
        { id: "dashboard.welcome", text: "Welcome back.", context: "dashboard header", status: "approved" },
        {
          id: "pagination.range",
          text: "Showing {start}–{end} of {total}.",
          context: "search results page, pagination footer",
          placeholders: ["start", "end", "total"],
          status: "approved",
        },
      ],
    });
    const fr = makeRegistry("fr", {
      entries: [
        // stale: fingerprint recorded against old text
        {
          id: "pagination.no-results",
          text: "Aucun résultat trouvé.",
          context: "search results page",
          status: "approved",
          translation: {
            sourceFingerprint: computeCopyFingerprint("an old source sentence"),
            fingerprintAlgorithm: "sha256",
            translatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
        // dashboard.welcome is MISSING from fr entirely
        // interpolation-missing on pagination.range
        {
          id: "pagination.range",
          text: "Affichage de {start} à {end}.",
          context: "search results page, pagination footer",
          placeholders: ["start", "end"],
          status: "approved",
        },
        // orphaned: no counterpart in en
        { id: "legacy.retired-banner", text: "Bannière retirée.", context: "old banner", status: "approved" },
      ],
    });
    const de = makeRegistry("de", {
      entries: [
        { id: "pagination.no-results", text: "Keine Ergebnisse gefunden.", context: "search results page", status: "approved" },
        { id: "dashboard.welcome", text: "Willkommen zurück.", context: "dashboard header", status: "approved" },
        {
          id: "pagination.range",
          text: "Zeige {start}–{end} von {total}.",
          context: "search results page, pagination footer",
          placeholders: ["start", "end", "total"],
          status: "approved",
        },
      ],
    });

    const report = checkLocaleCoverage({ en, fr, de }, "en", ["en", "fr", "de"]);

    expect(report.complete).toBe(true);
    expect(report.checkedLocales.sort()).toEqual(["de", "fr"]);

    // fr: missing-entry, stale-entry, interpolation-missing, orphaned-entry, and
    // provenance-missing for pagination.range (never set `translation`).
    expect(report.findings.some((f) => f.rule === "locale-coverage:missing-entry" && f.locale === "fr" && f.entryId === "dashboard.welcome")).toBe(true);
    expect(report.findings.some((f) => f.rule === "locale-coverage:stale-entry" && f.locale === "fr" && f.entryId === "pagination.no-results")).toBe(true);
    expect(report.findings.some((f) => f.rule === "locale-coverage:interpolation-missing" && f.locale === "fr" && f.entryId === "pagination.range")).toBe(true);
    expect(report.findings.some((f) => f.rule === "locale-coverage:orphaned-entry" && f.locale === "fr" && f.entryId === "legacy.retired-banner")).toBe(true);
    expect(report.findings.some((f) => f.rule === "locale-coverage:provenance-missing" && f.locale === "fr")).toBe(true);

    // de: fully covered, no `translation` on any entry, all placeholders in
    // parity — the only findings for de are provenance-missing (every entry
    // lacks `translation`), never stale-entry or interpolation findings.
    expect(report.findings.some((f) => f.rule === "locale-coverage:missing-entry" && f.locale === "de")).toBe(false);
    expect(report.findings.some((f) => f.rule === "locale-coverage:orphaned-entry" && f.locale === "de")).toBe(false);
    expect(report.findings.some((f) => f.rule === "locale-coverage:stale-entry" && f.locale === "de")).toBe(false);
    expect(report.findings.some((f) => f.rule === "locale-coverage:interpolation-missing" && f.locale === "de")).toBe(false);
    expect(report.findings.some((f) => f.rule === "locale-coverage:interpolation-extra" && f.locale === "de")).toBe(false);
    expect(report.findings.filter((f) => f.rule === "locale-coverage:provenance-missing" && f.locale === "de")).toHaveLength(3);
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
