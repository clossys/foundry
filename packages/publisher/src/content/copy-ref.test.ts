import { describe, expect, it, vi } from "vitest";
import { createCopyResolver, resolveCopyRef } from "@clossys/writer";
import type { CopyResolver } from "@clossys/writer";
import { PAGE_META_KEY, resolveCopy, validateCopyFields } from "./composition.js";
import type { CopyField } from "./composition.js";
import { computeContentDigest } from "./digest.js";
import { checkPageMetadata } from "./metadata.js";
import { localeRoutesFixture, localeRouteOrigin } from "./__fixtures__/locale-routes.js";
import { createContentRevision } from "./revisions.js";
import {
  approvedCopyEntry, copyRefCandidate, copyRefFixtureAt, copyRefRuntimeFixture,
  refField, withCopyRefBody,
} from "./__fixtures__/copy-ref.js";

describe("Publisher Writer CopyRef resolution", () => {
  it.each(["en", "ar"])("formats approved %s ICU copy through the actual Writer resolver", locale => {
    const runtime = copyRefRuntimeFixture();
    const candidate = copyRefCandidate();
    const before = structuredClone(candidate);
    const result = resolveCopy(candidate, locale, { resolver: runtime.resolver, requirePageMeta: true });
    const number = new Intl.NumberFormat(locale);
    const expected = locale === "ar"
      ? `${number.format(3)} ملفات — ${number.format(1234.5)}`
      : `${number.format(3)} files — ${number.format(1234.5)}`;
    const writer = resolveCopyRef(runtime.en, {
      id: "body.summary", locale, values: { count: 3, amount: 1234.5 },
    }, runtime.options);

    expect(writer.complete).toBe(true);
    expect(writer.resolution?.text).toBe(expected);
    expect(result.copy.intro?.summary).toBe(expected);
    expect(result.copy[PAGE_META_KEY]?.title).toBe(locale === "ar" ? "الملفات" : "Files");
    expect(result.findings).toEqual([]);
    expect(result.complete).toBe(true);
    expect(candidate).toEqual(before);
    expect(candidate).not.toHaveProperty("copy");
    expect(candidate).not.toHaveProperty("findings");
    expect(JSON.stringify(result.copy)).not.toContain("plural");
  });

  it("combines native Writer metadata resolution with complete locale route evidence", () => {
    const runtime = copyRefRuntimeFixture();
    const { registry, options } = localeRoutesFixture();
    const slot = { ...registry.slots[0]!, locales: ["en", "ar"], meta: { canonical: {
      en: `${localeRouteOrigin}/about`, ar: `${localeRouteOrigin}/ar/about`,
    } } };
    const candidate = copyRefCandidate();
    const combined = {
      ...options, resolver: runtime.resolver, manifest: runtime.manifest,
      workspace: { ...options.workspace, defaultLocale: "en", locales: ["en", "ar"] },
      bodyServedLocales: { en: ["en"], ar: ["ar"] },
      existingUrls: [`${localeRouteOrigin}/about`, `${localeRouteOrigin}/ar/about`],
    };
    expect(resolveCopy(candidate, "ar", combined).copy.$pageMeta?.title).toBe("الملفات");
    expect(checkPageMetadata(slot, candidate, undefined, combined)).toEqual([]);
    expect(checkPageMetadata(slot, candidate, undefined, {
      ...combined, existingUrls: [`${localeRouteOrigin}/about`],
    })).toContainEqual(expect.objectContaining({ rule: "hreflang-target-missing", severity: "error" }));
  });

  it("reports missing page metadata for the requested declared locale", () => {
    const runtime = copyRefRuntimeFixture();
    const original = copyRefCandidate();
    const candidate = {
      ...original,
      pageMeta: original.pageMeta!.filter(field => !(field.locale === "ar" && field.key === "title")),
    };
    expect(resolveCopy(candidate, "en", { resolver: runtime.resolver, requirePageMeta: true }).complete).toBe(true);
    const result = resolveCopy(candidate, "ar", { resolver: runtime.resolver, requirePageMeta: true });
    expect(result.complete).toBe(false);
    expect(result.copy[PAGE_META_KEY]).not.toHaveProperty("title");
    expect(result.findings).toContainEqual(expect.objectContaining({ severity: "error", locale: "ar" }));
    expect(result.findings.some(finding => finding.path.includes("pageMeta"))).toBe(true);
  });

  it("rejects fallback metadata and omits its text", () => {
    const runtime = copyRefRuntimeFixture();
    const original = copyRefCandidate();
    const candidate = {
      ...original,
      pageMeta: original.pageMeta!.map(field => field.locale === "ar" && field.key === "title"
        ? refField("title", "ar", "copy.fallback") : field),
    };
    const result = resolveCopy(candidate, "ar", { resolver: runtime.resolver, requirePageMeta: true });
    expect(result.complete).toBe(false);
    expect(result.copy[PAGE_META_KEY]).not.toHaveProperty("title");
    expect(result.findings).toContainEqual(expect.objectContaining({
      severity: "error", locale: "ar", servedLocale: "en", chain: ["ar", "en"],
    }));
    expect(JSON.stringify(result.copy)).not.toContain("Available in English");
  });

  it("retains body fallback with a warning and its served locale and chain", () => {
    const runtime = copyRefRuntimeFixture();
    const candidate = withCopyRefBody(copyRefCandidate(), [refField("summary", "ar", "copy.fallback")]);
    const result = resolveCopy(candidate, "ar", { resolver: runtime.resolver, requirePageMeta: true });
    expect(result.copy.intro?.summary).toBe("Available in English");
    expect(result.complete).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({
      severity: "warning", locale: "ar", servedLocale: "en", chain: ["ar", "en"],
    }));
    expect(result.findings.some(finding => finding.severity === "error")).toBe(false);
  });

  it.each(["handwritten", "writer"] as const)("keeps legacy %s inline copy readable with a warning", source => {
    const field: CopyField = { key: "summary", locale: "en", source, value: "Legacy text" };
    expect(validateCopyFields([field], "fields")).toEqual([]);
    const candidate = withCopyRefBody(copyRefCandidate(), [field]);
    const result = resolveCopy(candidate, "en", { resolver: copyRefRuntimeFixture().resolver });
    expect(result.copy.intro?.summary).toBe("Legacy text");
    expect(result.complete).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({ severity: "warning", locale: "en" }));
    expect(result.findings.some(finding => finding.severity === "error")).toBe(false);
  });

  it.each(["no-resolver", "missing", "draft"] as const)("fails closed for %s without leaking a ref or cached copy", failure => {
    const runtime = copyRefRuntimeFixture();
    const id = failure === "missing" ? "copy.absent" : failure === "draft" ? "copy.guarded" : "body.summary";
    const values = failure === "no-resolver" ? { count: 3, amount: 1234.5 } : undefined;
    const original = withCopyRefBody(copyRefCandidate(), [refField("summary", "ar", id, values)]);
    // Resolve another candidate first so a previous success cannot fill a later failure.
    expect(resolveCopy(copyRefCandidate(), "ar", { resolver: runtime.resolver }).complete).toBe(true);
    const candidate = { ...original, pageMeta: [] };
    const result = resolveCopy(candidate, "ar", failure === "no-resolver" ? {} : { resolver: runtime.resolver });
    expect(result.complete).toBe(false);
    expect(result.copy.intro).not.toHaveProperty("summary");
    expect(result.findings).toContainEqual(expect.objectContaining({ severity: "error", locale: "ar" }));
    expect(Object.values(result.copy).flatMap(section => Object.values(section))).toEqual([]);
  });

  it("does not reuse a previous resolution when the same candidate's resolver stops resolving", () => {
    const runtime = copyRefRuntimeFixture();
    const candidate = { ...copyRefCandidate(), pageMeta: [] };
    expect(resolveCopy(candidate, "en", { resolver: runtime.resolver }).copy.intro?.summary).toContain("3 files");
    const result = resolveCopy(candidate, "en", { resolver: () => undefined });
    expect(result.complete).toBe(false);
    expect(result.copy.intro).not.toHaveProperty("summary");
    expect(result.findings.some(finding => finding.severity === "error")).toBe(true);
  });

  it("allows the same CopyRef to be used by multiple pages", () => {
    const runtime = copyRefRuntimeFixture();
    const first = copyRefCandidate();
    const second = { ...copyRefCandidate(), name: "Another page" };
    expect(validateCopyFields(first.pageMeta, "pageMeta")).toEqual([]);
    const a = resolveCopy(first, "en", { resolver: runtime.resolver, requirePageMeta: true });
    const b = resolveCopy(second, "en", { resolver: runtime.resolver, requirePageMeta: true });
    expect(a.complete).toBe(true);
    expect(b.complete).toBe(true);
    expect(a.copy[PAGE_META_KEY]?.title).toBe(b.copy[PAGE_META_KEY]?.title);
    expect(a.findings).toEqual([]);
    expect(b.findings).toEqual([]);
  });

  it("passes the requested locale to callbacks even when the stored ref omits it", () => {
    const runtime = copyRefRuntimeFixture();
    const resolver = vi.fn(runtime.resolver);
    const candidate = copyRefCandidate();
    const before = structuredClone(candidate);
    resolveCopy(candidate, "ar", { resolver, requirePageMeta: true });
    expect(resolver).toHaveBeenCalledTimes(3);
    for (const [ref] of resolver.mock.calls) expect(ref.locale).toBe("ar");
    expect(candidate).toEqual(before);
  });

  it("refuses a callback resolution for a different requested locale", () => {
    const runtime = copyRefRuntimeFixture();
    const resolver: CopyResolver = ref => runtime.resolver({ ...ref, locale: "en" });
    const result = resolveCopy(copyRefCandidate(), "ar", { resolver, requirePageMeta: true });
    expect(result.complete).toBe(false);
    expect(result.copy.intro).not.toHaveProperty("summary");
    expect(result.copy[PAGE_META_KEY]).not.toHaveProperty("title");
    expect(result.findings.some(finding => finding.severity === "error")).toBe(true);
  });

  it("rejects mixed ref/value fields and noncanonical stored locales", () => {
    const valid = refField("summary", "en", "body.summary", { count: 3, amount: 1234.5 });
    const mixed = { ...valid, value: "Cached English text" };
    expect(validateCopyFields([mixed], "fields").length).toBeGreaterThan(0);
    expect(validateCopyFields([{ ...valid, locale: "en-us" }], "fields").length).toBeGreaterThan(0);
    expect(validateCopyFields([{
      ...valid, ref: { id: "body.summary", locale: "en-us", values: { count: 3, amount: 1234.5 } },
    }], "fields").length).toBeGreaterThan(0);
    expect(() => resolveCopy(copyRefCandidate(), "en-us", { resolver: copyRefRuntimeFixture().resolver })).toThrow(TypeError);
  });
});

describe("CopyRef revision identity", () => {
  it("hashes ref ids and ICU values, while excluding resolved text and reports", () => {
    const candidate = copyRefCandidate();
    const original = createContentRevision(candidate, "r1", copyRefFixtureAt);
    const changedId = withCopyRefBody(candidate, [refField("summary", "en", "body.alternative", { count: 3, amount: 1234.5 })]);
    const changedValues = withCopyRefBody(candidate, [refField("summary", "en", "body.summary", { count: 4, amount: 1234.5 })]);
    const comparable = withCopyRefBody(candidate, [refField("summary", "en", "body.summary", { count: 3, amount: 1234.5 })]);
    const comparableDigest = computeContentDigest(comparable);
    expect(computeContentDigest(changedId)).not.toBe(comparableDigest);
    expect(computeContentDigest(changedValues)).not.toBe(comparableDigest);

    const runtime = copyRefRuntimeFixture();
    const before = resolveCopy(candidate, "en", { resolver: runtime.resolver, requirePageMeta: true });
    const entryIndex = runtime.en.entries.findIndex(entry => entry.id === "page.title");
    runtime.en.entries[entryIndex] = approvedCopyEntry("page.title", "Updated approved files");
    const after = resolveCopy(candidate, "en", {
      resolver: createCopyResolver(runtime.en, runtime.options), requirePageMeta: true,
    });
    expect(before.copy[PAGE_META_KEY]?.title).toBe("Files");
    expect(after.copy[PAGE_META_KEY]?.title).toBe("Updated approved files");
    expect(computeContentDigest(candidate)).toBe(original.digest);
    const withExternalCache = { ...candidate, resolvedCopy: after.copy, copyReport: after };
    expect(computeContentDigest(withExternalCache)).toBe(original.digest);
    expect(createContentRevision(withExternalCache, "r2", copyRefFixtureAt).content).not.toHaveProperty("resolvedCopy");
    expect(original.content).not.toHaveProperty("copyReport");
    expect(original.content.composition?.sections[0]?.fields[0]).toEqual(refField("summary", "en", "body.summary", { count: 3, amount: 1234.5 }));
  });
});
