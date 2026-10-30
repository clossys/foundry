import { describe, expect, it } from "vitest";
import { reviewCandidate } from "./index.js";
import { field, resnapshot, reviewInput } from "./__fixtures__/review.js";
import type { Fixture } from "./__fixtures__/review.js";

const copyFindings = (input: Fixture) => reviewCandidate(resnapshot(input)).findings.filter(f => f.check === "copy-schema");
const coverage = (input: Fixture) => reviewCandidate(resnapshot(input)).findings.filter(f => f.check === "locale-coverage");
const section = (input: Fixture) => input.registry.candidates[0]!.composition!.sections[0]!;
const registration = (input: Fixture) => input.libraries[0]!.sections[0]!;
const schemaField = (key: string, required = true) => ({ key, kind: "plain" as const, required, maxLength: { en: 20, fr: 20 }, dir: "auto" as const });

describe("DG-1 copy and locale Review", () => {
  it.each(["", "   "])("requires nonblank Writer copy %j and directs the Need to Writer", value => {
    const input = reviewInput(); section(input).fields[0]!.value = value;
    const report = reviewCandidate(resnapshot(input));
    expect(report.findings.some(f => f.check === "copy-schema")).toBe(true);
    expect(report.needs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "copy", target: "writer" })]));
  });
  it("rejects unknown keys while allowing identical text on different fields", () => {
    const input = reviewInput(); section(input).fields.push(field("surprise"));
    expect(copyFindings(input)).not.toEqual([]);
    section(input).fields.pop(); registration(input).copy!.fields.push(schemaField("subtitle", false));
    section(input).fields.push(field("subtitle", "en", "Sample"), field("subtitle", "fr", "Exemple"));
    expect(copyFindings(input)).toEqual([]);
  });
  it("counts maxLength in Unicode code points at the exact boundary", () => {
    const input = reviewInput(); section(input).fields[0]!.value = "😀".repeat(12);
    expect(copyFindings(input)).toEqual([]);
    section(input).fields[0]!.value += "😀";
    expect(copyFindings(input)).not.toEqual([]);
  });
  it("uses the locale's own maximum", () => {
    const input = reviewInput(); registration(input).copy!.fields[0]!.maxLength.fr = 3;
    expect(copyFindings(input)).not.toEqual([]);
  });
  it("raises a Designer Need for an absent exact per-locale limit", () => {
    const input = reviewInput(); delete (registration(input).copy!.fields[0]!.maxLength as Record<string, number>).fr;
    const report = reviewCandidate(resnapshot(input));
    expect(report.findings.some(f => f.check === "copy-schema")).toBe(true);
    expect(report.needs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "copy-schema", target: "designer" })]));
  });
  it("raises a Designer schema Need when a registered section lacks DG-1", () => {
    const input = reviewInput(); delete registration(input).copy;
    const report = reviewCandidate(resnapshot(input));
    expect(report.findings.some(f => f.check === "copy-schema")).toBe(true);
    expect(report.needs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "copy-schema", target: "designer" })]));
  });
  it.each(["passage", "kind", "dir", "limit", "locale"])("fails closed for invalid DG-1 %s metadata", invalid => {
    const input = reviewInput(); const entry = registration(input);
    const metadata = entry.copy!.fields[0]! as unknown as Record<string, unknown>;
    if (invalid === "passage") entry.passageSchema = "passages.other";
    if (invalid === "kind") metadata.kind = "unregistered";
    if (invalid === "dir") metadata.dir = "sideways";
    if (invalid === "limit") metadata.maxLength = { en: 0, fr: 12 };
    if (invalid === "locale") entry.copy!.sourceLocale = "invalid_locale";
    expect(copyFindings(input)).not.toEqual([]);
  });
  it("requires every source key in each selected locale without language fallback", () => {
    const input = reviewInput(); section(input).fields = section(input).fields.filter(f => f.locale !== "fr");
    expect(coverage(input)).not.toEqual([]);
    section(input).fields.push(field("title", "fr-CA", "Exemple"));
    expect(coverage(input)).not.toEqual([]);
  });
  it("checks locale coverage for optional source keys too", () => {
    const input = reviewInput(); registration(input).copy!.fields.push(schemaField("subtitle", false));
    section(input).fields.push(field("subtitle"));
    expect(coverage(input)).not.toEqual([]);
    section(input).fields.push(field("subtitle", "fr")); expect(coverage(input)).toEqual([]);
  });
  it("does not infer a copy-free logo config from its name", () => {
    const input = reviewInput(); section(input).configId = "logo-only"; section(input).fields = [];
    expect(copyFindings(input)).not.toEqual([]);
  });
  it("honors an explicit zero-field config schema", () => {
    const input = reviewInput(); section(input).configId = "logo-only"; section(input).fields = [];
    registration(input).configSchemas = [{ configId: "logo-only", passageSchema: "passages.sample", copy: { sourceLocale: "en", fields: [] } }];
    expect(reviewCandidate(resnapshot(input)).findings).toEqual([]);
  });
  it("does not require absent optional region and state copy", () => {
    const input = reviewInput();
    registration(input).slots = [{ name: "header", required: false, type: "record" }];
    registration(input).copy!.fields.push(schemaField("header.heading"), schemaField("states.error.message"));
    expect(copyFindings(input)).toEqual([]);
  });
  it("requires required siblings when an optional region is present", () => {
    const input = reviewInput(); registration(input).slots = [{ name: "header", required: false, type: "record" }];
    registration(input).copy!.fields.push(schemaField("header.heading"), schemaField("header.description", false));
    section(input).fields.push(field("header.description"), field("header.description", "fr"));
    expect(copyFindings(input)).not.toEqual([]);
  });
  it("requires required messages only for a present state", () => {
    const input = reviewInput(); registration(input).copy!.fields.push(schemaField("states.error.heading"), schemaField("states.error.detail", false));
    section(input).fields.push(field("states.error.detail"), field("states.error.detail", "fr"));
    expect(copyFindings(input)).not.toEqual([]);
  });
  it.each(["items[0].label", "items.0.label", "items.primary.label"])("matches collection path %s and requires each present item's siblings", key => {
    const input = reviewInput(); registration(input).copy!.fields.push(schemaField("items[].label"), schemaField("items[].description"));
    section(input).fields.push(field(key), field(key, "fr"));
    expect(copyFindings(input)).not.toEqual([]);
    const detail = key.replace(/label$/, "description");
    section(input).fields.push(field(detail), field(detail, "fr"));
    expect(copyFindings(input)).toEqual([]); expect(coverage(input)).toEqual([]);
  });
  it("does not fabricate a minimum item count from required collection fields", () => {
    const input = reviewInput(); registration(input).slots = [{ name: "items", required: true, type: "records" }];
    registration(input).copy!.fields.push(schemaField("items[].label"));
    expect(copyFindings(input)).toEqual([]);
  });
  it("requires translations for every concrete source collection key", () => {
    const input = reviewInput(); registration(input).copy!.fields.push(schemaField("items[].label"));
    section(input).fields.push(field("items[0].label"), field("items[1].label"), field("items[0].label", "fr"));
    expect(coverage(input)).not.toEqual([]);
  });
  it("raises a Writer Need for an optional translation lacking its source key", () => {
    const input = reviewInput(); registration(input).copy!.fields[0]!.required = false;
    section(input).fields = [field("title", "fr", "Exemple")];
    const report = reviewCandidate(resnapshot(input));
    expect(report.findings.some(f => f.check === "locale-coverage")).toBe(true);
    expect(report.needs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "copy", target: "writer" })]));
  });
  it("rejects two aliases of the same field address without rejecting shared text", () => {
    const input = reviewInput(); registration(input).copy!.fields.push(schemaField("items[].label"));
    section(input).fields.push(field("items[0].label"), field("items.0.label"), field("items[0].label", "fr"));
    expect(copyFindings(input).some(f => f.rule === "duplicate-copy-address")).toBe(true);
  });
});
