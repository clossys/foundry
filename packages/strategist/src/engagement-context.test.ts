import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ENGAGEMENT_CONTEXT_FIELD_IDS,
  audienceContextValue,
  fieldById,
  readEngagementContext,
  readEngagementContextFromBriefData,
  unreadableBriefNote,
} from "./engagement-context.js";

// Hermetic: every fs test operates on its own `mkdtemp` directory, created
// in beforeEach and removed in afterEach — the same convention reader.test.ts
// uses for readStrategy.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "strategist-engagement-context-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const NOTE_BRIEF_INVALID = "clossys/brief.json does not match docs/contracts/engagement-brief.json; asking every engagement-context question as usual.";
const NOTE_UNPARSEABLE = "clossys/brief.json is not valid JSON; asking every engagement-context question as usual.";

const validRole = {
  role: "strategist",
  why: "chosen",
  goal: { metric: "strategy traceability rate", direction: "increase" },
  inputsFrom: [],
  outputsTo: [],
};

const fullContext = {
  schemaVersion: 1,
  fields: [
    { id: "business", state: "known", value: "product-or-service" },
    { id: "product", state: "known", value: "software" },
    { id: "audience", state: "known", value: "consumers" },
    { id: "stage", state: "known", value: "building" },
    { id: "intent", state: "known", value: "validate" },
    { id: "constraints", state: "known", value: "none-known" },
  ],
};

/** A brief that fully validates against docs/contracts/engagement-brief.json — every required key, `roles` non-empty (the contract's own `minItems: 1`), and (when given) a well-formed `context`. */
function briefWith(context?: unknown) {
  return {
    schemaVersion: 1,
    problem: "Founders can't tell if the landing page is working.",
    roles: [validRole],
    sequence: ["strategist"],
    deliverables: ["A cited direction record."],
    ...(context === undefined ? {} : { context }),
  };
}

describe("readEngagementContextFromBriefData", () => {
  it("reads every field unknown, with no note, when there is no brief", () => {
    const result = readEngagementContextFromBriefData(undefined);
    expect(result.note).toBeUndefined();
    for (const id of ENGAGEMENT_CONTEXT_FIELD_IDS) {
      expect(fieldById(result.context, id)).toEqual({ id, state: "unknown" });
    }
  });

  it("reads every field known when the brief fully validates with a full context", () => {
    const result = readEngagementContextFromBriefData(briefWith(fullContext));
    expect(result.note).toBeUndefined();
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "known", value: "consumers" });
    expect(fieldById(result.context, "stage")).toEqual({ id: "stage", state: "known", value: "building" });
  });

  it("reads only the fields the brief actually carries as known, the rest as unknown, in a fully valid partial context", () => {
    const partial = {
      schemaVersion: 1,
      fields: [
        { id: "business", state: "known", value: "agency-or-services" },
        { id: "product", state: "unknown" },
        { id: "audience", state: "unknown" },
        { id: "stage", state: "unknown" },
        { id: "intent", state: "unknown" },
        { id: "constraints", state: "unknown" },
      ],
    };
    const result = readEngagementContextFromBriefData(briefWith(partial));
    expect(result.note).toBeUndefined();
    expect(fieldById(result.context, "business")).toEqual({ id: "business", state: "known", value: "agency-or-services" });
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
  });

  it("reads a brief with no context property at all as every field unknown, with no note (context is optional)", () => {
    const result = readEngagementContextFromBriefData(briefWith(undefined));
    expect(result.note).toBeUndefined();
    for (const id of ENGAGEMENT_CONTEXT_FIELD_IDS) {
      expect(fieldById(result.context, id)).toEqual({ id, state: "unknown" });
    }
  });

  it("reads every field unknown, with a fixed note, when the brief is not an object", () => {
    const result = readEngagementContextFromBriefData("not an object");
    expect(result.note).toBe(NOTE_BRIEF_INVALID);
    for (const id of ENGAGEMENT_CONTEXT_FIELD_IDS) {
      expect(fieldById(result.context, id)).toEqual({ id, state: "unknown" });
    }
  });

  it("reads every field unknown, with a fixed note, when the brief is missing a required key", () => {
    const brief = briefWith(fullContext) as Record<string, unknown>;
    delete brief.roles;
    const result = readEngagementContextFromBriefData(brief);
    expect(result.note).toBe(NOTE_BRIEF_INVALID);
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
  });

  it("reads every field unknown, with a fixed note, when the brief carries an unexpected top-level key", () => {
    const brief = { ...briefWith(fullContext), somethingExtra: true };
    const result = readEngagementContextFromBriefData(brief);
    expect(result.note).toBe(NOTE_BRIEF_INVALID);
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
  });

  it("reads every field unknown, with a fixed note, when the brief's schemaVersion is not 1", () => {
    const result = readEngagementContextFromBriefData({ ...briefWith(fullContext), schemaVersion: 2 });
    expect(result.note).toBe(NOTE_BRIEF_INVALID);
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
  });

  it("reads every field unknown, with a fixed note, when context has no schemaVersion", () => {
    const { schemaVersion: _omit, ...contextWithoutSchemaVersion } = fullContext;
    const result = readEngagementContextFromBriefData(briefWith(contextWithoutSchemaVersion));
    expect(result.note).toBe(NOTE_BRIEF_INVALID);
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
  });

  it("reads every field unknown, with a fixed note, when context's schemaVersion is not 1", () => {
    const result = readEngagementContextFromBriefData(briefWith({ ...fullContext, schemaVersion: 2 }));
    expect(result.note).toBe(NOTE_BRIEF_INVALID);
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
  });

  it("reads every field unknown, with a fixed note, when context carries an unexpected top-level key", () => {
    const result = readEngagementContextFromBriefData(briefWith({ ...fullContext, note: "founder said this" }));
    expect(result.note).toBe(NOTE_BRIEF_INVALID);
    expect(result.note).not.toContain("founder said this");
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
  });

  it("reads every field unknown, with a fixed note, when context has more than six fields", () => {
    const tooMany = { schemaVersion: 1, fields: [...fullContext.fields, { id: "audience", state: "known", value: "businesses" }] };
    const result = readEngagementContextFromBriefData(briefWith(tooMany));
    expect(result.note).toBe(NOTE_BRIEF_INVALID);
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
  });

  it("reads EVERY field unknown, not just the offending one, when a field's value is outside its fixed choices — all-or-nothing", () => {
    const context = {
      schemaVersion: 1,
      fields: [{ id: "audience", state: "known", value: "mostly-dentists-near-our-office" }, ...fullContext.fields.filter((field) => field.id !== "audience")],
    };
    const result = readEngagementContextFromBriefData(briefWith(context));
    expect(result.note).toBe(NOTE_BRIEF_INVALID);
    // The rest of the context was otherwise valid, but nothing is trusted from an invalid brief.
    expect(fieldById(result.context, "business")).toEqual({ id: "business", state: "unknown" });
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
  });

  it("reads EVERY field unknown, not just the duplicated one, when a field id is duplicated — all-or-nothing", () => {
    const context = {
      schemaVersion: 1,
      fields: [
        { id: "audience", state: "known", value: "consumers" },
        { id: "audience", state: "known", value: "businesses" },
        { id: "business", state: "unknown" },
        { id: "product", state: "unknown" },
        { id: "stage", state: "unknown" },
        { id: "intent", state: "unknown" },
      ],
    };
    const result = readEngagementContextFromBriefData(briefWith(context));
    expect(result.note).toBe(NOTE_BRIEF_INVALID);
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
    expect(fieldById(result.context, "business")).toEqual({ id: "business", state: "unknown" });
  });

  it("reads EVERY field unknown, not just the offending one, when a known-state field object carries any key beyond id/state/value", () => {
    const context = {
      schemaVersion: 1,
      fields: [{ id: "audience", state: "known", value: "consumers", note: "the founder's own words" }, ...fullContext.fields.filter((field) => field.id !== "audience")],
    };
    const result = readEngagementContextFromBriefData(briefWith(context));
    expect(result.note).toBe(NOTE_BRIEF_INVALID);
    expect(result.note).not.toContain("founder's own words");
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
    expect(fieldById(result.context, "stage")).toEqual({ id: "stage", state: "unknown" });
  });
});

describe("audienceContextValue", () => {
  it("returns the known audience choice", () => {
    const result = readEngagementContextFromBriefData(briefWith(fullContext));
    expect(audienceContextValue(result.context)).toBe("consumers");
  });

  it("returns undefined when audience is unknown", () => {
    const result = readEngagementContextFromBriefData(undefined);
    expect(audienceContextValue(result.context)).toBeUndefined();
  });
});

describe("readEngagementContext (filesystem)", () => {
  it("reads every field unknown, with no note, when clossys/brief.json does not exist", () => {
    const result = readEngagementContext(dir);
    expect(result.note).toBeUndefined();
    expect(audienceContextValue(result.context)).toBeUndefined();
  });

  it("reads a real, fully valid clossys/brief.json's context", () => {
    const briefDir = join(dir, "clossys");
    mkdirSync(briefDir, { recursive: true });
    writeFileSync(join(briefDir, "brief.json"), JSON.stringify(briefWith(fullContext)));
    const result = readEngagementContext(dir);
    expect(result.note).toBeUndefined();
    expect(audienceContextValue(result.context)).toBe("consumers");
  });

  it("reports a note carrying only the syntax position, no file text, when brief.json is not valid JSON", () => {
    const briefDir = join(dir, "clossys");
    mkdirSync(briefDir, { recursive: true });
    writeFileSync(join(briefDir, "brief.json"), '{ "problem": "this JSON is broken on purpose, secret-founder-detail"');
    const result = readEngagementContext(dir);
    expect(result.note).toEqual(expect.stringMatching(/^clossys\/brief\.json is not valid JSON at position \d+;/));
    expect(result.note).not.toContain("secret-founder-detail");
    expect(audienceContextValue(result.context)).toBeUndefined();
  });

  it("reports the fixed note, no file text, when brief.json repeats an object key (strict-JSON refuses it, not schema validation)", () => {
    const briefDir = join(dir, "clossys");
    mkdirSync(briefDir, { recursive: true });
    writeFileSync(join(briefDir, "brief.json"), '{ "schemaVersion": 1, "problem": "p", "problem": "sensitive-duplicate-key-payload" }');
    const result = readEngagementContext(dir);
    expect(result.note).toBe(NOTE_UNPARSEABLE);
    expect(result.note).not.toContain("sensitive-duplicate-key-payload");
    expect(audienceContextValue(result.context)).toBeUndefined();
  });

  // B1 regression (blind review of #1173): a repeated key's own message
  // names that key, and the prior implementation extracted a note's
  // "position" by regex-matching /position (\d+)/ anywhere in that
  // message — so a repeated key literally named "position <digits>" made
  // the note relay that key's text as if it were a real syntax position.
  // The fix reads only ContractDocumentError's own structured `position`
  // field, which repeated-key errors never set, so these can never regress.
  it("reports the fixed note, not the repeated key's own text, when the repeated key is named 'position <digits>' at the top level", () => {
    const briefDir = join(dir, "clossys");
    mkdirSync(briefDir, { recursive: true });
    writeFileSync(join(briefDir, "brief.json"), '{ "schemaVersion": 1, "position 5551234567": 1, "position 5551234567": 2 }');
    const result = readEngagementContext(dir);
    expect(result.note).toBe(NOTE_UNPARSEABLE);
    expect(result.note).not.toContain("5551234567");
    expect(result.note).not.toContain("position 5551234567");
    expect(audienceContextValue(result.context)).toBeUndefined();
  });

  it("reports the fixed note, not the repeated key's own text, when the repeated key is named 'position <digits>' nested inside the brief", () => {
    const briefDir = join(dir, "clossys");
    mkdirSync(briefDir, { recursive: true });
    // A JS object literal cannot itself carry a genuinely duplicate key (the
    // second assignment would just overwrite the first), so the nested
    // duplicate has to be written as JSON text directly.
    const nestedDuplicate =
      '{"schemaVersion":1,"problem":"p",' +
      '"roles":[{"role":"strategist","why":"chosen","goal":{"metric":"m","direction":"increase"},"inputsFrom":[],"outputsTo":[]}],' +
      '"sequence":[],"deliverables":[],' +
      '"context":{"position 5551234567":1,"position 5551234567":2,"schemaVersion":1,"fields":[]}}';
    writeFileSync(join(briefDir, "brief.json"), nestedDuplicate);
    const result = readEngagementContext(dir);
    expect(result.note).toBe(NOTE_UNPARSEABLE);
    expect(result.note).not.toContain("5551234567");
    expect(audienceContextValue(result.context)).toBeUndefined();
  });

  it("reports the fixed brief-invalid note when brief.json is valid JSON but does not validate against the contract (a duplicate context field id)", () => {
    const briefDir = join(dir, "clossys");
    mkdirSync(briefDir, { recursive: true });
    const context = {
      schemaVersion: 1,
      fields: [
        { id: "audience", state: "known", value: "consumers" },
        { id: "audience", state: "known", value: "businesses" },
        { id: "business", state: "unknown" },
        { id: "product", state: "unknown" },
        { id: "stage", state: "unknown" },
        { id: "intent", state: "unknown" },
      ],
    };
    writeFileSync(join(briefDir, "brief.json"), JSON.stringify(briefWith(context)));
    const result = readEngagementContext(dir);
    expect(result.note).toBe(NOTE_BRIEF_INVALID);
    expect(audienceContextValue(result.context)).toBeUndefined();
  });

  it("reports a note carrying only EISDIR, no message or path, when brief.json is actually a directory", () => {
    const briefDir = join(dir, "clossys");
    mkdirSync(join(briefDir, "brief.json"), { recursive: true });
    const result = readEngagementContext(dir);
    expect(result.note).toContain("EISDIR");
    expect(result.note).not.toContain(dir);
    expect(result.note).not.toContain("illegal operation");
    expect(audienceContextValue(result.context)).toBeUndefined();
  });
});

describe("unreadableBriefNote", () => {
  it("carries only the error's code, never its message, even when the message embeds machine-specific detail", () => {
    // The literal below stands in for a real Node fs error message, which
    // typically embeds the resolved filesystem path — deliberately not a
    // realistic path shape itself, so this fixture cannot itself trip the
    // repository's own public-safety scan for a local machine path.
    const note = unreadableBriefNote({ code: "EACCES", message: "EACCES permission denied opening MACHINE-SPECIFIC-DETAIL-goes-here" });
    expect(note).toBe("clossys/brief.json could not be read (EACCES); asking every engagement-context question as usual.");
    expect(note).not.toContain("MACHINE-SPECIFIC-DETAIL");
    expect(note).not.toContain("permission denied");
  });

  it("falls back to UNKNOWN when the error carries no code", () => {
    expect(unreadableBriefNote(new Error("some message with machine-specific detail"))).toBe(
      "clossys/brief.json could not be read (UNKNOWN); asking every engagement-context question as usual.",
    );
    expect(unreadableBriefNote("not an error object")).toContain("UNKNOWN");
  });
});

describe("ENGAGEMENT_CONTEXT_FIELD_IDS", () => {
  it("mirrors docs/contracts/engagement-context.json's fieldId enum (the same parity check @clossys/advisor's own composition.test.ts runs)", () => {
    const contractPath = fileURLToPath(new URL("../../../docs/contracts/engagement-context.json", import.meta.url));
    const contract = JSON.parse(readFileSync(contractPath, "utf8")) as { definitions: { fieldId: { enum: readonly string[] } } };
    expect(contract.definitions.fieldId.enum).toEqual([...ENGAGEMENT_CONTEXT_FIELD_IDS]);
  });
});
