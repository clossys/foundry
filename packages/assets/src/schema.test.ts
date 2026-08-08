import { describe, expect, it } from "vitest";
import { parseAssetRecord, validateAssetRecordShape } from "./schema.js";

const validEntry = {
  id: "marketing.hero-banner",
  src: "/images/hero-banner.png",
  width: 1600,
  height: 900,
  alt: "Illustration of a laptop showing a dashboard",
};

const validRecord = { id: "acme-app", entries: [validEntry] };

describe("validateAssetRecordShape — clean input", () => {
  it("reports zero findings for a well-formed record", () => {
    expect(validateAssetRecordShape(validRecord)).toEqual([]);
  });

  it("accepts optional mimeType/licence/credit when present and well-formed", () => {
    const findings = validateAssetRecordShape({
      id: "acme-app",
      entries: [{ ...validEntry, mimeType: "image/png", licence: "CC-BY-4.0", credit: "Photo by Jane Doe" }],
    });
    expect(findings).toEqual([]);
  });

  it("a zero-entry record is well-formed as far as this function is concerned", () => {
    expect(validateAssetRecordShape({ id: "acme-app", entries: [] })).toEqual([]);
  });
});

describe("validateAssetRecordShape — record-level shape", () => {
  it("rejects a non-object value", () => {
    const findings = validateAssetRecordShape("not an object");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("record-present");
  });

  it("rejects null", () => {
    expect(validateAssetRecordShape(null)[0]?.rule).toBe("record-present");
  });

  it("flags a missing/empty id", () => {
    const findings = validateAssetRecordShape({ id: "", entries: [] });
    expect(findings.some((f) => f.rule === "id-shape")).toBe(true);
  });

  it("flags entries not being an array", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: "nope" });
    expect(findings.some((f) => f.rule === "entries-shape")).toBe(true);
  });
});

describe("validateAssetRecordShape — id uniqueness (FIXTURE: duplicate id)", () => {
  it("flags a duplicate entry id", () => {
    const findings = validateAssetRecordShape({
      id: "acme-app",
      entries: [validEntry, { ...validEntry }],
    });
    const dup = findings.find((f) => f.rule === "id-unique");
    expect(dup).toBeDefined();
    expect(dup?.message).toMatch(/duplicates/);
  });

  it("does not flag two entries whose ids merely fail id-shape separately (no double-reporting of the same root cause)", () => {
    const findings = validateAssetRecordShape({
      id: "acme-app",
      entries: [
        { ...validEntry, id: "" },
        { ...validEntry, id: "" },
      ],
    });
    expect(findings.some((f) => f.rule === "id-unique")).toBe(false);
  });
});

describe("validateAssetRecordShape — entry id well-formedness", () => {
  it("rejects an empty id", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validEntry, id: "" }] });
    expect(findings.some((f) => f.rule === "id-shape")).toBe(true);
  });

  it("rejects a bare, unnamespaced id (no dot)", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validEntry, id: "hero" }] });
    expect(findings.some((f) => f.rule === "id-well-formed")).toBe(true);
  });

  it("rejects an uppercase id", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validEntry, id: "Marketing.Hero" }] });
    expect(findings.some((f) => f.rule === "id-well-formed")).toBe(true);
  });

  it("accepts a well-formed multi-segment id", () => {
    const findings = validateAssetRecordShape({
      id: "acme",
      entries: [{ ...validEntry, id: "onboarding.step-2.illustration" }],
    });
    expect(findings).toEqual([]);
  });
});

describe("validateAssetRecordShape — src", () => {
  it("rejects a missing src", () => {
    const { src: _drop, ...rest } = validEntry;
    const findings = validateAssetRecordShape({ id: "acme", entries: [rest] });
    expect(findings.some((f) => f.rule === "src-shape")).toBe(true);
  });

  it("rejects a whitespace-only src", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validEntry, src: "   " }] });
    expect(findings.some((f) => f.rule === "src-shape")).toBe(true);
  });
});

describe("validateAssetRecordShape — dimensions (FIXTURE: non-positive dimension)", () => {
  it("rejects a zero width", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validEntry, width: 0 }] });
    const f = findings.find((x) => x.rule === "width-positive");
    expect(f).toBeDefined();
  });

  it("rejects a negative height", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validEntry, height: -10 }] });
    const f = findings.find((x) => x.rule === "height-positive");
    expect(f).toBeDefined();
  });

  it("rejects a non-finite width (NaN)", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validEntry, width: NaN }] });
    expect(findings.some((f) => f.rule === "width-positive")).toBe(true);
  });

  it("rejects a non-numeric height", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validEntry, height: "900" }] });
    expect(findings.some((f) => f.rule === "height-positive")).toBe(true);
  });
});

describe("validateAssetRecordShape — alt (FIXTURE: whitespace-only alt)", () => {
  it("rejects a missing alt", () => {
    const { alt: _drop, ...rest } = validEntry;
    const findings = validateAssetRecordShape({ id: "acme", entries: [rest] });
    expect(findings.some((f) => f.rule === "alt-shape")).toBe(true);
  });

  it("rejects an empty-string alt", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validEntry, alt: "" }] });
    expect(findings.some((f) => f.rule === "alt-shape")).toBe(true);
  });

  it("rejects a whitespace-only alt distinctly from empty-string (alt-not-whitespace-only)", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validEntry, alt: "   " }] });
    const f = findings.find((x) => x.rule === "alt-not-whitespace-only");
    expect(f).toBeDefined();
    expect(f?.message).toMatch(/whitespace-only/);
    // and NOT double-reported as alt-shape too
    expect(findings.some((x) => x.rule === "alt-shape")).toBe(false);
  });

  it("rejects a tab/newline-only alt", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validEntry, alt: "\n\t " }] });
    expect(findings.some((f) => f.rule === "alt-not-whitespace-only")).toBe(true);
  });
});

describe("validateAssetRecordShape — optional fields", () => {
  it("rejects an empty mimeType when present", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validEntry, mimeType: "" }] });
    expect(findings.some((f) => f.rule === "mime-type-shape")).toBe(true);
  });

  it("rejects an empty licence when present", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validEntry, licence: "" }] });
    expect(findings.some((f) => f.rule === "licence-shape")).toBe(true);
  });

  it("rejects an empty credit when present", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validEntry, credit: "" }] });
    expect(findings.some((f) => f.rule === "credit-shape")).toBe(true);
  });
});

describe("parseAssetRecord", () => {
  it("returns a fully-typed AssetRecord for valid input", () => {
    const record = parseAssetRecord(validRecord);
    expect(record.id).toBe("acme-app");
    expect(record.entries).toHaveLength(1);
    expect(record.entries[0]?.alt).toBe(validEntry.alt);
  });

  it("throws a plain Error listing every issue for invalid input", () => {
    expect(() => parseAssetRecord({ id: "acme", entries: [{ ...validEntry, alt: "   " }] })).toThrow(
      /alt-not-whitespace-only|whitespace-only/,
    );
  });

  it("never throws for a merely-malformed top-level value — it throws a descriptive Error, not an unrelated exception", () => {
    expect(() => parseAssetRecord(null)).toThrow(/AssetRecord/);
  });
});
