import { describe, expect, it } from "vitest";
import { createCopyResolver, resolveCopyRef } from "./resolve.js";
import { computeCopyFingerprint, COPY_FINGERPRINT_ALGORITHM } from "./fingerprint.js";
import type { WriterManifest } from "./model/types.js";
import type { CopyRef, CopyRegistry, CopyRegistryEntry } from "./types.js";

type LocalePolicy = Pick<WriterManifest, "defaultLocale" | "locales" | "fallback">;

const now = new Date("2026-09-27T00:00:00.000Z");

function approved(id: string, text: string, placeholders: string[] = []): CopyRegistryEntry {
  return {
    id,
    text,
    context: "ICU runtime test fixture",
    placeholders,
    status: "approved",
    approval: {
      approvedBy: "owner",
      approvedAt: "2026-08-01T00:00:00.000Z",
      textFingerprint: computeCopyFingerprint(text),
      fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM,
    },
  };
}

function registry(locale: string, entries: CopyRegistryEntry[]): CopyRegistry {
  return {
    id: `icu-fixture-${locale}`,
    locale,
    revision: "2026-09-01",
    source: { kind: "consumer", reference: "test-fixtures/icu-runtime" },
    entries,
  };
}

function policy(tags: string[], defaultLocale = "en", fallback: Record<string, string[]> = {}): LocalePolicy {
  return { defaultLocale, locales: tags.map(tag => ({ tag, dir: "ltr", state: "active" })), fallback };
}

function expectUnresolved(result: ReturnType<typeof resolveCopyRef>): void {
  expect(result.complete).toBe(false);
  expect(result.resolution).toBeUndefined();
  expect(result.issues.length).toBeGreaterThan(0);
}

describe("ICU CopyRef runtime", () => {
  it.each([[1, "1 item"], [5, "5 items"]] as const)("formats English plural count %s", (count, text) => {
    const source = registry("en-US", [
      approved("fixture.plural", "{count, plural, one {# item} other {# items}}", ["count"]),
    ]);
    const result = resolveCopyRef(source, { id: "fixture.plural", values: { count } });
    expect(result.complete).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.resolution).toMatchObject({ text, locale: "en-US", servedLocale: "en-US", chain: ["en-US"] });
  });

  it.each([["female", "She"], ["male", "He"], ["other", "They"]] as const)("formats gender select %s", (gender, text) => {
    const source = registry("en-US", [
      approved("fixture.select", "{gender, select, female {She} male {He} other {They}}", ["gender"]),
    ]);
    expect(createCopyResolver(source)({ id: "fixture.select", values: { gender } })?.text).toBe(text);
  });

  it("formats nested select/plural branches and subtracts plural offsets only from #", () => {
    const source = registry("en-US", [approved(
      "fixture.nested",
      "{gender, select, female {{count, plural, offset:1 =0 {Nobody} =1 {Only her} one {She and # other} other {She and # others}}} other {{count, plural, offset:1 =0 {Nobody} =1 {Only them} one {They and # other} other {They and # others}}}}",
      ["gender", "count"],
    )]);
    const resolve = createCopyResolver(source);
    expect(resolve({ id: "fixture.nested", values: { gender: "female", count: 1 } })?.text).toBe("Only her");
    expect(resolve({ id: "fixture.nested", values: { gender: "female", count: 2 } })?.text).toBe("She and 1 other");
    expect(resolve({ id: "fixture.nested", values: { gender: "other", count: 5 } })?.text).toBe("They and 4 others");
  });

  it("keeps simple scalar interpolation and renders booleans as literal strings", () => {
    const source = registry("en-US", [approved("fixture.scalars", "{name}: {count}; {enabled}", ["name", "count", "enabled"])]);
    const resolve = createCopyResolver(source);
    expect(resolve({ id: "fixture.scalars", values: { name: "Fixture", count: 5, enabled: true } })?.text).toBe("Fixture: 5; true");
    expect(resolve({ id: "fixture.scalars", values: { name: "Fixture", count: 0, enabled: false } })?.text).toBe("Fixture: 0; false");
  });

  it("formats numbers using the served registry's locale after fallback", () => {
    const source = registry("en", [approved("fixture.number", "{amount, number}", ["amount"])]);
    const french = registry("fr", [approved("fixture.number", "{amount, number}", ["amount"])]);
    const result = resolveCopyRef(source, { id: "fixture.number", locale: "fr-CA", values: { amount: 12345.5 } }, {
      manifest: policy(["en", "fr", "fr-CA"]), registries: [french],
    });
    expect(result.complete).toBe(true);
    expect(result.resolution).toMatchObject({
      text: new Intl.NumberFormat("fr").format(12345.5),
      servedLocale: "fr",
      locale: "fr",
      chain: ["fr-CA", "fr", "en"],
      recordId: french.id,
      revision: french.revision,
      source: french.source,
    });
  });

  it("falls through missing locales and ids separately, retaining the full policy chain", () => {
    const source = registry("en", [approved("fixture.default", "Default fixture")]);
    const french = registry("fr", [approved("fixture.parent", "Parent fixture")]);
    const manifest = policy(["fr-CA", "fr", "en"]);
    const options = { manifest, registries: [french] };
    const parent = resolveCopyRef(source, { id: "fixture.parent", locale: "fr-CA" }, options);
    const fallback = resolveCopyRef(source, { id: "fixture.default", locale: "fr-CA" }, options);
    expect(parent.resolution).toMatchObject({ text: "Parent fixture", servedLocale: "fr", locale: "fr", chain: ["fr-CA", "fr", "en"] });
    expect(fallback.resolution).toMatchObject({ text: "Default fixture", servedLocale: "en", locale: "en", chain: ["fr-CA", "fr", "en"] });
    expect(parent.complete).toBe(true);
    expect(fallback.complete).toBe(true);
    expect(createCopyResolver(source, options)({ id: "fixture.default", locale: "fr-CA" })).toMatchObject({ servedLocale: "en", chain: ["fr-CA", "fr", "en"] });
  });

  it("synthesizes locale declarations and uses the first registry as default without a manifest", () => {
    const source = registry("en", [approved("fixture.default", "Default fixture")]);
    const french = registry("fr", [approved("fixture.parent", "Parent fixture")]);
    const options = { registries: [french] };
    expect(resolveCopyRef(source, { id: "fixture.parent", locale: "fr-CA" }, options).resolution).toMatchObject({
      text: "Parent fixture", servedLocale: "fr", chain: ["fr", "en"],
    });
    expect(resolveCopyRef(source, { id: "fixture.default", locale: "fr-CA" }, options).resolution).toMatchObject({
      text: "Default fixture", servedLocale: "en", chain: ["fr", "en"],
    });
    expect(resolveCopyRef(source, { id: "fixture.default" }, options).resolution).toMatchObject({ servedLocale: "en", chain: ["en"] });
  });

  it("honors explicit fallback order even after an earlier registry supplies the id", () => {
    const source = registry("en", [approved("fixture.chain", "Default fixture")]);
    const canadian = registry("fr-CA", [approved("fixture.chain", "Requested fixture")]);
    const manifest = policy(["fr-CA", "fr", "de", "en"], "en", { "fr-CA": ["de", "fr", "de"] });
    expect(resolveCopyRef(source, { id: "fixture.chain", locale: "fr-CA" }, { manifest, registries: [canadian] }).resolution).toMatchObject({
      text: "Requested fixture", servedLocale: "fr-CA", chain: ["fr-CA", "de", "fr", "en"],
    });
  });

  it("keeps caller registries, values, and locale policy immutable and returns independent chains", () => {
    const source = registry("en", [approved("fixture.value", "{value}", ["value"])]);
    const manifest = policy(["fr-CA", "fr", "en"], "en", { "fr-CA": ["fr"] });
    const ref = { id: "fixture.value", locale: "fr-CA", values: { value: "Fixture" } };
    const before = JSON.stringify({ source, manifest, ref });
    Object.freeze(ref.values);
    Object.freeze(ref);
    Object.freeze(source.entries[0]?.placeholders);
    Object.freeze(source.entries[0]?.approval);
    Object.freeze(source.entries[0]);
    Object.freeze(source.entries);
    Object.freeze(source.source);
    Object.freeze(source);
    for (const locale of manifest.locales) Object.freeze(locale);
    Object.freeze(manifest.locales);
    Object.freeze(manifest.fallback["fr-CA"]);
    Object.freeze(manifest.fallback);
    Object.freeze(manifest);
    const resolve = createCopyResolver(source, { manifest, registries: Object.freeze([]) });
    const first = resolve(ref);
    const second = resolve(ref);
    expect(first).toMatchObject({ text: "Fixture", servedLocale: "en", chain: ["fr-CA", "fr", "en"] });
    expect(second?.chain).toEqual(["fr-CA", "fr", "en"]);
    expect(first?.chain).not.toBe(second?.chain);
    expect(JSON.stringify({ source, manifest, ref })).toBe(before);
  });

  it("avoids a Simplified Chinese parent when a Traditional Chinese request falls back", () => {
    const source = registry("en", [approved("fixture.script", "Default fixture")]);
    const simplified = registry("zh", [approved("fixture.script", "Simplified fixture")]);
    const traditional = registry("zh-Hant", [approved("fixture.script", "Traditional fixture")]);
    const result = resolveCopyRef(source, { id: "fixture.script", locale: "zh-Hant-TW" }, {
      manifest: policy(["zh-Hant-TW", "zh-Hant", "zh", "en"]),
      registries: [simplified, traditional],
    });
    expect(result.resolution).toMatchObject({ text: "Traditional fixture", servedLocale: "zh-Hant", chain: ["zh-Hant-TW", "zh-Hant", "en"] });
  });

  it.each(["UTC", "America/Los_Angeles", "Asia/Tokyo"])("defaults dates to UTC and honors an override under host TZ %s", hostZone => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = hostZone;
      const source = registry("en-US", [approved("fixture.date", "{instant, date, long}", ["instant"])]);
      const ref = { id: "fixture.date", values: { instant: Date.parse("2020-01-01T00:30:00.000Z") } };
      const implicitUtc = resolveCopyRef(source, ref);
      const explicitUtc = resolveCopyRef(source, ref, { timeZone: "UTC" });
      const pacific = resolveCopyRef(source, ref, { timeZone: "America/Los_Angeles" });
      expect(implicitUtc.resolution?.text).toBe("January 1, 2020");
      expect(explicitUtc.resolution?.text).toBe("January 1, 2020");
      expect(pacific.resolution?.text).toBe("December 31, 2019");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it.each([
    { text: "{count, plural, one {one} other {many}", placeholders: ["count"], values: { count: 1 } },
    { text: "{count, plural, one {one} other {many}}", placeholders: ["count"], values: {} },
    { text: "{instant, date, long}", placeholders: ["instant"], values: { instant: new Date(0) } },
    { text: "{instant, date, long}", placeholders: ["instant"], values: { instant: Number.NaN } },
    { text: "{instant, date, long}", placeholders: ["instant"], values: { instant: Number.POSITIVE_INFINITY } },
    { text: "{instant, date, long}", placeholders: ["instant"], values: { instant: "2020-01-01" } },
    { text: "{value}", placeholders: ["value"], values: { value: { type: "date", value: 0 } } },
    { text: "{value}", placeholders: ["value"], values: { value: { value: 0 } } },
  ])("fails closed for malformed ICU, missing values, or unsupported value shapes: $text / $values", fixture => {
    const source = registry("en-US", [approved("fixture.invalid", fixture.text, fixture.placeholders)]);
    const ref = { id: "fixture.invalid", values: fixture.values };
    expect(() => resolveCopyRef(source, ref)).not.toThrow();
    expectUnresolved(resolveCopyRef(source, ref));
    expect(createCopyResolver(source)(ref as unknown as CopyRef)).toBeUndefined();
  });

  it("fails closed for an invalid time zone without leaking unformatted ICU", () => {
    const source = registry("en-US", [approved("fixture.date", "{instant, date, long}", ["instant"])]);
    const ref = { id: "fixture.date", values: { instant: 0 } };
    expect(() => resolveCopyRef(source, ref, { timeZone: "Invalid/Zone" })).not.toThrow();
    const result = resolveCopyRef(source, ref, { timeZone: "Invalid/Zone" });
    expectUnresolved(result);
    expect(createCopyResolver(source, { timeZone: "Invalid/Zone" })(ref)).toBeUndefined();
  });

  it.each(["draft", "stale", "expired", "delegate"] as const)("does not conceal a native %s entry behind approved default copy", failure => {
    const source = registry("en", [approved("fixture.guarded", "Default fixture")]);
    const native = approved("fixture.guarded", "{count, plural, one {one} other {many}}", ["count"]);
    if (failure === "draft") {
      native.status = "draft";
      delete native.approval;
    } else if (failure === "stale") {
      native.text = "{count, plural, one {edited one} other {edited many}}";
    } else if (failure === "expired" || failure === "delegate") {
      native.approval = {
        ...native.approval!,
        approvedBy: "delegate",
        delegate: { id: "fixture-delegate", scope: ["fixture"] },
        pendingOwnerReview: true,
        ...(failure === "expired" ? { expiresAt: "2026-09-01T00:00:00.000Z" } : {}),
      };
    }
    const french = registry("fr", [native]);
    const result = resolveCopyRef(source, { id: "fixture.guarded", locale: "fr", values: { count: 1 } }, {
      manifest: policy(["fr", "en"]), registries: [french], now,
    });
    expectUnresolved(result);
    const reason = { draft: "copy-not-approved", stale: "approval-stale", expired: "approval-expired", delegate: "delegate-approval-refused" }[failure];
    expect(result.issues[0]?.reason).toBe(reason);
  });
});
