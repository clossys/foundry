import { describe, expect, it } from "vitest";
import { parseVoiceRecord, validateVoiceRecordShape } from "./schema.js";
import { VoiceRecordSchema } from "./types.js";
import type { VoiceRecord } from "./types.js";

// A minimal but complete, obviously-fictional VoiceRecord used across this
// file's tests. "Acme" is a placeholder already used elsewhere in this
// repository's own README examples — never a real company.
const validRecord: VoiceRecord = {
  id: "acme-app",
  rules: {
    person: { description: "second-person, you-voice", forbiddenPronouns: ["I", "me", "my"] },
    tense: { description: "present tense, no future promises", forbiddenMarkers: ["will", "shall"] },
    formality: "neutral",
    tone: ["direct", "no jargon"],
  },
  glossary: [{ term: "revolutionary", status: "forbidden", reason: "overused buzzword", caseSensitive: false }],
  claims: [{ id: "fast-sync", text: "fastest sync in its class", matchPhrases: [], requiresSupport: true }],
};

describe("validateVoiceRecordShape", () => {
  it("returns no findings for a well-formed VoiceRecord", () => {
    expect(validateVoiceRecordShape(validRecord)).toEqual([]);
  });

  it("never throws on null, a string, an array, or a number", () => {
    for (const bad of [null, "not an object", [], 42, undefined]) {
      expect(() => validateVoiceRecordShape(bad)).not.toThrow();
      const findings = validateVoiceRecordShape(bad);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.every((f) => f.severity === "error")).toBe(true);
    }
  });

  it("flags a missing required field with a schema:<path> rule and the field path", () => {
    const missingId = { ...validRecord, id: undefined };
    const findings = validateVoiceRecordShape(missingId);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.rule === "schema:id" && f.path === "id")).toBe(true);
  });

  it("flags a wrong-type field (glossary.status not one of the enum values)", () => {
    const badStatus = {
      ...validRecord,
      glossary: [{ term: "revolutionary", status: "banned", reason: "x" }],
    };
    const findings = validateVoiceRecordShape(badStatus);
    expect(findings.some((f) => f.rule.startsWith("schema:glossary.0.status"))).toBe(true);
  });

  it("flags an empty-string field as invalid (min(1) enforced)", () => {
    const emptyReason = {
      ...validRecord,
      glossary: [{ term: "revolutionary", status: "forbidden", reason: "" }],
    };
    const findings = validateVoiceRecordShape(emptyReason);
    expect(findings.some((f) => f.path === "glossary.0.reason")).toBe(true);
  });

  it("applies documented defaults for optional arrays (glossary, claims, tone, forbiddenPronouns/Markers)", () => {
    const minimal = {
      id: "acme-app",
      rules: {
        person: { description: "second-person" },
        tense: { description: "present tense" },
        formality: "neutral",
      },
    };
    const findings = validateVoiceRecordShape(minimal);
    expect(findings).toEqual([]);
    const parsed = VoiceRecordSchema.parse(minimal);
    expect(parsed.glossary).toEqual([]);
    expect(parsed.claims).toEqual([]);
    expect(parsed.rules.tone).toEqual([]);
    expect(parsed.rules.person.forbiddenPronouns).toEqual([]);
    expect(parsed.rules.tense.forbiddenMarkers).toEqual([]);
  });
});

describe("parseVoiceRecord", () => {
  it("returns a parsed VoiceRecord (with defaults applied) for valid input", () => {
    const parsed = parseVoiceRecord(validRecord);
    expect(parsed.id).toBe("acme-app");
    expect(parsed.glossary).toHaveLength(1);
  });

  it("throws a plain Error, listing every issue, for invalid input", () => {
    expect(() => parseVoiceRecord({ id: "" })).toThrowError(/parseVoiceRecord: value is not a valid VoiceRecord/);
    try {
      parseVoiceRecord(null);
      expect.unreachable("parseVoiceRecord should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toMatch(/root/);
    }
  });
});
