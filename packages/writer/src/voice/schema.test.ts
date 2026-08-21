import { describe, expect, it } from "vitest";
import { parseVoiceRecord, validateVoiceRecordShape } from "./schema.js";
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

  it("never throws on null, a string, an array, or a number, and reports record-present", () => {
    for (const bad of [null, "not an object", [], 42, undefined]) {
      expect(() => validateVoiceRecordShape(bad)).not.toThrow();
      const findings = validateVoiceRecordShape(bad);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.every((f) => f.severity === "error")).toBe(true);
      expect(findings.some((f) => f.rule === "record-present" && f.path === "$")).toBe(true);
    }
  });

  it("flags a missing required field with an id-shape finding at path 'id'", () => {
    const missingId = { ...validRecord, id: undefined };
    const findings = validateVoiceRecordShape(missingId);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.rule === "id-shape" && f.path === "id")).toBe(true);
  });

  it("flags a wrong-type field (glossary.status not one of the enum values)", () => {
    const badStatus = {
      ...validRecord,
      glossary: [{ term: "revolutionary", status: "banned", reason: "x" }],
    };
    const findings = validateVoiceRecordShape(badStatus);
    expect(findings.some((f) => f.rule === "glossary-status-shape" && f.path === "glossary.0.status")).toBe(true);
  });

  it("flags an empty-string field as invalid", () => {
    const emptyReason = {
      ...validRecord,
      glossary: [{ term: "revolutionary", status: "forbidden", reason: "" }],
    };
    const findings = validateVoiceRecordShape(emptyReason);
    expect(findings.some((f) => f.rule === "glossary-reason-shape" && f.path === "glossary.0.reason")).toBe(true);
  });

  it("flags every element of a malformed array, not just the first", () => {
    const twoBad = {
      ...validRecord,
      glossary: [
        { term: "a", status: "forbidden", reason: "x" },
        { term: "", status: "forbidden", reason: "y" },
      ],
    };
    const findings = validateVoiceRecordShape(twoBad);
    expect(findings.some((f) => f.path === "glossary.1.term")).toBe(true);
  });

  it("rejects a non-object glossary entry with glossary-entry-shape rather than throwing", () => {
    const findings = validateVoiceRecordShape({ ...validRecord, glossary: ["not an object", null, 5] });
    expect(findings.filter((f) => f.rule === "glossary-entry-shape")).toHaveLength(3);
  });

  it("rejects a non-array glossary/claims with glossary-shape/claims-shape", () => {
    const findings = validateVoiceRecordShape({ ...validRecord, glossary: "nope", claims: 5 });
    expect(findings.some((f) => f.rule === "glossary-shape" && f.path === "glossary")).toBe(true);
    expect(findings.some((f) => f.rule === "claims-shape" && f.path === "claims")).toBe(true);
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
    const parsed = parseVoiceRecord(minimal);
    expect(parsed.glossary).toEqual([]);
    expect(parsed.claims).toEqual([]);
    expect(parsed.rules.tone).toEqual([]);
    expect(parsed.rules.person.forbiddenPronouns).toEqual([]);
    expect(parsed.rules.tense.forbiddenMarkers).toEqual([]);
  });

  it("does not treat a present-but-wrong-shaped optional array as absent", () => {
    const findings = validateVoiceRecordShape({
      ...validRecord,
      rules: { ...validRecord.rules, tone: [1, 2, 3] },
    });
    expect(findings.some((f) => f.rule === "tone-shape")).toBe(true);
  });
});

describe("parseVoiceRecord", () => {
  it("returns a parsed VoiceRecord (with defaults applied) for valid input", () => {
    const parsed = parseVoiceRecord(validRecord);
    expect(parsed.id).toBe("acme-app");
    expect(parsed.glossary).toHaveLength(1);
  });

  it("does not mutate the input arrays it copies from (defensive copies, not references)", () => {
    const pronouns = ["I"];
    const record: VoiceRecord = {
      ...validRecord,
      rules: { ...validRecord.rules, person: { description: "x", forbiddenPronouns: pronouns } },
    };
    const parsed = parseVoiceRecord(record);
    parsed.rules.person.forbiddenPronouns.push("we");
    expect(pronouns).toEqual(["I"]); // the original array is untouched
  });

  it("throws a plain Error, listing every issue, for invalid input", () => {
    expect(() => parseVoiceRecord({ id: "" })).toThrowError(/parseVoiceRecord: value is not a valid VoiceRecord/);
    try {
      parseVoiceRecord(null);
      expect.unreachable("parseVoiceRecord should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toMatch(/must be an object/);
    }
  });

  it("BACKWARD COMPATIBILITY: an existing VoiceRecord that never declares patterns keeps patterns undefined after parsing, never defaulted to []", () => {
    // Pinned explicitly, per this feature's scope discipline: patterns is
    // the one field that must NOT behave like glossary/claims (which DO
    // default to [] when absent) — see types.ts's VoiceRecord doc comment.
    const parsed = parseVoiceRecord(validRecord);
    expect(parsed.patterns).toBeUndefined();
    expect("patterns" in parsed).toBe(false);
  });

  it("a record that DOES declare patterns: [] keeps that array present after parsing", () => {
    const parsed = parseVoiceRecord({ ...validRecord, patterns: [] });
    expect(parsed.patterns).toEqual([]);
  });
});

describe("validateVoiceRecordShape — pattern rules", () => {
  const validPatternRule = {
    id: "no-em-dash",
    description: "hard ban on the em dash",
    pattern: { source: "\\u2014" },
    severity: "error",
    reason: "house style bans the em dash",
  };

  it("accepts a well-formed pattern rule", () => {
    const findings = validateVoiceRecordShape({ ...validRecord, patterns: [validPatternRule] });
    expect(findings).toEqual([]);
  });

  it("accepts every VoiceSeverity value", () => {
    for (const severity of ["error", "warning", "advisory"]) {
      const findings = validateVoiceRecordShape({
        ...validRecord,
        patterns: [{ ...validPatternRule, severity }],
      });
      expect(findings).toEqual([]);
    }
  });

  it("rejects an unknown severity", () => {
    const findings = validateVoiceRecordShape({
      ...validRecord,
      patterns: [{ ...validPatternRule, severity: "block" }],
    });
    expect(findings.some((f) => f.rule === "pattern-severity-shape" && f.path === "patterns.0.severity")).toBe(true);
  });

  it("rejects a missing id/description/reason", () => {
    const { id, ...withoutId } = validPatternRule;
    void id;
    const findings = validateVoiceRecordShape({ ...validRecord, patterns: [withoutId] });
    expect(findings.some((f) => f.rule === "pattern-id-shape")).toBe(true);
  });

  it("rejects a pattern that fails the regex-safety gate — a real, unmissable finding, not a silent skip", () => {
    const findings = validateVoiceRecordShape({
      ...validRecord,
      patterns: [{ ...validPatternRule, pattern: { source: "(a+)+" } }],
    });
    const finding = findings.find((f) => f.rule.startsWith("pattern-shape:"));
    expect(finding).toBeDefined();
    expect(finding?.rule).toBe("pattern-shape:pattern-nested-quantifier");
    expect(finding?.severity).toBe("error");
  });

  it("rejects a pattern that is not an object", () => {
    const findings = validateVoiceRecordShape({ ...validRecord, patterns: [{ ...validPatternRule, pattern: "not an object" }] });
    expect(findings.some((f) => f.rule === "pattern-shape")).toBe(true);
  });

  it("validates channel shape (non-empty string when present)", () => {
    const good = validateVoiceRecordShape({ ...validRecord, patterns: [{ ...validPatternRule, channel: "linkedin" }] });
    expect(good).toEqual([]);
    const bad = validateVoiceRecordShape({ ...validRecord, patterns: [{ ...validPatternRule, channel: "  " }] });
    expect(bad.some((f) => f.rule === "pattern-channel-shape")).toBe(true);
  });

  it("flags every malformed pattern rule in the array, not just the first", () => {
    const findings = validateVoiceRecordShape({
      ...validRecord,
      patterns: [{ ...validPatternRule, severity: "bogus" }, { ...validPatternRule, reason: "" }],
    });
    expect(findings.some((f) => f.path === "patterns.0.severity")).toBe(true);
    expect(findings.some((f) => f.path === "patterns.1.reason")).toBe(true);
  });

  it("rejects a non-array patterns with patterns-shape", () => {
    const findings = validateVoiceRecordShape({ ...validRecord, patterns: "nope" });
    expect(findings.some((f) => f.rule === "patterns-shape" && f.path === "patterns")).toBe(true);
  });
});

describe("validateVoiceRecordShape — glossary channel scoping", () => {
  it("accepts a glossary entry with a channel", () => {
    const findings = validateVoiceRecordShape({
      ...validRecord,
      glossary: [{ term: "x", status: "forbidden", reason: "y", caseSensitive: false, channel: "linkedin" }],
    });
    expect(findings).toEqual([]);
  });

  it("rejects a whitespace-only channel", () => {
    const findings = validateVoiceRecordShape({
      ...validRecord,
      glossary: [{ term: "x", status: "forbidden", reason: "y", caseSensitive: false, channel: "   " }],
    });
    expect(findings.some((f) => f.rule === "glossary-channel-shape" && f.path === "glossary.0.channel")).toBe(true);
  });
});
