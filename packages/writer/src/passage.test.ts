import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mainPassagesCheck } from "./cli.js";
import {
  checkPassageComposition,
  classifyPassageField,
  parsePassageRecord,
  readPassageRecord,
  validatePassageRecordShape,
  type Passage,
  type PassageRecord,
} from "./passage.js";

// A minimal, obviously-fictional PassageRecord — structural placeholder
// text only, never anything a real product would show a user. Mirrors
// schema.test.ts's own "Acme" convention.
const cleanPassage: Passage = {
  id: "onboarding.empty-state",
  context: "onboarding empty-state card",
  fields: {
    title: { ref: "entry", id: "onboarding.empty-state.title" },
    body: { ref: "entry", id: "onboarding.empty-state.body" },
    action: { ref: "term", term: "get-started" },
  },
};

const validRecord: PassageRecord = {
  id: "acme-app",
  passages: [cleanPassage],
};

// ---------------------------------------------------------------------------
// validatePassageRecordShape / parsePassageRecord
// ---------------------------------------------------------------------------

describe("validatePassageRecordShape", () => {
  it("returns no findings for a well-formed PassageRecord", () => {
    expect(validatePassageRecordShape(validRecord)).toEqual([]);
  });

  it("never throws on null, a string, an array, a number, or undefined, and reports record-present", () => {
    for (const bad of [null, "not an object", [], 42, undefined]) {
      expect(() => validatePassageRecordShape(bad)).not.toThrow();
      const findings = validatePassageRecordShape(bad);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.every((f) => f.severity === "error")).toBe(true);
      expect(findings.some((f) => f.rule === "record-present" && f.path === "$")).toBe(true);
    }
  });

  it("flags a missing record id with id-shape", () => {
    const findings = validatePassageRecordShape({ ...validRecord, id: undefined });
    expect(findings.some((f) => f.rule === "id-shape" && f.path === "id")).toBe(true);
  });

  it("flags a non-array passages with passages-shape", () => {
    const findings = validatePassageRecordShape({ ...validRecord, passages: "nope" });
    expect(findings.some((f) => f.rule === "passages-shape" && f.path === "passages")).toBe(true);
  });

  it("flags a missing/malformed passage id", () => {
    const findings = validatePassageRecordShape({
      id: "acme-app",
      passages: [{ ...cleanPassage, id: undefined }],
    });
    expect(findings.some((f) => f.rule === "id-shape" && f.path === "passages.0.id")).toBe(true);
  });

  it("flags a bare, unnamespaced passage id (no dot) as not well-formed", () => {
    const findings = validatePassageRecordShape({
      id: "acme-app",
      passages: [{ ...cleanPassage, id: "title" }],
    });
    expect(findings.some((f) => f.rule === "id-well-formed" && f.path === "passages.0.id")).toBe(true);
  });

  it("flags a missing passage context", () => {
    const findings = validatePassageRecordShape({
      id: "acme-app",
      passages: [{ ...cleanPassage, context: undefined }],
    });
    expect(findings.some((f) => f.rule === "context-shape" && f.path === "passages.0.context")).toBe(true);
  });

  it("flags a non-object fields as fields-shape", () => {
    const findings = validatePassageRecordShape({
      id: "acme-app",
      passages: [{ ...cleanPassage, fields: "nope" }],
    });
    expect(findings.some((f) => f.rule === "fields-shape" && f.path === "passages.0.fields")).toBe(true);
  });

  it("flags an empty fields object as fields-non-empty", () => {
    const findings = validatePassageRecordShape({
      id: "acme-app",
      passages: [{ ...cleanPassage, fields: {} }],
    });
    expect(findings.some((f) => f.rule === "fields-non-empty" && f.path === "passages.0.fields")).toBe(true);
  });

  it("does NOT flag a field holding a raw literal string as a shape error — that is the gate's job, not the schema's", () => {
    const findings = validatePassageRecordShape({
      id: "acme-app",
      passages: [{ id: "onboarding.empty-state", context: "onboarding card", fields: { title: "Nothing here yet." } }],
    });
    expect(findings).toEqual([]);
  });

  it("flags a duplicate passage id with id-unique", () => {
    const findings = validatePassageRecordShape({
      id: "acme-app",
      passages: [cleanPassage, cleanPassage],
    });
    expect(findings.some((f) => f.rule === "id-unique" && f.path === "passages.1.id")).toBe(true);
  });

  it("accepts multiple field shapes as valid at the SCHEMA level — including a bare number, since classification is the gate's job", () => {
    const findings = validatePassageRecordShape({
      id: "acme-app",
      passages: [{ id: "onboarding.empty-state", context: "onboarding card", fields: { weird: 42 } }],
    });
    expect(findings).toEqual([]);
  });
});

describe("parsePassageRecord", () => {
  it("parses a well-formed record", () => {
    const record = parsePassageRecord(validRecord);
    expect(record.id).toBe("acme-app");
    expect(record.passages).toHaveLength(1);
    expect(record.passages[0]?.id).toBe("onboarding.empty-state");
  });

  it("throws a single Error whose message lists every finding, for malformed input", () => {
    expect(() => parsePassageRecord({ id: "", passages: "nope" })).toThrow(/not a valid PassageRecord/);
  });
});

// ---------------------------------------------------------------------------
// readPassageRecord — filesystem I/O
// ---------------------------------------------------------------------------

describe("readPassageRecord", () => {
  let dir: string;
  let registryPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "passage-registry-test-"));
    registryPath = join(dir, "passages.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a valid PassageRecord file and reports complete", () => {
    writeFileSync(registryPath, JSON.stringify(validRecord));
    const result = readPassageRecord(registryPath);
    expect(result.issues).toEqual([]);
    expect(result.complete).toBe(true);
    expect(result.record?.id).toBe("acme-app");
  });

  it("reports a missing file as unreadable, never throwing", () => {
    expect(() => readPassageRecord(registryPath)).not.toThrow();
    const result = readPassageRecord(registryPath);
    expect(result.complete).toBe(false);
    expect(result.issues[0]?.reason).toBe("unreadable");
  });

  it("reports unparseable JSON as unparseable", () => {
    writeFileSync(registryPath, "{ not valid json");
    const result = readPassageRecord(registryPath);
    expect(result.complete).toBe(false);
    expect(result.issues[0]?.reason).toBe("unparseable");
  });

  it("reports a schema violation as invalid-schema", () => {
    writeFileSync(registryPath, JSON.stringify({ id: "acme-app", passages: [{ ...cleanPassage, fields: {} }] }));
    const result = readPassageRecord(registryPath);
    expect(result.complete).toBe(false);
    expect(result.issues[0]?.reason).toBe("invalid-schema");
  });
});

// ---------------------------------------------------------------------------
// classifyPassageField
// ---------------------------------------------------------------------------

describe("classifyPassageField", () => {
  it("classifies a plain string as inline-literal", () => {
    expect(classifyPassageField("Nothing here yet.").classification).toBe("inline-literal");
  });

  it("classifies a well-formed entry reference as entry-reference", () => {
    expect(classifyPassageField({ ref: "entry", id: "onboarding.title" }).classification).toBe("entry-reference");
  });

  it("classifies a well-formed term reference as term-reference", () => {
    expect(classifyPassageField({ ref: "term", term: "get-started" }).classification).toBe("term-reference");
  });

  it("classifies an entry reference with a missing id as unclassifiable, not entry-reference", () => {
    expect(classifyPassageField({ ref: "entry" }).classification).toBe("unclassifiable");
  });

  it("classifies a term reference with a non-string term as unclassifiable", () => {
    expect(classifyPassageField({ ref: "term", term: 42 }).classification).toBe("unclassifiable");
  });

  it("classifies ANY { ref: \"passage\", ... } as passage-internals-reference, regardless of what else it carries", () => {
    expect(classifyPassageField({ ref: "passage", id: "other.passage", field: "title" }).classification).toBe(
      "passage-internals-reference",
    );
    expect(classifyPassageField({ ref: "passage" }).classification).toBe("passage-internals-reference");
  });

  it("classifies a number, boolean, null, array, and an unrecognized-ref object as unclassifiable", () => {
    for (const value of [42, true, null, [1, 2, 3], { ref: "mystery" }, {}]) {
      expect(classifyPassageField(value).classification).toBe("unclassifiable");
    }
  });

  it("never throws on any input", () => {
    for (const value of [undefined, Symbol("x"), () => {}, new Map(), { ref: { nested: true } }]) {
      expect(() => classifyPassageField(value)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// checkPassageComposition — the gate and its ternary
// ---------------------------------------------------------------------------

describe("checkPassageComposition", () => {
  it("is satisfied when every passage references only entries and terms, and at least one passage was evaluated", () => {
    const result = checkPassageComposition(validRecord);
    expect(result.verdict).toBe("satisfied");
    expect(result.violations).toEqual([]);
    expect(result.unclassified).toEqual([]);
    expect(result.passagesEvaluated).toBe(1);
    expect(result.reasons).toEqual([]);
  });

  it("is indeterminate — never satisfied — when zero passages are registered", () => {
    const result = checkPassageComposition({ id: "acme-app", passages: [] });
    expect(result.verdict).toBe("indeterminate");
    expect(result.passagesEvaluated).toBe(0);
    expect(result.reasons.some((r) => r.includes("no passages are registered"))).toBe(true);
  });

  it("is violated when a field inlines a literal string instead of referencing an entry", () => {
    const record: PassageRecord = {
      id: "acme-app",
      passages: [{ id: "onboarding.empty-state", context: "onboarding card", fields: { title: "Nothing here yet." } }],
    };
    const result = checkPassageComposition(record);
    expect(result.verdict).toBe("violated");
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.rule).toBe("field-inlines-literal");
    expect(result.violations[0]?.passageId).toBe("onboarding.empty-state");
    expect(result.violations[0]?.field).toBe("title");
  });

  it("is violated when a field references another passage's own internals", () => {
    const record: PassageRecord = {
      id: "acme-app",
      passages: [
        {
          id: "onboarding.empty-state",
          context: "onboarding card",
          fields: { title: { ref: "passage", id: "other.passage", field: "title" } },
        },
      ],
    };
    const result = checkPassageComposition(record);
    expect(result.verdict).toBe("violated");
    expect(result.violations[0]?.rule).toBe("field-references-passage-internals");
  });

  it("is indeterminate when a field cannot be confidently classified, with zero violations", () => {
    const record: PassageRecord = {
      id: "acme-app",
      passages: [{ id: "onboarding.empty-state", context: "onboarding card", fields: { weird: 42 } }],
    };
    const result = checkPassageComposition(record);
    expect(result.verdict).toBe("indeterminate");
    expect(result.unclassified).toHaveLength(1);
    expect(result.violations).toEqual([]);
  });

  it("a real violation wins over an unclassified field in the SAME run — verdict is violated, not indeterminate", () => {
    const record: PassageRecord = {
      id: "acme-app",
      passages: [
        {
          id: "onboarding.empty-state",
          context: "onboarding card",
          fields: {
            title: "Nothing here yet.", // violation
            weird: 42, // unclassifiable
          },
        },
      ],
    };
    const result = checkPassageComposition(record);
    expect(result.verdict).toBe("violated");
    expect(result.violations).toHaveLength(1);
    expect(result.unclassified).toHaveLength(1);
    // The coverage gap is not hidden even though "violated" won:
    expect(result.reasons.some((r) => r.includes("could not be confidently classified"))).toBe(true);
  });

  it("evaluates multiple passages independently and reports every violation found", () => {
    const record: PassageRecord = {
      id: "acme-app",
      passages: [
        cleanPassage,
        { id: "faq.pricing", context: "faq accordion", fields: { question: "How much does it cost?" } },
      ],
    };
    const result = checkPassageComposition(record);
    expect(result.verdict).toBe("violated");
    expect(result.passagesEvaluated).toBe(2);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.passageId).toBe("faq.pricing");
  });
});

// ---------------------------------------------------------------------------
// mainPassagesCheck — CLI wiring (calls the exported function directly,
// mirroring addressability.test.ts's own "mainAddressabilityCheck — CLI
// wiring" block; passage.adversarial.test.ts is what exercises the
// COMPILED cli.js by path, the way this repository actually invokes every
// gate.)
// ---------------------------------------------------------------------------

describe("mainPassagesCheck — CLI wiring", () => {
  let dir: string;
  let registryPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "passage-cli-"));
    registryPath = join(dir, "passages.json");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns 0 for a clean registry", () => {
    writeFileSync(registryPath, JSON.stringify(validRecord));
    expect(mainPassagesCheck([registryPath])).toBe(0);
  });

  it("returns 1 for an inlined literal", () => {
    writeFileSync(
      registryPath,
      JSON.stringify({
        id: "acme-app",
        passages: [{ id: "onboarding.empty-state", context: "onboarding card", fields: { title: "Nothing here yet." } }],
      }),
    );
    expect(mainPassagesCheck([registryPath])).toBe(1);
  });

  it("throws CliInputError (mapped to 2 by runPassagesCheck) for a missing registry file", () => {
    expect(() => mainPassagesCheck([registryPath])).toThrow(/does not exist/);
  });

  it("returns 2 for zero registered passages", () => {
    writeFileSync(registryPath, JSON.stringify({ id: "acme-app", passages: [] }));
    expect(mainPassagesCheck([registryPath])).toBe(2);
  });

  it("returns 1, not 2, when a violation is found alongside an unclassifiable field", () => {
    writeFileSync(
      registryPath,
      JSON.stringify({
        id: "acme-app",
        passages: [
          {
            id: "onboarding.empty-state",
            context: "onboarding card",
            fields: { title: "Nothing here yet.", weird: 42 },
          },
        ],
      }),
    );
    expect(mainPassagesCheck([registryPath])).toBe(1);
    expect(mainPassagesCheck([registryPath])).not.toBe(2);
  });

  it("throws CliInputError (mapped to 2 by runPassagesCheck) when registry-file is missing from argv", () => {
    expect(() => mainPassagesCheck([])).toThrow(/registry-file is required/);
  });
});
