/**
 * A small JSON Schema (draft 2020-12 subset) validator for the constitution schemas. It knows
 * exactly the keywords those schemas use: type, const, enum, pattern, minLength, minimum,
 * required, properties, additionalProperties, items, minItems, anyOf, oneOf, not and local `$ref`s
 * into `#/$defs`. An unknown keyword is a schema error, never silently ignored, so a schema can
 * not claim a rule this validator does not enforce.
 */
import { readFileSync } from "node:fs";

export type JsonSchema = { readonly [key: string]: unknown };

const KNOWN = new Set([
  "$schema", "$id", "$defs", "$ref", "$comment", "title", "description",
  "type", "const", "enum", "pattern", "minLength", "minimum", "required", "properties",
  "additionalProperties", "items", "minItems", "anyOf", "oneOf", "not",
]);

/** One validation failure: a JSON pointer into the instance and what is wrong there. */
export interface SchemaError { readonly at: string; readonly message: string }

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}
const typeMatches = (want: string, value: unknown): boolean => {
  const got = typeOf(value);
  return got === want || (want === "number" && got === "integer");
};
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const pointer = (at: string, key: string | number): string => `${at}/${String(key).replace(/~/g, "~0").replace(/\//g, "~1")}`;

/** Validates `value` against `schema`; `root` resolves `$ref`. Returns every failure, in instance order. */
export function validateSchema(schema: JsonSchema, value: unknown, root: JsonSchema = schema, at = ""): SchemaError[] {
  for (const key of Object.keys(schema)) if (!KNOWN.has(key)) throw new Error(`Unsupported schema keyword "${key}"`);
  const errors: SchemaError[] = [];
  const fail = (message: string, where = at) => { errors.push({ at: where || "/", message }); };
  if (typeof schema.$ref === "string") {
    const match = /^#\/\$defs\/([A-Za-z0-9_-]+)$/.exec(schema.$ref);
    const defs = root.$defs as Record<string, JsonSchema> | undefined;
    const target = match ? defs?.[match[1]!] : undefined;
    if (!target) throw new Error(`Unresolvable schema $ref "${schema.$ref}"`);
    errors.push(...validateSchema(target, value, root, at));
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type as string[] : [schema.type as string];
    if (!types.some(type => typeMatches(type, value))) { fail(`expected ${types.join(" or ")}, got ${typeOf(value)}`); return errors; }
  }
  if ("const" in schema && !same(schema.const, value)) fail(`must be ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some(option => same(option, value))) fail(`must be one of ${schema.enum.map(option => JSON.stringify(option)).join(", ")}`);
  if (typeof value === "string") {
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) fail(`does not match ${schema.pattern}`);
    if (typeof schema.minLength === "number" && [...value].length < schema.minLength) fail(`shorter than ${schema.minLength}`);
  }
  if (typeof value === "number" && typeof schema.minimum === "number" && value < schema.minimum) fail(`less than ${schema.minimum}`);
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) fail(`fewer than ${schema.minItems} items`);
    if (schema.items && typeof schema.items === "object") value.forEach((item, index) => errors.push(...validateSchema(schema.items as JsonSchema, item, root, pointer(at, index))));
  }
  if (typeOf(value) === "object") {
    const object = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const key of (schema.required ?? []) as string[]) if (!(key in object)) fail(`missing required key "${key}"`);
    for (const [key, item] of Object.entries(object)) {
      const sub = properties[key];
      if (sub) errors.push(...validateSchema(sub, item, root, pointer(at, key)));
      else if (schema.additionalProperties === false) fail(`unknown key "${key}"`, pointer(at, key));
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") errors.push(...validateSchema(schema.additionalProperties as JsonSchema, item, root, pointer(at, key)));
    }
  }
  for (const [keyword, need] of [["anyOf", (n: number) => n >= 1], ["oneOf", (n: number) => n === 1]] as const) {
    const branches = schema[keyword];
    if (!Array.isArray(branches)) continue;
    const results = (branches as JsonSchema[]).map(branch => validateSchema(branch, value, root, at));
    const passing = results.filter(result => result.length === 0).length;
    if (!need(passing)) {
      if (passing === 0 && results.length) {
        // Report the branch that came closest: the fewest failures.
        const closest = results.reduce((best, result) => (result.length < best.length ? result : best));
        errors.push(...closest);
      } else fail(`matches ${passing} branches of ${keyword}, expected exactly one`);
    }
  }
  if (schema.not && typeof schema.not === "object" && validateSchema(schema.not as JsonSchema, value, root, at).length === 0) fail("matches a shape the schema forbids (not)");
  return errors;
}

/** The constitution schema `name` (schemas/<name>.schema.json), read from the package source once. */
const cache = new Map<string, JsonSchema>();
export const SCHEMA_NAMES = ["slot", "pin", "candidate", "slot-request", "retire"] as const;
export type SchemaName = typeof SCHEMA_NAMES[number];
export function constitutionSchema(name: SchemaName): JsonSchema {
  let schema = cache.get(name);
  if (!schema) {
    // src/constitution and dist/constitution both resolve to the shipped source copy.
    schema = JSON.parse(readFileSync(new URL(`../../src/constitution/schemas/${name}.schema.json`, import.meta.url), "utf8")) as JsonSchema;
    cache.set(name, schema);
  }
  return schema;
}

/** Validates `value` against the named constitution schema. */
export function validateAgainst(name: SchemaName, value: unknown): SchemaError[] {
  return validateSchema(constitutionSchema(name), value);
}
