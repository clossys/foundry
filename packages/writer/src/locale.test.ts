import { describe, expect, it, vi } from "vitest";
import { canonicalLocale, directionFor, fallbackChain } from "./locale.js";
import type { WriterManifest } from "./model/types.js";

type LocaleManifest = Pick<WriterManifest, "defaultLocale" | "locales" | "fallback">;

function manifest(tags: string[], defaultLocale = "en", fallback: Record<string, string[]> = {}): LocaleManifest {
  return { defaultLocale, locales: tags.map(tag => ({ tag, dir: "ltr", state: "active" })), fallback };
}

describe("canonicalLocale", () => {
  it.each([
    ["en-us", "en-US"],
    ["ZH-hant-tw", "zh-Hant-TW"],
    ["iw-IL", "he-IL"],
    ["in-ID", "id-ID"],
    ["en-xa", "en-XA"],
    ["ar-xb", "ar-XB"],
  ])("canonicalizes %s as %s", (input, expected) => {
    expect(canonicalLocale(input)).toBe(expected);
  });

  it.each(["", " ", "en_US", "en--US", "not_a_locale", "en-u", null, undefined, 42, [], {}])(
    "rejects an invalid tag or non-string input %j",
    input => { expect(() => canonicalLocale(input)).toThrow(); },
  );
});

describe("fallbackChain", () => {
  it("canonicalizes the request and returns only declared locales", () => {
    expect(fallbackChain("EN-us", manifest(["en-US", "en"]))).toEqual(["en-US", "en"]);
    const onlyDefault = manifest(["en"]);
    expect(fallbackChain("fr-CA", onlyDefault)).toEqual(["en"]);
    expect(fallbackChain("iw-IL", manifest(["he-IL", "he", "en"]))).toEqual(["he-IL", "he", "en"]);
  });

  it("truncates regional variants without crossing the effective script", () => {
    const value = manifest(["zh-Hant-TW", "zh-Hant", "zh", "zh-Hans", "en"]);
    expect(fallbackChain("zh-Hant-TW", value)).toEqual(["zh-Hant-TW", "zh-Hant", "en"]);
    expect(fallbackChain("zh-Hant-HK", value)).toEqual(["zh-Hant", "en"]);
    expect(fallbackChain("zh-TW", value)).toEqual(["en"]);
  });

  it("removes an extension singleton together with the subtag being truncated", () => {
    const value = manifest(["en-US-u-ca-gregory", "en-US-u-ca", "en-US", "en"]);
    expect(fallbackChain("en-US-u-ca-gregory", value)).toEqual([
      "en-US-u-ca-gregory", "en-US-u-ca", "en-US", "en",
    ]);
  });

  it("removes consecutive trailing singleton private-use subtags before matching", () => {
    const value = manifest(["en-US-x-a-b", "en-US", "en"]);
    expect(fallbackChain("en-US-x-a-b", value)).toEqual(["en-US-x-a-b", "en-US", "en"]);
  });

  it("lets an explicit chain suppress automatic parents and filters undeclared duplicates", () => {
    const value = manifest(["fr-CA", "fr", "de", "en"], "en", {
      "fr-CA": ["de", "fr-CA", "de", "es", "en", "de"],
    });
    expect(fallbackChain("fr-CA", value)).toEqual(["fr-CA", "de", "en"]);
  });

  it("treats an explicit empty chain as a choice to skip automatic parents", () => {
    const value = manifest(["fr-CA", "fr", "en"], "en", { "fr-CA": [] });
    expect(fallbackChain("fr-CA", value)).toEqual(["fr-CA", "en"]);
  });

  it("preserves explicit order and appends the default only if it is unseen", () => {
    const value = manifest(["fr-CA", "fr", "en", "de"], "en", { "fr-CA": ["en", "de", "en"] });
    expect(fallbackChain("fr-CA", value)).toEqual(["fr-CA", "en", "de"]);
    expect(fallbackChain("en", value)).toEqual(["en"]);
  });

  it("never invents an undeclared default", () => {
    expect(fallbackChain("fr-CA", manifest(["fr-CA", "fr"], "en"))).toEqual(["fr-CA", "fr"]);
  });

  it("does not mutate manifest inputs or reuse a returned chain", () => {
    const value = manifest(["fr-CA", "fr", "de", "en"], "en", { "fr-CA": ["de", "fr", "de"] });
    const before = structuredClone(value);
    Object.freeze(value.fallback["fr-CA"]);
    Object.freeze(value.fallback);
    value.locales.forEach(Object.freeze);
    Object.freeze(value.locales);
    Object.freeze(value);
    const first = fallbackChain("fr-CA", value);
    expect(first).toEqual(["fr-CA", "de", "fr", "en"]);
    first.push("es");
    expect(fallbackChain("fr-CA", value)).toEqual(["fr-CA", "de", "fr", "en"]);
    expect(value).toEqual(before);
  });

  it("rejects noncanonical stored declarations, defaults and fallback entries", () => {
    const noncanonicalDeclaration = manifest(["en", "en-us"]);
    expect(() => fallbackChain("en", noncanonicalDeclaration)).toThrow();
    expect(() => fallbackChain("en", manifest(["en", "en-US"], "en-us"))).toThrow();
    expect(() => fallbackChain("en", manifest(["en"], "en", { "fr-ca": [] }))).toThrow();
    expect(() => fallbackChain("en", manifest(["en"], "en", { en: ["en-us"] }))).toThrow();
  });
});

describe("directionFor", () => {
  it("uses declared directions for Arabic and pseudo-locales", () => {
    const value: Pick<WriterManifest, "locales"> = {
      locales: [
        { tag: "ar", dir: "rtl", state: "active" },
        { tag: "en-XA", dir: "ltr", state: "pseudo" },
        { tag: "ar-XB", dir: "rtl", state: "pseudo" },
      ],
    };
    expect(directionFor("ar", value)).toBe("rtl");
    expect(directionFor("en-XA", value)).toBe("ltr");
    expect(directionFor("ar-XB", value)).toBe("rtl");
    expect(directionFor("AR-xb", value)).toBe("rtl");
  });

  it("treats the manifest as authority without requiring runtime Intl direction support", () => {
    const value: Pick<WriterManifest, "locales"> = {
      locales: [{ tag: "ar", dir: "ltr", state: "active" }, { tag: "en", dir: "rtl", state: "active" }],
    };
    const localeConstructor = vi.spyOn(Intl, "Locale").mockImplementation(() => {
      throw new Error("Runtime locale direction is unavailable");
    });
    try {
      expect(directionFor("ar", value)).toBe("ltr");
      expect(directionFor("en", value)).toBe("rtl");
    } finally {
      localeConstructor.mockRestore();
    }
  });

  it("throws for an undeclared locale or missing direction rather than inferring it", () => {
    expect(() => directionFor("ar", { locales: [] })).toThrow();
    const value = { locales: [{ tag: "ar", state: "active" }] } as unknown as Pick<WriterManifest, "locales">;
    expect(() => directionFor("ar", value)).toThrow();
  });
});
