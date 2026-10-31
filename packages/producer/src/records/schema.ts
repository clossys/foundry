/**
 * A small, dependency-free validator for the JSON Schema subset the record
 * schemas use. The schemas in ./schemas.ts are the source of truth; this file
 * only interprets them, so a consumer agent can read the same schema documents
 * and get the same answer.
 *
 * Supported keywords: type, const, enum, pattern, minLength, minimum, maximum,
 * required, properties, additionalProperties (boolean or schema), items,
 * minItems, uniqueItems, propertyNames, $ref to "#/$defs/<name>", oneOf.
 * Anything else in a schema is a programming error and throws.
 */

export type JsonSchema = {
  readonly $id?: string;
  readonly $schema?: string;
  readonly $defs?: Readonly<Record<string, JsonSchema>>;
  readonly $ref?: string;
  readonly title?: string;
  readonly description?: string;
  readonly type?: JsonType | readonly JsonType[];
  readonly const?: unknown;
  readonly enum?: readonly unknown[];
  readonly pattern?: string;
  readonly minLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly additionalProperties?: boolean | JsonSchema;
  readonly propertyNames?: JsonSchema;
  readonly items?: JsonSchema;
  readonly minItems?: number;
  readonly uniqueItems?: boolean;
  readonly oneOf?: readonly JsonSchema[];
};

export type JsonType = "object" | "array" | "string" | "integer" | "number" | "boolean" | "null";

export type SchemaIssue = { readonly path: string; readonly message: string };

const KNOWN = new Set([
  "$id", "$schema", "$defs", "$ref", "title", "description", "type", "const", "enum", "pattern",
  "minLength", "minimum", "maximum", "required", "properties", "additionalProperties",
  "propertyNames", "items", "minItems", "uniqueItems", "oneOf",
]);

function typeOf(value: unknown): JsonType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "object") return "object";
  throw new Error(`not a JSON value: ${typeof value}`);
}

function typeMatches(actual: JsonType, expected: JsonType): boolean {
  return actual === expected || (expected === "number" && actual === "integer");
}

function resolveRef(root: JsonSchema, ref: string): JsonSchema {
  const match = /^#\/\$defs\/([A-Za-z0-9_-]+)$/.exec(ref);
  const target = match ? root.$defs?.[match[1]!] : undefined;
  if (!target) throw new Error(`unresolvable $ref ${ref}`);
  return target;
}

function child(path: string, key: string | number): string {
  return typeof key === "number" ? `${path}[${key}]` : `${path}.${key}`;
}

function check(root: JsonSchema, schema: JsonSchema, value: unknown, path: string, out: SchemaIssue[]): void {
  for (const key of Object.keys(schema)) if (!KNOWN.has(key)) throw new Error(`unsupported schema keyword "${key}" at ${path}`);
  if (schema.$ref) return check(root, resolveRef(root, schema.$ref), value, path, out);

  if (schema.oneOf) {
    const passing = schema.oneOf.filter((option) => {
      const trial: SchemaIssue[] = [];
      check(root, option, value, path, trial);
      return trial.length === 0;
    });
    if (passing.length !== 1) out.push({ path, message: `must match exactly one alternative (matched ${passing.length})` });
    return;
  }

  const actual = typeOf(value);
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type as JsonType];
    if (!allowed.some((t) => typeMatches(actual, t))) {
      out.push({ path, message: `must be ${allowed.join(" or ")}, got ${actual}` });
      return;
    }
  }
  if ("const" in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    out.push({ path, message: `must equal ${JSON.stringify(schema.const)}` });
  }
  if (schema.enum && !schema.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) {
    out.push({ path, message: `must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}` });
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) out.push({ path, message: `must have at least ${schema.minLength} character(s)` });
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) out.push({ path, message: `must match ${schema.pattern}` });
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) out.push({ path, message: `must be >= ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) out.push({ path, message: `must be <= ${schema.maximum}` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) out.push({ path, message: `must have at least ${schema.minItems} item(s)` });
    if (schema.uniqueItems) {
      const seen = new Set<string>();
      value.forEach((item, index) => {
        const key = JSON.stringify(item);
        if (seen.has(key)) out.push({ path: child(path, index), message: "duplicate item" });
        seen.add(key);
      });
    }
    if (schema.items) value.forEach((item, index) => check(root, schema.items!, item, child(path, index), out));
  }
  if (actual === "object") {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in record)) out.push({ path: child(path, key), message: "is required" });
    for (const [key, item] of Object.entries(record)) {
      if (schema.propertyNames) check(root, schema.propertyNames, key, `${path}{${key}}`, out);
      const declared = schema.properties?.[key];
      if (declared) check(root, declared, item, child(path, key), out);
      else if (schema.additionalProperties === false) out.push({ path: child(path, key), message: "is not allowed" });
      else if (typeof schema.additionalProperties === "object") check(root, schema.additionalProperties, item, child(path, key), out);
    }
  }
}

/** Validate a parsed JSON value against a schema; returns every issue, never throws on bad data. */
export function validateAgainst(schema: JsonSchema, value: unknown): SchemaIssue[] {
  const out: SchemaIssue[] = [];
  check(schema, schema, value, "$", out);
  return out;
}
