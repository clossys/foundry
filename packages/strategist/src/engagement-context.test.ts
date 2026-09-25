import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ENGAGEMENT_CONTEXT_FIELD_IDS,
  audienceContextValue,
  fieldById,
  readEngagementContext,
  readEngagementContextFromBriefData,
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

  it("reads every field known when the brief carries a full context", () => {
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

  it("reads every field unknown, with a note, when schemaVersion is not 1", () => {
    const result = readEngagementContextFromBriefData({ ...briefWith(fullContext), schemaVersion: 2 });
    expect(result.note).toEqual(expect.any(String));
    expect(fieldById(result.context, "audience")).toEqual({ id: "audience", state: "unknown" });
  });

  it("reads every field unknown, with a note, when context does not match the contract's own shape", () => {
    const result = readEngagementContextFromBriefData(briefWith("nonsense"));
    expect(result.note).toEqual(expect.any(String));
    for (const id of ENGAGEMENT_CONTEXT_FIELD_IDS) {
      expect(fieldById(result.context, id)).toEqual({ id, state: "unknown" });
    }
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

  it("reports a note and asks everything when brief.json is not valid JSON", () => {
    const briefDir = join(dir, "clossys");
    mkdirSync(briefDir, { recursive: true });
    writeFileSync(join(briefDir, "brief.json"), "{ not valid json");
    const result = readEngagementContext(dir);
    expect(result.note).toEqual(expect.any(String));
    expect(audienceContextValue(result.context)).toBeUndefined();
  });
});
