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

// ---------------------------------------------------------------------------
// Record headers (system.md 4): where the `clossys` header lives in each file kind.
// ---------------------------------------------------------------------------

/**
 * Returns the record header of one committed file, ready for validateAgainst:
 * - `.json`: the whole document when it has a top-level `schema` (slot, pin,
 *   pin-map, check result, queue/ledger entry, ia, facts), else its `clossys` key
 *   (a JSON candidate);
 * - `.md`: the `clossys` key of the YAML front matter;
 * - `.svg`: the `clossys` key of the JSON inside `<metadata>`.
 * Throws when the file has no header.
 */
export function readRecordHeader(fileName: string, text: string): unknown {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".json")) {
    const doc = JSON.parse(text) as unknown;
    if (isObject(doc) && "schema" in doc) return doc;
    if (isObject(doc) && "clossys" in doc) return doc.clossys;
    throw new Error(`${fileName}: no clossys header (no top-level schema or clossys key)`);
  }
  if (lower.endsWith(".md")) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text);
    if (!match) throw new Error(`${fileName}: no YAML front matter`);
    const front = parseYamlSubset(match[1] ?? "");
    if (isObject(front) && "clossys" in front) return front.clossys;
    throw new Error(`${fileName}: no clossys header in the front matter`);
  }
  if (lower.endsWith(".svg")) {
    const match = /<metadata[^>]*>([\s\S]*?)<\/metadata>/.exec(text);
    if (!match) throw new Error(`${fileName}: no <metadata> element`);
    const doc = JSON.parse(match[1] ?? "") as unknown;
    if (isObject(doc) && "clossys" in doc) return doc.clossys;
    throw new Error(`${fileName}: no clossys header in <metadata>`);
  }
  throw new Error(`${fileName}: unsupported record file kind`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type YamlLine = { readonly indent: number; readonly text: string; readonly no: number };

/**
 * The YAML subset record front matter uses: block mappings and sequences by
 * indentation, `- key: value` sequence items, flow `{}` and `[]`, single and
 * double quoted strings, plain scalars (core-schema numbers, true/false/null;
 * everything else, timestamps included, stays a string) and ` #` comments.
 * Anchors, tags, multi-document streams and block scalars (| >) throw.
 */
export function parseYamlSubset(source: string): unknown {
  const lines: YamlLine[] = [];
  source.split(/\r?\n/).forEach((raw, index) => {
    const text = stripComment(raw).trimEnd();
    if (text.trim() === "") return;
    if (/\t/.test(raw.slice(0, raw.length - raw.trimStart().length))) throw yamlError(index + 1, "tab indentation");
    lines.push({ indent: raw.length - raw.trimStart().length, text: text.trimStart(), no: index + 1 });
  });
  if (lines.length === 0) return null;
  const [value, next] = parseBlock(lines, 0, lines[0]!.indent);
  if (next < lines.length) throw yamlError(lines[next]!.no, "unexpected indentation");
  return value;
}

function yamlError(line: number, message: string): Error {
  return new Error(`front matter line ${line}: ${message}`);
}

/** Drops a ` #` comment that is outside quotes. */
function stripComment(raw: string): string {
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      if (ch === "\\" && quote === '"') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      if (i === 0 || /[\s:[{,-]/.test(raw[i - 1] ?? "")) quote = ch;
    } else if (ch === "#" && (i === 0 || /\s/.test(raw[i - 1] ?? ""))) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

const isSeqItem = (text: string): boolean => text === "-" || text.startsWith("- ");
/** `key:` or `key: value` with a plain or quoted key, outside flow syntax. */
const BLOCK_KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'{[\]},#&*!|>%@`-][^:]*?|-[^\s:][^:]*?)\s*:(?:\s+|$)/;

function parseBlock(lines: YamlLine[], start: number, indent: number): [unknown, number] {
  const first = lines[start]!;
  if (first.indent !== indent) throw yamlError(first.no, "unexpected indentation");
  return isSeqItem(first.text) ? parseSeq(lines, start, indent) : parseMap(lines, start, indent);
}

function parseMap(lines: YamlLine[], start: number, indent: number, firstText?: string): [Record<string, unknown>, number] {
  const out: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    const text = i === start && firstText !== undefined ? firstText : line.text;
    if (i !== start || firstText === undefined) {
      if (line.indent < indent) break;
      if (line.indent > indent) throw yamlError(line.no, "unexpected indentation");
      if (isSeqItem(text)) break;
    }
    const match = BLOCK_KEY.exec(text);
    if (!match) throw yamlError(line.no, "expected `key: value`");
    const key = unquoteKey(match[1]!, line.no);
    if (Object.prototype.hasOwnProperty.call(out, key)) throw yamlError(line.no, `duplicate key ${key}`);
    const rest = text.slice(match[0].length);
    i += 1;
    if (rest !== "") {
      out[key] = parseInline(rest, line.no);
      continue;
    }
    const next = lines[i];
    if (next && next.indent > indent) {
      const [value, after] = parseBlock(lines, i, next.indent);
      out[key] = value;
      i = after;
    } else if (next && next.indent === indent && isSeqItem(next.text)) {
      const [value, after] = parseSeq(lines, i, indent);
      out[key] = value;
      i = after;
    } else {
      out[key] = null;
    }
  }
  return [out, i];
}

function parseSeq(lines: YamlLine[], start: number, indent: number): [unknown[], number] {
  const out: unknown[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.indent < indent) break;
    if (line.indent > indent) throw yamlError(line.no, "unexpected indentation");
    if (!isSeqItem(line.text)) break;
    const rest = line.text === "-" ? "" : line.text.slice(2).trimStart();
    const itemIndent = indent + (line.text.length - rest.length);
    if (rest === "") {
      const next = lines[i + 1];
      if (next && next.indent > indent) {
        const [value, after] = parseBlock(lines, i + 1, next.indent);
        out.push(value);
        i = after;
      } else {
        out.push(null);
        i += 1;
      }
    } else if (!/^[{["']/.test(rest) && BLOCK_KEY.test(rest)) {
      const [value, after] = parseMap(lines, i, itemIndent, rest);
      out.push(value);
      i = after;
    } else {
      out.push(parseInline(rest, line.no));
      i += 1;
    }
  }
  return [out, i];
}

function unquoteKey(raw: string, no: number): string {
  if (raw.startsWith('"') || raw.startsWith("'")) {
    const value = parseInline(raw, no);
    if (typeof value !== "string") throw yamlError(no, "bad key");
    return value;
  }
  return raw.trim();
}

function parseInline(text: string, no: number): unknown {
  const reader = { text, pos: 0, no };
  const value = readFlowValue(reader, false);
  skipSpace(reader);
  if (reader.pos < text.length) throw yamlError(no, `unexpected ${JSON.stringify(text.slice(reader.pos))}`);
  return value;
}

type FlowReader = { readonly text: string; pos: number; readonly no: number };

function skipSpace(r: FlowReader): void {
  while (r.pos < r.text.length && /\s/.test(r.text[r.pos]!)) r.pos += 1;
}

function readFlowValue(r: FlowReader, inFlow: boolean): unknown {
  skipSpace(r);
  const ch = r.text[r.pos];
  if (ch === "{") return readFlowMap(r);
  if (ch === "[") return readFlowSeq(r);
  if (ch === '"' || ch === "'") return readQuoted(r);
  if (ch !== undefined && /[&*!|>%@`]/.test(ch)) throw yamlError(r.no, `unsupported YAML syntax ${ch}`);
  return plainScalar(readPlain(r, inFlow, false));
}

function readPlain(r: FlowReader, inFlow: boolean, isKey: boolean): string {
  const start = r.pos;
  while (r.pos < r.text.length) {
    const ch = r.text[r.pos]!;
    if (inFlow && (ch === "," || ch === "]" || ch === "}")) break;
    if (isKey && ch === ":" && (r.pos + 1 === r.text.length || /[\s,}\]]/.test(r.text[r.pos + 1]!))) break;
    r.pos += 1;
  }
  return r.text.slice(start, r.pos).trim();
}

function readQuoted(r: FlowReader): string {
  const quote = r.text[r.pos]!;
  let i = r.pos + 1;
  if (quote === '"') {
    while (i < r.text.length && r.text[i] !== '"') i += r.text[i] === "\\" ? 2 : 1;
    if (i >= r.text.length) throw yamlError(r.no, "unterminated string");
    const value = JSON.parse(r.text.slice(r.pos, i + 1)) as string;
    r.pos = i + 1;
    return value;
  }
  let out = "";
  for (;;) {
    if (i >= r.text.length) throw yamlError(r.no, "unterminated string");
    if (r.text[i] === "'") {
      if (r.text[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      r.pos = i + 1;
      return out;
    }
    out += r.text[i];
    i += 1;
  }
}

function readFlowMap(r: FlowReader): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  r.pos += 1;
  skipSpace(r);
  if (r.text[r.pos] === "}") {
    r.pos += 1;
    return out;
  }
  for (;;) {
    skipSpace(r);
    const ch = r.text[r.pos];
    const key = ch === '"' || ch === "'" ? readQuoted(r) : readPlain(r, true, true);
    skipSpace(r);
    if (r.text[r.pos] !== ":") throw yamlError(r.no, `expected ":" after ${key}`);
    r.pos += 1;
    if (Object.prototype.hasOwnProperty.call(out, key)) throw yamlError(r.no, `duplicate key ${key}`);
    out[key] = readFlowValue(r, true);
    skipSpace(r);
    const sep = r.text[r.pos];
    r.pos += 1;
    if (sep === "}") return out;
    if (sep !== ",") throw yamlError(r.no, "expected , or }");
  }
}

function readFlowSeq(r: FlowReader): unknown[] {
  const out: unknown[] = [];
  r.pos += 1;
  skipSpace(r);
  if (r.text[r.pos] === "]") {
    r.pos += 1;
    return out;
  }
  for (;;) {
    out.push(readFlowValue(r, true));
    skipSpace(r);
    const sep = r.text[r.pos];
    r.pos += 1;
    if (sep === "]") return out;
    if (sep !== ",") throw yamlError(r.no, "expected , or ]");
  }
}

const YAML_INT = /^[-+]?(0|[1-9][0-9]*)$/;
const YAML_FLOAT = /^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/;

function plainScalar(text: string): unknown {
  if (text === "" || text === "~" || text === "null" || text === "Null" || text === "NULL") return null;
  if (/^(true|True|TRUE)$/.test(text)) return true;
  if (/^(false|False|FALSE)$/.test(text)) return false;
  if (YAML_INT.test(text) || YAML_FLOAT.test(text)) return Number(text);
  return text;
}
