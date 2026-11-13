import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../records/slot-model/frontmatter.js";
import { PACKAGE_ROOT } from "./options.js";

/**
 * Per-port JSON schemas live in pipeline/schemas/<name>.schema.json. This validator covers the
 * subset those files use: type, const, enum, pattern, minLength, minItems, minimum, items, properties,
 * required, additionalProperties, propertyNames, anyOf, oneOf, not and $ref (to a sibling file
 * or to #/$defs/<name>).
 *
 * `x-format` names how a file is read before validation: absent, a `.json` file is parsed as JSON and
 * a `.md` file by its frontmatter; `text` validates the raw file text as a string (generated `.ts` and
 * `.css` modules); `scalar-frontmatter` reads a `.md` file's plain `key: value` frontmatter lines as
 * strings (Director evidence); `binary` (an opaque file) and `directory` (a tree a caller names) have no readable
 * contract beyond their path.
 */
export interface JsonSchema {
  $ref?: string; $defs?: Record<string, JsonSchema>;
  type?: string | string[]; const?: unknown; enum?: unknown[]; pattern?: string; minLength?: number; minItems?: number; minimum?: number;
  items?: JsonSchema; properties?: Record<string, JsonSchema>; required?: string[];
  additionalProperties?: boolean | JsonSchema; propertyNames?: JsonSchema;
  anyOf?: JsonSchema[]; oneOf?: JsonSchema[]; not?: JsonSchema;
  [key: string]: unknown;
}
export interface SchemaIssue { readonly path: string; readonly message: string }

export const SCHEMA_DIR = "pipeline/schemas";
const cache = new Map<string, JsonSchema>();

export function schemaFile(name: string, packageRoot = PACKAGE_ROOT): string { return join(packageRoot, SCHEMA_DIR, `${name}.schema.json`); }
export function hasSchema(name: string, packageRoot = PACKAGE_ROOT): boolean { return existsSync(schemaFile(name, packageRoot)); }

export function loadSchema(name: string, packageRoot = PACKAGE_ROOT): JsonSchema {
  const file = schemaFile(name, packageRoot);
  let schema = cache.get(file);
  if (!schema) { schema = JSON.parse(readFileSync(file, "utf8")) as JsonSchema; cache.set(file, schema); }
  return schema;
}

const typeOf = (value: unknown): string => value === null ? "null" : Array.isArray(value) ? "array"
  : typeof value === "number" ? (Number.isInteger(value) ? "integer" : "number") : typeof value;
const typeMatches = (want: string, value: unknown) => {
  const got = typeOf(value);
  return want === got || (want === "number" && got === "integer");
};

export function validateValue(value: unknown, schema: JsonSchema, packageRoot = PACKAGE_ROOT): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const visit = (node: unknown, s: JsonSchema, root: JsonSchema, at: string) => {
    if (s.$ref) {
      if (s.$ref.startsWith("#/$defs/")) { const def = root.$defs?.[s.$ref.slice(8)]; if (!def) issues.push({ path: at, message: `unknown $ref ${s.$ref}` }); else visit(node, def, root, at); }
      else { const ref = loadSchema(s.$ref.replace(/\.schema\.json$/, ""), packageRoot); visit(node, ref, ref, at); }
      return;
    }
    const push = (message: string) => issues.push({ path: at || "/", message });
    if (s.type !== undefined) {
      const types = [s.type].flat();
      if (!types.some(type => typeMatches(type, node))) { push(`must be ${types.join(" or ")}`); return; }
    }
    if (Object.hasOwn(s, "const") && JSON.stringify(node) !== JSON.stringify(s.const)) push(`must be ${JSON.stringify(s.const)}`);
    if (s.enum && !s.enum.some(option => JSON.stringify(option) === JSON.stringify(node))) push(`must be one of ${s.enum.map(option => JSON.stringify(option)).join(", ")}`);
    if (typeof node === "string") {
      if (s.pattern !== undefined && !new RegExp(s.pattern).test(node)) push(`must match ${s.pattern}`);
      if (s.minLength !== undefined && node.length < s.minLength) push(`must have at least ${s.minLength} characters`);
    }
    if (typeof node === "number" && s.minimum !== undefined && node < s.minimum) push(`must be at least ${s.minimum}`);
    if (Array.isArray(node)) {
      if (s.minItems !== undefined && node.length < s.minItems) push(`must have at least ${s.minItems} items`);
      if (s.items) node.forEach((item, index) => visit(item, s.items!, root, `${at}/${index}`));
    }
    if (typeOf(node) === "object") {
      const record = node as Record<string, unknown>;
      for (const key of s.required ?? []) if (!Object.hasOwn(record, key)) push(`requires ${key}`);
      for (const [key, child] of Object.entries(record)) {
        const property = s.properties?.[key];
        if (s.propertyNames) visit(key, s.propertyNames, root, `${at}/${key} (name)`);
        if (property) visit(child, property, root, `${at}/${key}`);
        else if (s.additionalProperties === false) push(`has unknown key ${key}`);
        else if (typeof s.additionalProperties === "object") visit(child, s.additionalProperties, root, `${at}/${key}`);
      }
    }
    const passes = (branch: JsonSchema) => validateValueAt(node, branch, root, packageRoot).length === 0;
    if (s.anyOf && !s.anyOf.some(passes)) push("matches none of anyOf");
    if (s.oneOf && s.oneOf.filter(passes).length !== 1) push("must match exactly one of oneOf");
    if (s.not && passes(s.not)) push("matches a forbidden shape (not)");
  };
  visit(value, schema, schema, "");
  return issues;
}

function validateValueAt(value: unknown, schema: JsonSchema, root: JsonSchema, packageRoot: string): SchemaIssue[] {
  return validateValue(value, { ...schema, $defs: { ...root.$defs, ...schema.$defs } }, packageRoot);
}

/** Validate one committed file: JSON files as JSON, Markdown candidates by their frontmatter, `x-format` text as text. */
export function validateFile(schemaName: string, file: string, bytes: string, packageRoot = PACKAGE_ROOT): SchemaIssue[] {
  const schema = loadSchema(schemaName, packageRoot);
  let value: unknown;
  if (schema["x-format"] === "binary" || schema["x-format"] === "directory") return [];
  if (schema["x-format"] === "text") value = bytes;
  else if (schema["x-format"] === "scalar-frontmatter") {
    const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(bytes);
    if (!block) return [{ path: "/", message: "frontmatter: no --- block at the top of the file" }];
    const fields: Record<string, string> = {};
    for (const line of block[1]!.split(/\r?\n/)) {
      const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
      if (match) fields[match[1]!] = match[2]!.trim();
    }
    value = fields;
  } else if (file.endsWith(".md")) {
    const parsed = parseFrontmatter(bytes);
    if (!parsed.ok) return [{ path: "/", message: `frontmatter: ${parsed.message}` }];
    value = parsed.value.fields;
  } else if (file.endsWith(".json")) {
    try { value = JSON.parse(bytes); } catch { return [{ path: "/", message: "not JSON" }]; }
  } else return [{ path: "/", message: `no schema reader for ${file}` }];
  return validateValue(value, schema, packageRoot);
}
