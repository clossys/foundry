/**
 * A minimal JSON Schema (draft-07) checker for this repository's shared
 * contracts (issue #1475): the plan record and the engagement brief, which
 * two packages validate against without either depending on the other.
 *
 * It implements exactly the keywords those contracts use, and throws on any
 * other keyword, or keyword form, it meets instead of half-checking it.
 * `assertImplementedContract()` walks a whole contract, so a test can prove
 * every subschema is implemented, visited by a value or not. Property
 * lookups use Object.hasOwn, so an inherited name (toString, constructor,
 * __proto__) is never mistaken for a declared or present property.
 *
 * Messages, paths and errors never echo text from the document under test
 * -- neither a value nor a key. A brief can carry founder text, a refusal
 * can end up in a log, and these messages are read by agents: a hostile
 * document can put prompt-injection text in a key name as easily as in a
 * value. A path names only fields the contract declares (schema text, not
 * document text) and array indices. A field the contract does not declare,
 * or a repeated key, is reported at the object that holds it, by the key's
 * 1-based position in that object ("key 3 of this object"), never by name.
 *
 * Every string, and every object key, must be well-formed Unicode: a lone
 * surrogate is refused whatever the contract says, because it has no UTF-8
 * encoding and so no canonical form. A document this checker accepts can
 * always be digested.
 *
 * `readContractDocument()` is the one way to turn a plan or brief FILE into
 * a value: it refuses bytes that are not valid UTF-8 and any object that
 * repeats a key, at any depth. `JSON.parse` alone would silently keep the
 * last of two duplicate keys, so a reviewer reading the file could see a
 * value that is not the one validated and digested.
 *
 * This file imports nothing. It is the one implementation: a package that
 * cannot import it carries a generated, byte-identical copy.
 */

export type ContractSchema = Readonly<Record<string, unknown>>;

/**
 * One place a value breaks its contract. `path` is `""` for the document
 * itself, else like `blockers[0].nextAction.who`: only names the contract
 * declares, and array indices. Neither `path` nor `message` ever carries
 * document text.
 */
export interface ContractViolation {
  readonly path: string;
  readonly message: string;
}

/** Resolves a file-level `$ref` (for example `engagement-context.json`) to that contract. Throws when it cannot. */
export type ContractLoader = (name: string) => ContractSchema;

const ANNOTATIONS = new Set(["$schema", "$id", "title", "description"]);
const IMPLEMENTED = new Set([
  "$ref", "type", "const", "enum", "required", "properties", "additionalProperties",
  "items", "minItems", "maxItems", "contains", "minLength", "pattern", "format", "oneOf", "allOf", "not", "definitions",
]);

/**
 * The `format` values this checker asserts (JSON Schema leaves `format`
 * optional to assert; these contracts require it). Both are ISO 8601 as
 * RFC 3339 profiles it, checked field by field rather than by shape alone:
 *
 * - `date`: `YYYY-MM-DD`, with month 01-12 and a day that exists in that
 *   month of that year (leap years included, so `2028-02-29` is a date and
 *   `2026-02-29` is not).
 * - `date-time`: a `date`, then `T`, then `hh:mm` with optional `:ss` and
 *   fraction, then `Z` or `+hh:mm` / `-hh:mm`; hours 00-23, minutes 00-59,
 *   seconds 00-59 (no leap second), offset hours 00-23 and offset minutes
 *   00-59.
 *
 * Either must also give a finite `Date.parse`, so a time that validates can
 * always be ordered.
 */
const FORMATS = new Set(["date", "date-time"]);
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2})))?$/;

function inRange(text: string | undefined, low: number, high: number): boolean {
  if (text === undefined) return true;
  const value = Number(text);
  return value >= low && value <= high;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function matchesFormat(format: string, value: string): boolean {
  const match = DATE_TIME.exec(value);
  if (match === null) return false;
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = match;
  const isDateTime = hour !== undefined;
  if (isDateTime !== (format === "date-time")) return false;
  if (!inRange(month, 1, 12)) return false;
  if (!inRange(day, 1, daysInMonth(Number(year), Number(month)))) return false;
  if (!inRange(hour, 0, 23) || !inRange(minute, 0, 59) || !inRange(second, 0, 59)) return false;
  if (!inRange(offsetHour, 0, 23) || !inRange(offsetMinute, 0, 59)) return false;
  return Number.isFinite(Date.parse(value));
}

/** Throws on any keyword, or keyword form, this checker does not implement -- for this node only. */
function assertImplementedNode(schema: ContractSchema, at: string): void {
  for (const key of Object.keys(schema)) {
    if (!ANNOTATIONS.has(key) && !IMPLEMENTED.has(key)) throw new Error(`contract checker does not implement "${key}" (at ${at})`);
  }
  if (Object.hasOwn(schema, "type") && typeof schema.type !== "string") throw new Error(`contract checker implements only a string "type" (at ${at})`);
  if (Object.hasOwn(schema, "additionalProperties") && typeof schema.additionalProperties !== "boolean") {
    throw new Error(`contract checker implements only a boolean "additionalProperties" (at ${at})`);
  }
  if (Object.hasOwn(schema, "items") && Array.isArray(schema.items)) throw new Error(`contract checker does not implement tuple "items" (at ${at})`);
  if (Object.hasOwn(schema, "format") && !FORMATS.has(schema.format as string)) {
    throw new Error(`contract checker does not implement format ${JSON.stringify(schema.format)} (at ${at})`);
  }
}

/** Walks every subschema of `schema`, visited by a value or not, and throws on the first keyword this checker does not implement. */
export function assertImplementedContract(schema: ContractSchema, at = "#"): void {
  assertImplementedNode(schema, at);
  for (const key of ["properties", "definitions"]) {
    for (const [name, child] of Object.entries((schema[key] ?? {}) as Record<string, ContractSchema>)) assertImplementedContract(child, `${at}/${key}/${name}`);
  }
  for (const key of ["items", "contains", "not"]) if (Object.hasOwn(schema, key)) assertImplementedContract(schema[key] as ContractSchema, `${at}/${key}`);
  for (const key of ["oneOf", "allOf"]) {
    (Array.isArray(schema[key]) ? (schema[key] as ContractSchema[]) : []).forEach((child, index) => assertImplementedContract(child, `${at}/${key}/${index}`));
  }
}

/** Whether an array has a hole: an index below its length with no own element. JSON never produces one. */
function hasHoles(value: readonly unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) return true;
  return false;
}

/**
 * The JSON type of a value. An array with holes (`[1, , 3]`, or one whose
 * length was set past its last element) is "sparse array", not "array": code
 * that walks it with forEach skips the holes while an indexed loop reads
 * undefined, so two readers could judge it differently. No JSON text
 * produces one, so a document read from a file is never affected.
 */
function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return hasHoles(value) ? "sparse array" : "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

/** With the `u` flag a surrogate pair is one code point, so this matches only a lone surrogate. */
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;
const NOT_WELL_FORMED = "must be well-formed Unicode, and contains a lone surrogate";

/**
 * The path of a field the contract declares: `path.name`, or `path["name"]`
 * for a name that is not identifier-like. `name` is always the contract's
 * own text (a `properties` or `required` entry), never a key read only
 * from the document: an undeclared key never reaches this function.
 */
function declaredPath(path: string, name: string): string {
  if (!/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(name)) return `${path}[${JSON.stringify(name)}]`;
  return path === "" ? name : `${path}.${name}`;
}

/**
 * Each object's keys in the order the file wrote them, for a value
 * `readContractDocument()` returned. A JavaScript object enumerates
 * array-index keys ("0", "7") first, whatever order they were written in,
 * so without this a key ordinal could differ from the file's.
 */
const WRITTEN_KEY_ORDER = new WeakMap<object, readonly string[]>();

/**
 * `record`'s keys in the order the checker visits them, which is also the
 * order their 1-based positions count in: as the file wrote them when
 * `record` came from `readContractDocument()` and still has exactly the keys
 * it was read with, else the object's own key order (JavaScript's, which
 * lists array-index keys such as "7" first). Linear in the number of keys.
 */
function keyOrder(record: object): readonly string[] {
  const own = Object.keys(record);
  const written = WRITTEN_KEY_ORDER.get(record);
  if (written !== undefined && written.length === own.length) {
    const writtenSet = new Set(written);
    if (own.every((key) => writtenSet.has(key))) return written;
  }
  return own;
}

const TYPE_NOUNS: Readonly<Record<string, string>> = {
  object: "an object", array: "an array", string: "a string", number: "a number", integer: "an integer", boolean: "a boolean", null: "null",
};

/**
 * What a value must be, for a type mismatch. A `title` that is already a
 * description ("a string with ...") is used as it is; one that names a
 * document ("Advisor plan") is added after the type: "an object (the
 * Advisor plan)".
 */
function describeType(type: string, title: unknown): string {
  if (typeof title !== "string") return TYPE_NOUNS[type] ?? `of type ${type}`;
  if (/^(a|an) /.test(title)) return title;
  return `${TYPE_NOUNS[type] ?? `of type ${type}`} (the ${title})`;
}

interface Scope {
  readonly root: ContractSchema;
  readonly load: ContractLoader;
}

function resolveRef(ref: string, scope: Scope, at: string): { schema: ContractSchema; scope: Scope } {
  const [file = "", pointer = ""] = ref.split("#");
  const docRoot = file === "" ? scope.root : scope.load(file);
  let target: unknown = docRoot;
  for (const segment of pointer.split("/").filter(Boolean)) {
    if (typeof target !== "object" || target === null || !Object.hasOwn(target, segment)) throw new Error(`unresolvable $ref ${ref} (at ${at})`);
    target = (target as Record<string, unknown>)[segment];
  }
  return { schema: target as ContractSchema, scope: { root: docRoot, load: scope.load } };
}

/** Follows `$ref` chains to the node that actually carries keywords. */
function dereference(schema: ContractSchema, scope: Scope, at: string): { schema: ContractSchema; scope: Scope } {
  let current = { schema, scope };
  while (typeof current.schema.$ref === "string") current = resolveRef(current.schema.$ref, current.scope, at);
  return current;
}

/** An undeclared field, by its 1-based position in its object -- never its name. */
function undeclaredFieldMessage(ordinal: number): string {
  return `has a field the contract does not declare (key ${ordinal} of this object), and unknown fields are refused`;
}

function check(input: ContractSchema, value: unknown, inputScope: Scope, path: string): ContractViolation[] {
  // Draft-07: $ref replaces every sibling keyword (siblings are annotations only).
  const { schema, scope } = dereference(input, inputScope, path);
  assertImplementedNode(schema, path);
  const kind = typeOf(value);
  const expected = schema.type;
  if (typeof expected === "string" && !(expected === kind || (expected === "number" && kind === "integer"))) {
    return [{ path, message: `must be ${describeType(expected, schema.title)}, got ${kind}` }];
  }
  // A schema node with no `type` still never accepts an array with holes.
  if (kind === "sparse array") return [{ path, message: "must not be an array with holes" }];
  const violations: ContractViolation[] = [];
  if (Object.hasOwn(schema, "const") && JSON.stringify(schema.const) !== JSON.stringify(value)) violations.push({ path, message: `must equal ${JSON.stringify(schema.const)}` });
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) {
    violations.push({ path, message: `must be one of: ${schema.enum.map((option) => JSON.stringify(option)).join(", ")}` });
  }
  if (typeof value === "string") {
    if (LONE_SURROGATE.test(value)) violations.push({ path, message: NOT_WELL_FORMED });
    if (typeof schema.minLength === "number" && value.length < schema.minLength) violations.push({ path, message: `must be at least ${schema.minLength} character(s) long` });
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) {
      violations.push({ path, message: typeof schema.title === "string" ? `must be ${schema.title}` : `must match the pattern ${schema.pattern}` });
    }
    if (typeof schema.format === "string" && !matchesFormat(schema.format, value)) {
      violations.push({ path, message: typeof schema.title === "string" ? `must be ${schema.title}` : `must be a valid ${schema.format}` });
    }
  }
  if (kind === "array") {
    const items = value as readonly unknown[];
    if (typeof schema.minItems === "number" && items.length < schema.minItems) violations.push({ path, message: `must have at least ${schema.minItems} item(s)` });
    if (typeof schema.maxItems === "number" && items.length > schema.maxItems) violations.push({ path, message: `must have at most ${schema.maxItems} item(s)` });
    if (schema.items !== undefined) items.forEach((item, index) => violations.push(...check(schema.items as ContractSchema, item, scope, `${path}[${index}]`)));
    if (schema.contains !== undefined && !items.some((item, index) => check(schema.contains as ContractSchema, item, scope, `${path}[${index}]`).length === 0)) {
      violations.push({ path, message: `must contain an item matching ${JSON.stringify(schema.contains)}` });
    }
  }
  if (kind === "object") {
    const record = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, ContractSchema>;
    for (const name of (schema.required ?? []) as string[]) {
      if (!Object.hasOwn(record, name)) violations.push({ path: declaredPath(path, name), message: "is required" });
    }
    keyOrder(record).forEach((name, index) => {
      const child = record[name];
      if (LONE_SURROGATE.test(name)) {
        // The key itself is never echoed (see the header), and this one cannot even be written as UTF-8.
        violations.push({ path, message: `has a key that ${NOT_WELL_FORMED}` });
        return;
      }
      if (Object.hasOwn(properties, name)) violations.push(...check(properties[name] as ContractSchema, child, scope, declaredPath(path, name)));
      // The key is document text, so it is never named: the violation is
      // placed at the object that holds it, with the key's position there.
      else if (schema.additionalProperties === false) violations.push({ path, message: undeclaredFieldMessage(index + 1) });
    });
  }
  if (Array.isArray(schema.oneOf)) violations.push(...checkOneOf(schema.oneOf as ContractSchema[], value, scope, path, schema.title));
  if (Array.isArray(schema.allOf)) for (const branch of schema.allOf as ContractSchema[]) violations.push(...check(branch, value, scope, path));
  if (schema.not !== undefined && check(schema.not as ContractSchema, value, scope, path).length === 0) violations.push({ path, message: `must not match ${JSON.stringify(schema.not)}` });
  return violations;
}

/**
 * Exactly one branch must pass. When none does, the violations of the one
 * closest branch are reported -- the branch whose `type` fits the value, or
 * failing that the unique branch with the fewest violations -- so a refusal
 * names the actual field at fault rather than only "no branch matched".
 * When no single branch is closest, the node's own `title` says what the
 * value must be, if it has one.
 */
function checkOneOf(branches: readonly ContractSchema[], value: unknown, scope: Scope, path: string, title: unknown): ContractViolation[] {
  const results = branches.map((branch) => check(branch, value, scope, path));
  const passing = results.filter((result) => result.length === 0).length;
  if (passing === 1) return [];
  if (passing > 1) return [{ path, message: `matches ${passing} of the ${branches.length} allowed forms, and must match exactly one` }];
  const kind = typeOf(value);
  const typed = branches
    .map((branch, index) => ({ index, type: dereference(branch, scope, path).schema.type }))
    .filter((entry) => entry.type === kind || (entry.type === "number" && kind === "integer"));
  if (typed.length === 1) return results[typed[0]!.index]!;
  const fewest = Math.min(...results.map((result) => result.length));
  const closest = results.filter((result) => result.length === fewest);
  if (closest.length === 1) return closest[0]!;
  if (typeof title === "string") return [{ path, message: `must be ${title}` }];
  return [{ path, message: `does not match any of the ${branches.length} allowed forms` }];
}

/**
 * Every violation of `value` against `contract`; empty when it conforms. A
 * type mismatch stops there and returns alone, since every other keyword
 * assumes the value is already the right type. Otherwise, on an object, any
 * `const` or `enum` violation of the object itself comes before a missing
 * required field, which comes before each present key's violations in the
 * order the keys were written (see `keyOrder()`), then any from `oneOf`,
 * `allOf` and `not`. Never throws for a bad value. Throws only when the
 * contract itself uses a keyword this checker does not implement, or a
 * `$ref` it cannot resolve -- a defect in the contract, not in the value.
 */
export function validateAgainstContract(contract: ContractSchema, value: unknown, load: ContractLoader): ContractViolation[] {
  return check(contract, value, { root: contract, load }, "");
}

/** `label.path message` (for example `plan.blockers[0].capabilityId is required`), or `label message` for the document itself. */
export function formatContractViolation(label: string, violation: ContractViolation): string {
  const where = violation.path === "" ? label : violation.path.startsWith("[") ? `${label}${violation.path}` : `${label}.${violation.path}`;
  return `${where} ${violation.message}`;
}

// ignoreBOM keeps a leading byte order mark in the text, so it is refused below rather than silently stripped.
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const JSON_WHITESPACE = " \t\n\r";
const JSON_NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const JSON_ESCAPE = /\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})/y;

/**
 * Why `readContractDocument()` refused a file, as data a caller can act on
 * without parsing the message: `reason` says which rule failed, and
 * `position` (never file text) is set only for a syntax error or a leading
 * byte order mark. The message carries no file text either: a repeated key
 * is named by its 1-based position in its object, and that object as the
 * top-level object or by its position, never by any key.
 *
 * A position, here and in every message, is a 0-based index into the
 * decoded text in UTF-16 code units: JavaScript's string index. It equals
 * the byte offset only for ASCII text; a character outside the Basic
 * Multilingual Plane (an emoji, say) counts as two.
 */
export class ContractDocumentError extends Error {
  constructor(
    message: string,
    readonly reason: "encoding" | "syntax" | "repeated-key",
    readonly position?: number,
  ) {
    super(message);
  }
}

/**
 * Checks that `text` is exactly one JSON value (RFC 8259 grammar) with no
 * object that repeats a key, at any depth. Keys are compared after
 * unescaping, so `"a"` and `"\u0061"` are the same key. Every refusal is
 * by position only, never with a snippet of the text or a key, because a
 * plan or brief can carry founder prose and a key can carry anything.
 *
 * Returns every object's keys in the order written, one list per object in
 * document (pre-)order, for `recordWrittenKeyOrder()`.
 */
function checkStrictJson(text: string): string[][] {
  const keyOrders: string[][] = [];
  let index = 0;
  const syntaxError = (): never => {
    throw new ContractDocumentError(`is not valid JSON at position ${index}`, "syntax", index);
  };
  const skipWhitespace = () => {
    while (index < text.length && JSON_WHITESPACE.includes(text[index]!)) index += 1;
  };
  const expect = (character: string) => {
    if (text[index] !== character) syntaxError();
    index += 1;
  };
  const readString = (): string => {
    const start = index;
    expect('"');
    for (;;) {
      if (index >= text.length) syntaxError();
      const unit = text.charCodeAt(index);
      if (unit === 0x22) break;
      if (unit < 0x20) syntaxError();
      if (unit === 0x5c) {
        JSON_ESCAPE.lastIndex = index;
        if (!JSON_ESCAPE.test(text)) syntaxError();
        index = JSON_ESCAPE.lastIndex;
      } else {
        index += 1;
      }
    }
    index += 1;
    return JSON.parse(text.slice(start, index)) as string;
  };
  const scan = (topLevel: boolean): void => {
    skipWhitespace();
    const opening = text[index];
    if (opening === "{" || opening === "[") {
      const closing = opening === "{" ? "}" : "]";
      const where = topLevel ? "the top-level object" : `the object at position ${index}`;
      const keys: string[] = [];
      if (opening === "{") keyOrders.push(keys);
      const seen = new Set<string>();
      index += 1;
      skipWhitespace();
      if (text[index] === closing) {
        index += 1;
        return;
      }
      for (;;) {
        if (opening === "{") {
          skipWhitespace();
          const key = readString();
          keys.push(key);
          if (seen.has(key)) {
            // Never the key itself: it is document text, and may be written to be read as an instruction.
            throw new ContractDocumentError(`repeats a key (key ${keys.length} of ${where}); every key may appear once`, "repeated-key");
          }
          seen.add(key);
          skipWhitespace();
          expect(":");
        }
        scan(false);
        skipWhitespace();
        if (text[index] === ",") {
          index += 1;
          continue;
        }
        expect(closing);
        return;
      }
    }
    if (opening === '"') {
      readString();
      return;
    }
    for (const literal of ["true", "false", "null"]) {
      if (text.startsWith(literal, index)) {
        index += literal.length;
        return;
      }
    }
    JSON_NUMBER.lastIndex = index;
    if (!JSON_NUMBER.test(text)) syntaxError();
    index = JSON_NUMBER.lastIndex;
  };
  scan(true);
  skipWhitespace();
  if (index !== text.length) syntaxError();
  return keyOrders;
}

/**
 * Records, for each object in `value`, the key order `checkStrictJson()`
 * read for it. `keyOrders` lists objects in document order, which is the
 * order this walk meets them in: each object, then its members in the order
 * written. Keys are unique (a repeat was already refused), so each names
 * exactly one own property; `value[key]` reads an own `__proto__` too,
 * because JSON.parse defines it as an own property that shadows the
 * inherited accessor.
 */
function recordWrittenKeyOrder(value: unknown, keyOrders: readonly string[][], next: { index: number }): void {
  if (typeof value !== "object" || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) recordWrittenKeyOrder(item, keyOrders, next);
    return;
  }
  const keys = keyOrders[next.index]!;
  next.index += 1;
  WRITTEN_KEY_ORDER.set(value, keys);
  for (const key of keys) recordWrittenKeyOrder((value as Record<string, unknown>)[key], keyOrders, next);
}

/**
 * Reads a plan or brief file's bytes as strict JSON: UTF-8 that decodes
 * without error (never silently replaced with U+FFFD) and does not start
 * with a byte order mark, exactly one JSON value, and no object that repeats a key at any depth -- the I-JSON rules
 * RFC 8785 canonicalization assumes. Refuses bytes that break a rule with a
 * ContractDocumentError whose message says which rule, by position only: a
 * syntax error by its position (a UTF-16 code-unit index, see
 * ContractDocumentError), a repeated key by its 1-based position in its
 * object and that object's position (or "the top-level object") -- never
 * any text from the file. It does not validate the value against a contract; call
 * `validateAgainstContract()` next, which then numbers an undeclared field
 * by its position as written in the file.
 */
export function readContractDocument(bytes: Uint8Array): unknown {
  let text: string;
  try {
    text = STRICT_UTF8.decode(bytes);
  } catch {
    throw new ContractDocumentError("is not valid UTF-8", "encoding");
  }
  if (text.charCodeAt(0) === 0xfeff) throw new ContractDocumentError("is not valid JSON at position 0: it starts with a byte order mark, which strict JSON refuses", "syntax", 0);
  const keyOrders = checkStrictJson(text);
  const value = JSON.parse(text) as unknown;
  recordWrittenKeyOrder(value, keyOrders, { index: 0 });
  return value;
}
