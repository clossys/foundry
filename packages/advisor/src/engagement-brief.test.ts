import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_CATALOGUE,
  ENGAGEMENT_CONTEXT_FIELD_IDS,
  applyContextChoice,
  composeKit,
  contextFromBrief,
  nextContextQuestion,
  toEngagementBrief,
} from "./index.js";
import type { ComposeKitResult, EngagementBrief, EngagementContext, EngagementContextField, EngagementContextFieldId } from "./index.js";

/*
 * The brief and engagement-context contracts, checked against the real
 * output of toEngagementBrief() (issue #1173 follow-up, decision 28).
 *
 * No JSON-schema validator is a dependency of this repository, so this is a
 * deliberately minimal draft-07 checker covering exactly the keywords those
 * two contracts use. Every contract is walked in full when it is loaded, so a
 * keyword it does not implement -- or a keyword form it does not implement,
 * such as an array-valued `type` or a schema-valued `additionalProperties` --
 * throws even under a property the value under test never carries, rather
 * than being half-checked. Property lookups use Object.hasOwn, so an
 * inherited name (toString, constructor, __proto__) is never mistaken for a
 * declared property or a present required one.
 */
type Schema = Record<string, unknown>;

const ANNOTATIONS = new Set(["$schema", "$id", "title", "description"]);
const IMPLEMENTED = new Set([
  "$ref", "type", "const", "enum", "required", "properties", "additionalProperties",
  "items", "minItems", "maxItems", "contains", "minLength", "pattern", "oneOf", "allOf", "not", "definitions",
]);

/** Throws on any keyword, or keyword form, the checker does not implement -- for this node only. */
function assertImplementedNode(schema: Schema, at: string): void {
  for (const key of Object.keys(schema)) {
    if (!ANNOTATIONS.has(key) && !IMPLEMENTED.has(key)) throw new Error(`minimal validator does not implement "${key}" (at ${at})`);
  }
  if (Object.hasOwn(schema, "type") && typeof schema.type !== "string") throw new Error(`minimal validator implements only a string "type" (at ${at})`);
  if (Object.hasOwn(schema, "additionalProperties") && typeof schema.additionalProperties !== "boolean") {
    throw new Error(`minimal validator implements only a boolean "additionalProperties" (at ${at})`);
  }
  if (Object.hasOwn(schema, "items") && Array.isArray(schema.items)) throw new Error(`minimal validator does not implement tuple "items" (at ${at})`);
}

/** Walks every subschema of `schema`, visited by a value or not, through assertImplementedNode. */
function assertImplemented(schema: Schema, at = "#"): void {
  assertImplementedNode(schema, at);
  for (const key of ["properties", "definitions"]) {
    for (const [name, child] of Object.entries((schema[key] ?? {}) as Record<string, Schema>)) assertImplemented(child, `${at}/${key}/${name}`);
  }
  for (const key of ["items", "contains", "not"]) if (Object.hasOwn(schema, key)) assertImplemented(schema[key] as Schema, `${at}/${key}`);
  for (const key of ["oneOf", "allOf"]) (Array.isArray(schema[key]) ? (schema[key] as Schema[]) : []).forEach((child, index) => assertImplemented(child, `${at}/${key}/${index}`));
}

const CONTRACTS = new URL("../../../docs/contracts/", import.meta.url);
function loadContract(name: string): Schema {
  const schema = JSON.parse(readFileSync(new URL(name, CONTRACTS), "utf8")) as Schema;
  assertImplemented(schema);
  return schema;
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

/** Returns the validation errors for `value` under `schema`; `root` resolves "#/..." refs, `load` resolves file refs. */
function validate(schema: Schema, value: unknown, root: Schema, load: (name: string) => Schema, at = "$"): string[] {
  assertImplementedNode(schema, at);
  if (typeof schema.$ref === "string") {
    // Draft-07: $ref replaces every sibling keyword (siblings are annotations only).
    const [file = "", pointer = ""] = schema.$ref.split("#");
    const docRoot = file === "" ? root : load(file);
    let target: unknown = docRoot;
    for (const segment of pointer.split("/").filter(Boolean)) {
      if (!Object.hasOwn(target as Schema, segment)) throw new Error(`unresolvable $ref ${schema.$ref} (at ${at})`);
      target = (target as Schema)[segment];
    }
    return validate(target as Schema, value, docRoot, load, at);
  }
  const errors: string[] = [];
  const kind = typeOf(value);
  if (typeof schema.type === "string" && !(schema.type === kind || (schema.type === "number" && kind === "integer"))) {
    return [`${at}: expected ${schema.type}, got ${kind}`];
  }
  if (Object.hasOwn(schema, "const") && JSON.stringify(schema.const) !== JSON.stringify(value)) errors.push(`${at}: must equal ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) errors.push(`${at}: not in enum`);
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${at}: does not match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) errors.push(`${at}: fewer than ${schema.minItems} item(s)`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) errors.push(`${at}: more than ${schema.maxItems} item(s)`);
    if (schema.items !== undefined) value.forEach((item, index) => errors.push(...validate(schema.items as Schema, item, root, load, `${at}[${index}]`)));
    if (schema.contains !== undefined && !value.some((item, index) => validate(schema.contains as Schema, item, root, load, `${at}[${index}]`).length === 0)) {
      errors.push(`${at}: no item matches "contains"`);
    }
  }
  if (kind === "object") {
    const record = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    for (const name of (schema.required ?? []) as string[]) if (!Object.hasOwn(record, name)) errors.push(`${at}: missing required "${name}"`);
    for (const [name, child] of Object.entries(record)) {
      if (Object.hasOwn(properties, name)) errors.push(...validate(properties[name] as Schema, child, root, load, `${at}.${name}`));
      else if (schema.additionalProperties === false) errors.push(`${at}: additional property "${name}"`);
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const passing = (schema.oneOf as Schema[]).filter((branch) => validate(branch, value, root, load, at).length === 0).length;
    if (passing !== 1) errors.push(`${at}: matches ${passing} oneOf branch(es), expected exactly 1`);
  }
  if (Array.isArray(schema.allOf)) for (const branch of schema.allOf as Schema[]) errors.push(...validate(branch, value, root, load, at));
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

/** A field's fixed known choice ids, read from its own Advisor question card -- never a copy. */
function knownChoiceIds(id: EngagementContextFieldId): string[] {
  const others = ENGAGEMENT_CONTEXT_FIELD_IDS.filter((other) => other !== id).map((other): EngagementContextField => ({ id: other, state: "known", value: "answered" }));
  const card = nextContextQuestion({ fields: others });
  if (card?.fieldId !== id) throw new Error(`no question card for ${id}`);
  return card.choices.map((choice) => choice.id).filter((choiceId) => applyContextChoice(id, choiceId).kind === "known");
}

/** The hub record with its audience entry replaced by `field` (raw JSON, so the contract sees exactly this). */
const hubWith = (field: unknown) => ({ schemaVersion: 1, fields: HUB.fields.map((entry) => (entry.id === "audience" ? field : entry)) });
const SLUGIFIED_PROSE = "mostly-dentists-near-our-office-on-main-street";
const OVERLONG_SLUG = Array.from({ length: 2000 }, (_, index) => `w${index % 10}`).join("-").slice(0, 9999);
const PROTOTYPE_KEYS = ["toString", "constructor", "hasOwnProperty", "__proto__"];

describe("minimal draft-07 checker", () => {
  it("applies a sibling additionalProperties:false to sibling properties only, as draft-07 does", () => {
    const misplaced: Schema = { type: "object", additionalProperties: false, oneOf: [{ required: ["id"], properties: { id: { type: "string" } } }] };
    expect(validate(misplaced, { id: "x" }, misplaced, loadContract)).not.toEqual([]);
    const perBranch: Schema = { type: "object", oneOf: [{ additionalProperties: false, required: ["id"], properties: { id: { type: "string" } } }] };
    expect(validate(perBranch, { id: "x" }, perBranch, loadContract)).toEqual([]);
    expect(validate(perBranch, { id: "x", extra: 1 }, perBranch, loadContract)).not.toEqual([]);
  });

  it("never lets an inherited name pass additionalProperties:false or satisfy required", () => {
    const closed: Schema = { type: "object", additionalProperties: false, properties: { id: { type: "string" } } };
    for (const key of PROTOTYPE_KEYS) {
      const value = JSON.parse(`{"id":"x",${JSON.stringify(key)}:"free text"}`) as unknown;
      expect(Object.hasOwn(value as object, key)).toBe(true);
      expect(validate(closed, value, closed, loadContract)).toContain(`$: additional property "${key}"`);
    }
    const needs: Schema = { type: "object", required: ["toString", "constructor"] };
    expect(validate(needs, {}, needs, loadContract)).toHaveLength(2);
  });

  it("throws on keyword forms it does not implement instead of ignoring them", () => {
    const arrayType: Schema = { type: ["string", "null"] };
    expect(() => validate(arrayType, 5, arrayType, loadContract)).toThrow(/string "type"/);
    const schemaValued: Schema = { type: "object", additionalProperties: { type: "string" } };
    expect(() => validate(schemaValued, { x: 5 }, schemaValued, loadContract)).toThrow(/boolean "additionalProperties"/);
  });

  it("walks the whole contract, so a keyword under a property the value lacks still throws", () => {
    expect(() => assertImplemented({ properties: { a: { maxLength: 3 } } })).toThrow(/"maxLength" \(at #\/properties\/a\)/);
    expect(() => assertImplemented({ definitions: { a: { oneOf: [{ type: ["string"] }] } } })).toThrow(/string "type"/);
    expect(() => assertImplemented(briefSchema)).not.toThrow();
    expect(() => assertImplemented(contextSchema)).not.toThrow();
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

  it("keeps each field's contract enum equal to that field's own card choices", () => {
    const field = contextSchema.definitions as { field: { oneOf: Array<{ properties: { id: { const?: string }; value?: { enum: string[] } } }> } };
    for (const id of ENGAGEMENT_CONTEXT_FIELD_IDS) {
      const branch = field.field.oneOf.find((candidate) => candidate.properties.id.const === id);
      expect(branch?.properties.value?.enum).toEqual(knownChoiceIds(id));
    }
  });

  it("accepts every field's own fixed choice ids and nothing else", () => {
    for (const id of ENGAGEMENT_CONTEXT_FIELD_IDS) {
      for (const value of knownChoiceIds(id)) {
        const record = { schemaVersion: 1, fields: HUB.fields.map((entry) => (entry.id === id ? { id, state: "known", value } : entry)) };
        expect(validateContext(record)).toEqual([]);
      }
    }
    // A real choice id of another field is still not a choice id of this one.
    expect(validateContext(hubWith({ id: "audience", state: "known", value: "software" }))).not.toEqual([]);
  });

  it("the context contract rejects prose, slugified prose, an over-long slug, the non-answer ids, stray keys, and a value on an unknown field", () => {
    for (const value of ["Mostly dentists near our office", SLUGIFIED_PROSE, OVERLONG_SLUG, "something-else", "unknown", "toString", "__proto__"]) {
      expect(validateContext(hubWith({ id: "audience", state: "known", value }))).not.toEqual([]);
    }
    expect(validateContext(hubWith({ id: "audience", state: "known", value: "businesses", note: "x" }))).not.toEqual([]);
    expect(validateContext(hubWith({ id: "audience", state: "unknown", value: "businesses" }))).not.toEqual([]);
    expect(validateContext(hubWith({ id: "Audience", state: "unknown" }))).not.toEqual([]);
  });

  it("the context contract rejects inherited-name keys on a field", () => {
    for (const key of PROTOTYPE_KEYS) {
      const field = JSON.parse(`{"id":"audience","state":"unknown",${JSON.stringify(key)}:"free text"}`) as unknown;
      expect(validateContext(hubWith(field))).not.toEqual([]);
    }
    for (const id of PROTOTYPE_KEYS) expect(validateContext(hubWith({ id, state: "unknown" }))).not.toEqual([]);
  });

  it("the context contract rejects a duplicate field id, with or without a seventh entry", () => {
    const duplicateAudience = { id: "audience", state: "known", value: "consumers" };
    expect(validateContext({ schemaVersion: 1, fields: [...HUB.fields, duplicateAudience] })).not.toEqual([]);
    const displaced = { schemaVersion: 1, fields: HUB.fields.map((entry) => (entry.id === "business" ? duplicateAudience : entry)) };
    expect(validateContext(displaced)).not.toEqual([]);
  });
});

describe("toEngagementBrief() keeps founder text out of the committed brief", () => {
  const withAudience = (value: string): EngagementContext => ({ schemaVersion: 1, fields: [{ id: "audience", state: "known", value }] });
  const brief = (context: EngagementContext) => toEngagementBrief({ problem: PROBLEM, composed, catalogue: CAPABILITY_CATALOGUE, context });

  it("throws on a known value that is not a fixed choice id, without echoing it", () => {
    for (const value of ["Mostly dentists near our office", SLUGIFIED_PROSE, OVERLONG_SLUG]) {
      expect(() => brief(withAudience(value))).toThrow(/fixed choice ids/);
      try {
        brief(withAudience(value));
      } catch (error) {
        expect(String((error as Error).message)).not.toContain("dentists");
        expect(String((error as Error).message)).not.toContain("w1-w2");
      }
    }
  });

  it("throws on the non-answer ids, another field's choice id, and inherited names stored as a known value", () => {
    for (const value of ["unknown", "something-else", "software", ...PROTOTYPE_KEYS]) {
      expect(() => brief(withAudience(value))).toThrow(TypeError);
    }
  });

  it("copies every field's own fixed choice ids", () => {
    for (const id of ENGAGEMENT_CONTEXT_FIELD_IDS) {
      for (const value of knownChoiceIds(id)) {
        const snapshot = brief({ schemaVersion: 1, fields: [{ id, state: "known", value }] }).context;
        expect(snapshot?.fields.find((field) => field.id === id)).toEqual({ id, state: "known", value });
      }
    }
  });

  it("throws on a field id that is not a context field id, including inherited names", () => {
    for (const id of ["budget", ...PROTOTYPE_KEYS]) {
      const bad = { schemaVersion: 1, fields: [{ id, state: "unknown" }] } as unknown as EngagementContext;
      expect(() => brief(bad)).toThrow(/not a context field id/);
    }
  });

  it("throws on a duplicate field id rather than keeping either entry", () => {
    const duplicated: EngagementContext = {
      schemaVersion: 1,
      fields: [
        { id: "audience", state: "known", value: "businesses" },
        { id: "audience", state: "known", value: "consumers" },
      ],
    };
    expect(() => brief(duplicated)).toThrow(/more than once/);
    expect(() => brief({ schemaVersion: 1, fields: [...HUB.fields, { id: "stage", state: "unknown" }] })).toThrow(/more than once/);
  });

  it("drops keys the contract does not allow, inherited names included, rather than copying them", () => {
    for (const key of ["note", ...PROTOTYPE_KEYS]) {
      const field = JSON.parse(`{"id":"audience","state":"known","value":"businesses",${JSON.stringify(key)}:"free text"}`) as EngagementContextField;
      const snapshot = brief({ schemaVersion: 1, fields: [field] }).context;
      expect(snapshot?.fields.find((entry) => entry.id === "audience")).toEqual({ id: "audience", state: "known", value: "businesses" });
      expect(Object.keys(snapshot?.fields.find((entry) => entry.id === "audience") ?? {})).toEqual(["id", "state", "value"]);
    }
  });

  it("writes one entry per field id in the fixed field order, a field the context lacks as unknown, and satisfies the contract", () => {
    const outOfOrder: EngagementContext = {
      schemaVersion: 1,
      fields: [
        { id: "constraints", state: "known", value: "none-known" },
        { id: "business", state: "known", value: "product-or-service" },
      ],
    };
    const snapshot = brief(outOfOrder).context;
    expect(snapshot?.fields.map((field) => field.id)).toEqual([...ENGAGEMENT_CONTEXT_FIELD_IDS]);
    expect(snapshot?.fields.filter((field) => field.state === "unknown")).toHaveLength(ENGAGEMENT_CONTEXT_FIELD_IDS.length - 2);
    expect(validateContext(JSON.parse(JSON.stringify(snapshot)))).toEqual([]);
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

  /*
   * `clossys/brief.json` is committed JSON in a product repository, so a
   * person can hand-edit it and snapshotContext()'s rules never ran on the
   * result. Each case below is a shape snapshotContext() would have
   * rejected; contextFromBrief() must read it as unknown rather than throw
   * or invent an answer.
   */
  describe("reads a hand-edited brief.context the same way snapshotContext() would have rejected", () => {
    it("reads a known entry with a value that is not one of the field's fixed choice ids as unknown", () => {
      const field = contextFromBrief({ context: { schemaVersion: 1, fields: [{ id: "audience", state: "known", value: "Mostly dentists near our office" }] } }).fields.find(
        (candidate) => candidate.id === "audience",
      );
      expect(field).toEqual({ id: "audience", state: "unknown" });
    });

    it("reads a known entry with no value as unknown", () => {
      const bad = { id: "audience", state: "known" } as unknown as EngagementContextField;
      const field = contextFromBrief({ context: { schemaVersion: 1, fields: [bad] } }).fields.find((candidate) => candidate.id === "audience");
      expect(field).toEqual({ id: "audience", state: "unknown" });
    });

    it("drops extra keys on an otherwise-valid known entry rather than copying them", () => {
      const withExtra = JSON.parse('{"id":"audience","state":"known","value":"businesses","note":"free text"}') as EngagementContextField;
      const field = contextFromBrief({ context: { schemaVersion: 1, fields: [withExtra] } }).fields.find((candidate) => candidate.id === "audience");
      expect(field).toEqual({ id: "audience", state: "known", value: "businesses" });
      expect(Object.keys(field ?? {})).toEqual(["id", "state", "value"]);
    });

    it("reads a duplicated id as unknown, keeping neither entry", () => {
      const duplicated: EngagementContext = {
        schemaVersion: 1,
        fields: [
          { id: "audience", state: "known", value: "businesses" },
          { id: "audience", state: "known", value: "consumers" },
        ],
      };
      const field = contextFromBrief({ context: duplicated }).fields.find((candidate) => candidate.id === "audience");
      expect(field).toEqual({ id: "audience", state: "unknown" });
    });

    it("reads every field as unknown when context.fields is not an array, instead of throwing", () => {
      const notAnArray = { context: { schemaVersion: 1, fields: "not-an-array" } } as unknown as Pick<EngagementBrief, "context">;
      expect(() => contextFromBrief(notAnArray)).not.toThrow();
      expect(contextFromBrief(notAnArray).fields.every((field) => field.state === "unknown")).toBe(true);
    });

    it("emits only {id, state, value} for every field, never an extra key from a malformed entry", () => {
      const messy: EngagementContext = {
        schemaVersion: 1,
        fields: [
          { id: "audience", state: "known", value: "businesses" },
          { id: "stage", state: "known" } as unknown as EngagementContextField,
        ],
      };
      for (const field of contextFromBrief({ context: messy }).fields) {
        expect(Object.keys(field)).toEqual(field.state === "known" ? ["id", "state", "value"] : ["id", "state"]);
      }
    });
  });
});
