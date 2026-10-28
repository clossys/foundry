import { describe, expect, it } from "vitest";
import type { CopyResolver } from "@clossys/writer";
import { checkPageMetadata } from "../metadata.js";
import { reviewCandidate } from "./index.js";
import { resnapshot, reviewInput } from "./__fixtures__/review.js";

function referencedInput() {
  const input = reviewInput();
  const texts = new Map<string, string>();
  const candidate = input.registry.candidates[0]!;
  for (const section of candidate.composition!.sections) {
    Object.assign(section, { fields: section.fields.map(field => {
      const id = `${section.key}.${field.key}.${field.locale}`;
      texts.set(id, field.value ?? "");
      return { key: field.key, locale: field.locale, source: "writer", ref: { id, values: { count: 1 } } };
    }) });
  }
  const resolver: CopyResolver = ref => {
    const text = texts.get(ref.id);
    return text === undefined ? undefined : {
      ref, text, locale: ref.locale!, servedLocale: ref.locale!, chain: [ref.locale!],
      recordId: ref.id, entryId: ref.id, revision: "1", source: { kind: "consumer", reference: "copy-fixture" },
    };
  };
  return { input: resnapshot(input), resolver, texts };
}

describe("Review Writer references", () => {
  it("reviews resolved text without placing Writer prose in authored fields", () => {
    const { input, resolver } = referencedInput();
    const before = structuredClone(input.registry);
    const report = reviewCandidate({ ...input, copyResolver: resolver });
    expect(report.findings).toEqual([]);
    expect(report.needs).toEqual([]);
    expect(input.registry).toEqual(before);
  });

  it("blocks references without a resolver and raises Writer Needs", () => {
    const { input } = referencedInput();
    const report = reviewCandidate(input);
    expect(report.copyFindings).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "error" })]));
    expect(report.findings.some(finding => finding.check === "copy-schema")).toBe(true);
    expect(report.needs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "copy", target: "writer" })]));
  });

  it("checks schema length and required copy against the resolved values", () => {
    const { input, resolver, texts } = referencedInput();
    for (const id of texts.keys()) texts.set(id, "x".repeat(1000));
    expect(reviewCandidate({ ...input, copyResolver: resolver }).findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "max-length" })]));
    for (const id of texts.keys()) texts.set(id, " ");
    expect(reviewCandidate({ ...input, copyResolver: resolver }).findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "required-copy" })]));
  });

  it("keeps legacy provenance warnings separate from blocking findings", () => {
    const report = reviewCandidate(reviewInput());
    expect(report.findings).toEqual([]);
    expect(report.needs).toEqual([]);
    expect(report.copyFindings).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "warning" })]));
  });

  it("requires page titles for pages while allowing redirects without metadata", () => {
    const input = reviewInput();
    delete input.registry.candidates[0]!.pageMeta;
    const page = reviewCandidate(resnapshot(input));
    expect(page.copyFindings).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "error", rule: "required-page-metadata" })]));
    input.registry.slots[0]!.kind = "redirect";
    const redirect = reviewCandidate(resnapshot(input));
    expect(redirect.copyFindings?.some(finding => finding.severity === "error")).toBe(false);
  });

  it("permits a body fallback while requiring native metadata copy", () => {
    const { input, resolver } = referencedInput();
    const fallback: CopyResolver = ref => {
      const resolved = resolver(ref);
      return resolved && { ...resolved, servedLocale: "de", chain: [ref.locale!, "de"] };
    };
    const report = reviewCandidate({ ...input, copyResolver: fallback });
    expect(report.findings).toEqual([]);
    expect(report.copyFindings).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "warning", servedLocale: "de" })]));
    const candidate = { ...input.registry.candidates[0]!, pageMeta: [
      { key: "title", locale: "en", source: "writer" as const, ref: { id: "meta.title" } },
      { key: "description", locale: "en", source: "writer" as const, ref: { id: "meta.description" } },
    ] };
    const metaResolver: CopyResolver = ref => ({ ref, text: "Metadata", recordId: ref.id, entryId: ref.id, revision: "1", locale: ref.locale!, servedLocale: "de", chain: [ref.locale!, "de"], source: { kind: "consumer", reference: "copy-fixture" } });
    expect(checkPageMetadata({ ...input.registry.slots[0]!, locales: ["en"] }, candidate, undefined, { resolver: metaResolver }).length).toBeGreaterThan(0);
  });

  it("compares the full pinned CopyRef identity including argument values", () => {
    const { input, resolver } = referencedInput();
    const candidate = input.registry.candidates[0]!;
    const source = { ...structuredClone(candidate), id: "copy-source", state: "draft" as const };
    input.registry.candidates.push(source);
    const section = candidate.composition!.sections[0]!;
    Object.assign(section, {
      ref: { candidateId: source.id, revision: source.revision, sectionKey: section.key },
      fields: section.fields.map(field => ({ key: field.key, locale: field.locale, source: "writer", ref: { id: `${section.key}.${field.key}.${field.locale}`, values: { count: 2 } } })),
    });
    const report = reviewCandidate({ ...resnapshot(input), copyResolver: resolver });
    expect(report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "pinned-copy-override" })]));
  });
});
