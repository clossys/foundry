import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ENGAGEMENT_CONTEXT_FIELD_IDS,
  ENGAGEMENT_CONTEXT_KNOWN_CHOICES,
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

function briefWith(context?: unknown) {
  return {
    schemaVersion: 1,
    problem: "Founders can't tell if the landing page is working.",
    roles: [{ role: "strategist", why: "chosen", goal: { metric: "strategy traceability rate", direction: "increase" }, inputsFrom: [], outputsTo: [] }],
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

  it("reads every field known when the brief carries a full, well-formed context", () => {
    const result = readEngagementContextFromBriefData(briefWith(fullContext));
    expect(result.note).toBeUndefined();
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "known", value: "consumers" });
    expect(fieldById(result.context, "stage")).toEqual({ id: "stage", state: "known", value: "building" });
  });

  it("reads only the fields the brief actually carries as known, the rest as unknown", () => {
    const partial = { schemaVersion: 1, fields: [{ id: "business", state: "known", value: "agency-or-services" }, { id: "audience", state: "unknown" }] };
    const result = readEngagementContextFromBriefData(briefWith(partial));
    expect(result.note).toBeUndefined();
    expect(fieldById(result.context, "business")).toEqual({ id: "business", state: "known", value: "agency-or-services" });
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
    expect(fieldById(result.context, "product")).toEqual({ id: "product", state: "unknown" });
  });

  it("reads a brief with no context property at all as every field unknown, with no note (context is optional)", () => {
    const result = readEngagementContextFromBriefData(briefWith(undefined));
    expect(result.note).toBeUndefined();
    for (const id of ENGAGEMENT_CONTEXT_FIELD_IDS) {
      expect(fieldById(result.context, id)).toEqual({ id, state: "unknown" });
    }
  });

  it("reads every field unknown, with a note, when the brief is not an object", () => {
    const result = readEngagementContextFromBriefData("not an object");
    expect(result.note).toEqual(expect.any(String));
    for (const id of ENGAGEMENT_CONTEXT_FIELD_IDS) {
      expect(fieldById(result.context, id)).toEqual({ id, state: "unknown" });
    }
  });

  it("reads every field unknown, with a note, when the brief's schemaVersion is not 1", () => {
    const result = readEngagementContextFromBriefData({ ...briefWith(fullContext), schemaVersion: 2 });
    expect(result.note).toEqual(expect.any(String));
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
  });

  it("reads every field unknown, with a note, when the brief is missing a required key", () => {
    const brief = briefWith(fullContext) as Record<string, unknown>;
    delete brief.roles;
    const result = readEngagementContextFromBriefData(brief);
    expect(result.note).toEqual(expect.any(String));
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
  });

  it("reads every field unknown, with a note, when the brief carries an unexpected top-level key", () => {
    const brief = { ...briefWith(fullContext), somethingExtra: true };
    const result = readEngagementContextFromBriefData(brief);
    expect(result.note).toEqual(expect.any(String));
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
  });

  it("reads every field unknown, with a note, when context is not an object", () => {
    const result = readEngagementContextFromBriefData(briefWith("nonsense"));
    expect(result.note).toEqual(expect.any(String));
    for (const id of ENGAGEMENT_CONTEXT_FIELD_IDS) {
      expect(fieldById(result.context, id)).toEqual({ id, state: "unknown" });
    }
  });

  it("reads every field unknown, with a note, when context has no schemaVersion", () => {
    const { schemaVersion: _omit, ...contextWithoutSchemaVersion } = fullContext;
    const result = readEngagementContextFromBriefData(briefWith(contextWithoutSchemaVersion));
    expect(result.note).toEqual(expect.any(String));
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
  });

  it("reads every field unknown, with a note, when context's schemaVersion is not 1", () => {
    const result = readEngagementContextFromBriefData(briefWith({ ...fullContext, schemaVersion: 2 }));
    expect(result.note).toEqual(expect.any(String));
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
  });

  it("reads every field unknown, with a note, when context carries an unexpected top-level key", () => {
    const result = readEngagementContextFromBriefData(briefWith({ ...fullContext, note: "founder said this" }));
    expect(result.note).toEqual(expect.any(String));
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
  });

  it("reads every field unknown, with a note, when context has more than six fields", () => {
    const tooMany = { schemaVersion: 1, fields: [...fullContext.fields, { id: "audience", state: "known", value: "businesses" }] };
    const result = readEngagementContextFromBriefData(briefWith(tooMany));
    expect(result.note).toEqual(expect.any(String));
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
  });

  it("reads a field as unknown, not invented, when its value is outside that field's fixed choices", () => {
    const context = { schemaVersion: 1, fields: [{ id: "audience", state: "known", value: "mostly-dentists-near-our-office" }] };
    const result = readEngagementContextFromBriefData(briefWith(context));
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
  });

  it("reads a field as unknown when its id is duplicated", () => {
    const context = {
      schemaVersion: 1,
      fields: [
        { id: "audience", state: "known", value: "consumers" },
        { id: "audience", state: "known", value: "businesses" },
      ],
    };
    const result = readEngagementContextFromBriefData(briefWith(context));
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
  });

  it("reads a known-state field as unknown when its object carries any key beyond id/state/value", () => {
    const context = { schemaVersion: 1, fields: [{ id: "audience", state: "known", value: "consumers", note: "the founder's own words" }] };
    const result = readEngagementContextFromBriefData(briefWith(context));
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
  });

  it("reads a known-state field as unknown when it is missing the value key", () => {
    const context = { schemaVersion: 1, fields: [{ id: "audience", state: "known" }] };
    const result = readEngagementContextFromBriefData(briefWith(context));
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
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

  it("reads a real clossys/brief.json's context", () => {
    const briefDir = join(dir, "clossys");
    mkdirSync(briefDir, { recursive: true });
    writeFileSync(join(briefDir, "brief.json"), JSON.stringify(briefWith(fullContext)));
    const result = readEngagementContext(dir);
    expect(result.note).toBeUndefined();
    expect(audienceContextValue(result.context)).toBe("consumers");
  });

  it("reports a note and reads every field unknown when brief.json is not valid JSON, without echoing the parse error", () => {
    const briefDir = join(dir, "clossys");
    mkdirSync(briefDir, { recursive: true });
    writeFileSync(join(briefDir, "brief.json"), "{ not valid json");
    const result = readEngagementContext(dir);
    expect(result.note).toEqual(expect.any(String));
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

describe("ENGAGEMENT_CONTEXT_KNOWN_CHOICES", () => {
  it("mirrors docs/contracts/engagement-context.json's per-field value enums", () => {
    const contractPath = fileURLToPath(new URL("../../../docs/contracts/engagement-context.json", import.meta.url));
    const contract = JSON.parse(readFileSync(contractPath, "utf8")) as {
      definitions: { field: { oneOf: readonly { properties?: { id?: { const?: string }; value?: { enum?: readonly string[] } } }[] } };
    };
    const fromContract = new Map<string, readonly string[]>();
    for (const branch of contract.definitions.field.oneOf) {
      const id = branch.properties?.id?.const;
      const enumValues = branch.properties?.value?.enum;
      if (typeof id === "string" && enumValues !== undefined) fromContract.set(id, enumValues);
    }
    for (const id of ENGAGEMENT_CONTEXT_FIELD_IDS) {
      expect(ENGAGEMENT_CONTEXT_KNOWN_CHOICES[id]).toEqual(fromContract.get(id));
    }
    expect(fromContract.size).toBe(ENGAGEMENT_CONTEXT_FIELD_IDS.length);
  });
});
