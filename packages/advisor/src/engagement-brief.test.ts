import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_CATALOGUE,
  ENGAGEMENT_CONTEXT_FIELD_IDS,
  composeKit,
  contextFromBrief,
  toEngagementBrief,
} from "./index.js";
import type { ComposeKitResult, EngagementContext } from "./index.js";

/*
 * The brief and engagement-context contracts, checked against the real
 * output of toEngagementBrief() (issue #1173 follow-up, decision 28).
 *
 * No JSON-schema validator is a dependency of this repository, so this is a
 * deliberately minimal draft-07 checker covering exactly the keywords those
 * two contracts use. It refuses any keyword it does not implement, so a
 * contract that grows a new keyword fails here loudly rather than being
 * half-checked.
 */
type Schema = Record<string, unknown>;

const CONTRACTS = new URL("../../../docs/contracts/", import.meta.url);
function loadContract(name: string): Schema {
  return JSON.parse(readFileSync(new URL(name, CONTRACTS), "utf8")) as Schema;
}

const ANNOTATIONS = new Set(["$schema", "$id", "title", "description"]);
const IMPLEMENTED = new Set([
  "$ref", "type", "const", "enum", "required", "properties", "additionalProperties",
  "items", "minItems", "minLength", "pattern", "oneOf", "not", "definitions",
]);

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

/** Returns the validation errors for `value` under `schema`; `root` resolves "#/..." refs, `load` resolves file refs. */
function validate(schema: Schema, value: unknown, root: Schema, load: (name: string) => Schema, at = "$"): string[] {
  for (const key of Object.keys(schema)) {
    if (!ANNOTATIONS.has(key) && !IMPLEMENTED.has(key)) throw new Error(`minimal validator does not implement "${key}" (at ${at})`);
  }
  if (typeof schema.$ref === "string") {
    // Draft-07: $ref replaces every sibling keyword (siblings are annotations only).
    const [file = "", pointer = ""] = schema.$ref.split("#");
    const docRoot = file === "" ? root : load(file);
    let target: unknown = docRoot;
    for (const segment of pointer.split("/").filter(Boolean)) target = (target as Schema)[segment];
    return validate(target as Schema, value, docRoot, load, at);
  }
  const errors: string[] = [];
  const kind = typeOf(value);
  if (typeof schema.type === "string" && !(schema.type === kind || (schema.type === "number" && kind === "integer"))) {
    return [`${at}: expected ${schema.type}, got ${kind}`];
  }
  if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) errors.push(`${at}: must equal ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) errors.push(`${at}: not in enum`);
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${at}: does not match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) errors.push(`${at}: fewer than ${schema.minItems} item(s)`);
    if (schema.items !== undefined) value.forEach((item, index) => errors.push(...validate(schema.items as Schema, item, root, load, `${at}[${index}]`)));
  }
  if (kind === "object") {
    const record = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    for (const name of (schema.required ?? []) as string[]) if (!(name in record)) errors.push(`${at}: missing required "${name}"`);
    for (const [name, child] of Object.entries(record)) {
      if (name in properties) errors.push(...validate(properties[name] as Schema, child, root, load, `${at}.${name}`));
      else if (schema.additionalProperties === false) errors.push(`${at}: additional property "${name}"`);
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const passing = (schema.oneOf as Schema[]).filter((branch) => validate(branch, value, root, load, at).length === 0).length;
    if (passing !== 1) errors.push(`${at}: matches ${passing} oneOf branch(es), expected exactly 1`);
  }
  if (schema.not !== undefined && validate(schema.not as Schema, value, root, load, at).length === 0) errors.push(`${at}: matches a "not" schema`);
  return errors;
}

const briefSchema = loadContract("engagement-brief.json");
const contextSchema = loadContract("engagement-context.json");
const validateBrief = (value: unknown) => validate(briefSchema, value, briefSchema, loadContract);
const validateContext = (value: unknown) => validate(contextSchema, value, contextSchema, loadContract);

const composed = composeKit({ selectedRoles: ["writer"], catalogue: CAPABILITY_CATALOGUE }) as Extract<ComposeKitResult, { state: "composed" }>;
const PROBLEM = "Our words don't sound like us.";
const HUB: EngagementContext = {
  schemaVersion: 1,
  fields: ENGAGEMENT_CONTEXT_FIELD_IDS.map((id) => (id === "audience" ? { id, state: "known", value: "businesses" } : id === "stage" ? { id, state: "known", value: "building" } : { id, state: "unknown" })),
};

describe("minimal draft-07 checker", () => {
  it("applies a sibling additionalProperties:false to sibling properties only, as draft-07 does", () => {
    const misplaced: Schema = { type: "object", additionalProperties: false, oneOf: [{ required: ["id"], properties: { id: { type: "string" } } }] };
    expect(validate(misplaced, { id: "x" }, misplaced, loadContract)).not.toEqual([]);
    const perBranch: Schema = { type: "object", oneOf: [{ additionalProperties: false, required: ["id"], properties: { id: { type: "string" } } }] };
    expect(validate(perBranch, { id: "x" }, perBranch, loadContract)).toEqual([]);
    expect(validate(perBranch, { id: "x", extra: 1 }, perBranch, loadContract)).not.toEqual([]);
  });
});

describe("engagement contracts against toEngagementBrief() output", () => {
  it("a real brief carrying a context snapshot satisfies the brief contract", () => {
    const brief = toEngagementBrief({ problem: PROBLEM, composed, catalogue: CAPABILITY_CATALOGUE, context: HUB });
    expect(brief.context).toBeDefined();
    expect(validateBrief(JSON.parse(JSON.stringify(brief)))).toEqual([]);
  });

  it("a real brief without a snapshot satisfies it too", () => {
    const brief = toEngagementBrief({ problem: PROBLEM, composed, catalogue: CAPABILITY_CATALOGUE });
    expect(validateBrief(JSON.parse(JSON.stringify(brief)))).toEqual([]);
  });

  it("the hub record itself satisfies the engagement-context contract", () => {
    expect(validateContext(HUB)).toEqual([]);
  });

  it("the context contract rejects freeform prose, the non-answer ids, stray keys, and a value on an unknown field", () => {
    const withAudience = (field: unknown) => ({ schemaVersion: 1, fields: [field] });
    expect(validateContext(withAudience({ id: "audience", state: "known", value: "Mostly dentists near our office" }))).not.toEqual([]);
    expect(validateContext(withAudience({ id: "audience", state: "known", value: "something-else" }))).not.toEqual([]);
    expect(validateContext(withAudience({ id: "audience", state: "known", value: "unknown" }))).not.toEqual([]);
    expect(validateContext(withAudience({ id: "audience", state: "known", value: "businesses", note: "x" }))).not.toEqual([]);
    expect(validateContext(withAudience({ id: "audience", state: "unknown", value: "businesses" }))).not.toEqual([]);
    expect(validateContext(withAudience({ id: "Audience", state: "unknown" }))).not.toEqual([]);
  });
});

describe("toEngagementBrief() keeps freeform text out of the committed brief", () => {
  const withAudience = (value: string): EngagementContext => ({ schemaVersion: 1, fields: [{ id: "audience", state: "known", value }] });

  it("throws on a known value that is not a choice-id slug, without echoing it", () => {
    const prose = "Mostly dentists near our office";
    expect(() => toEngagementBrief({ problem: PROBLEM, composed, catalogue: CAPABILITY_CATALOGUE, context: withAudience(prose) })).toThrow(/choice-id slug/);
    try {
      toEngagementBrief({ problem: PROBLEM, composed, catalogue: CAPABILITY_CATALOGUE, context: withAudience(prose) });
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("dentists");
    }
  });

  it("throws on the non-answer ids stored as a known value", () => {
    for (const value of ["unknown", "something-else"]) {
      expect(() => toEngagementBrief({ problem: PROBLEM, composed, catalogue: CAPABILITY_CATALOGUE, context: withAudience(value) })).toThrow(TypeError);
    }
  });

  it("throws on a field id that is not a context field id", () => {
    const bad = { schemaVersion: 1, fields: [{ id: "budget", state: "unknown" }] } as unknown as EngagementContext;
    expect(() => toEngagementBrief({ problem: PROBLEM, composed, catalogue: CAPABILITY_CATALOGUE, context: bad })).toThrow(/not a context field id/);
  });

  it("drops keys the contract does not allow rather than copying them", () => {
    const extra = { schemaVersion: 1, fields: [{ id: "audience", state: "known", value: "businesses", note: "free text" }] } as unknown as EngagementContext;
    const brief = toEngagementBrief({ problem: PROBLEM, composed, catalogue: CAPABILITY_CATALOGUE, context: extra });
    expect(brief.context?.fields).toEqual([{ id: "audience", state: "known", value: "businesses" }]);
  });
});

describe("contextFromBrief()", () => {
  it("fills every field missing from a partial snapshot as unknown, in the fixed field order", () => {
    const partial = { context: { schemaVersion: 1 as const, fields: [{ id: "stage" as const, state: "known" as const, value: "building" }] } };
    const context = contextFromBrief(partial);
    expect(context.fields.map((field) => field.id)).toEqual([...ENGAGEMENT_CONTEXT_FIELD_IDS]);
    expect(context.fields.find((field) => field.id === "stage")).toEqual({ id: "stage", state: "known", value: "building" });
    expect(context.fields.filter((field) => field.state === "unknown")).toHaveLength(ENGAGEMENT_CONTEXT_FIELD_IDS.length - 1);
    expect(contextFromBrief({ context: { schemaVersion: 1, fields: [] } }).fields.every((field) => field.state === "unknown")).toBe(true);
  });

  it("returns a copy, never the brief's own snapshot", () => {
    const brief = toEngagementBrief({ problem: PROBLEM, composed, catalogue: CAPABILITY_CATALOGUE, context: HUB });
    const read = contextFromBrief(brief);
    expect(read).toEqual(brief.context);
    expect(read).not.toBe(brief.context);
    expect(read.fields[0]).not.toBe(brief.context?.fields[0]);
  });
});
