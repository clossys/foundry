// A JSON-pointer edit that keeps the file's indent, key order, and final
// newline (RFC apply-approved-plan, the keyed writes in section 4.3 and the
// declare-root-entry edit in D27). package.json keys and a Controller
// profile's rootEntries go through this one editor. After the edit, the
// text is parsed and rendered again; the two renders are compared byte for
// byte, and a difference is refused rather than written.
//
// This module is pure: it reads no file, clock, network, or process.

/** One JSON-pointer edit. `remove` deletes the value the pointer addresses; otherwise `value` is written there. */
export interface JsonPointerEdit {
  readonly pointer: string;
  readonly value?: unknown;
  readonly remove?: boolean;
}

interface JsonStyle {
  readonly indent: string;
  readonly newline: string;
  readonly finalNewline: boolean;
  /** The characters between `:` and the value. A pretty file uses one space; a minified file uses none. */
  readonly colon: string;
}

/** What `valueAtJsonPointer` found. `found` is false when any token along the pointer is absent. */
export interface JsonPointerValue {
  readonly found: boolean;
  readonly value: unknown;
}

/** Thrown when an edit would rewrite bytes outside the edited tokens. */
export class JsonEditUnstableError extends TypeError {
  constructor() {
    super("a json pointer edit did not preserve unchanged bytes");
  }
}

function decodeToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function tokensOf(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new TypeError("a json pointer does not start with /");
  return pointer.split("/").slice(1).map(decodeToken);
}

function encodeToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

function pointerFromTokens(tokens: readonly string[]): string {
  if (tokens.length === 0) return "";
  return `/${tokens.map(encodeToken).join("/")}`;
}

type ValueSpan = { readonly start: number; readonly end: number };

type ObjectEntry = { readonly key: string; readonly keyRaw: string; readonly valuePointer: string };

function skipWs(text: string, index: number): number {
  while (index < text.length && /\s/u.test(text[index]!)) index += 1;
  return index;
}

function parseString(text: string, index: number): { end: number; value: string } {
  if (text[index] !== '"') throw new TypeError("a json pointer edit was given text that is not JSON");
  index += 1;
  let value = "";
  while (index < text.length) {
    const ch = text[index]!;
    if (ch === '"') return { end: index + 1, value };
    if (ch === "\\") {
      index += 1;
      if (index >= text.length) throw new TypeError("a json pointer edit was given text that is not JSON");
      value += text[index]!;
      index += 1;
      continue;
    }
    value += ch;
    index += 1;
  }
  throw new TypeError("a json pointer edit was given text that is not JSON");
}

function parseLiteral(text: string, index: number): { end: number; value: unknown } {
  const start = index;
  if (text.startsWith("true", index)) return { end: index + 4, value: true };
  if (text.startsWith("false", index)) return { end: index + 5, value: false };
  if (text.startsWith("null", index)) return { end: index + 4, value: null };
  if (text[index] === "-") index += 1;
  while (index < text.length && /[0-9.eE+-]/u.test(text[index]!)) index += 1;
  if (index === start || (text[start] === "-" && index === start + 1)) {
    throw new TypeError("a json pointer edit was given text that is not JSON");
  }
  const slice = text.slice(start, index);
  const value = JSON.parse(slice) as unknown;
  return { end: index, value };
}

function assertStableObjectKey(keyRaw: string, key: string): void {
  if (keyRaw !== JSON.stringify(key)) throw new JsonEditUnstableError();
}

function indexJsonSpans(text: string): { value: unknown; spans: Map<string, ValueSpan>; objectEntries: Map<string, readonly ObjectEntry[]> } {
  const spans = new Map<string, ValueSpan>();
  const objectEntries = new Map<string, readonly ObjectEntry[]>();
  function parseValue(index: number, pointer: string): { end: number; value: unknown } {
    index = skipWs(text, index);
    const start = index;
    const ch = text[index];
    if (ch === '"') {
      const parsed = parseString(text, index);
      spans.set(pointer, { start, end: parsed.end });
      return { end: parsed.end, value: parsed.value };
    }
    if (ch === "{") {
      index += 1;
      const record: Record<string, unknown> = {};
      index = skipWs(text, index);
      if (text[index] === "}") {
        spans.set(pointer, { start, end: index + 1 });
        objectEntries.set(pointer, []);
        return { end: index + 1, value: record };
      }
      const entries: ObjectEntry[] = [];
      while (index < text.length) {
        index = skipWs(text, index);
        const keyStart = index;
        const keyParsed = parseString(text, index);
        assertStableObjectKey(text.slice(keyStart, keyParsed.end), keyParsed.value);
        if (Object.hasOwn(record, keyParsed.value)) throw new JsonEditUnstableError();
        index = keyParsed.end;
        index = skipWs(text, index);
        if (text[index] !== ":") throw new TypeError("a json pointer edit was given text that is not JSON");
        index += 1;
        const valuePointer = pointerFromTokens([...tokensOf(pointer), keyParsed.value]);
        const child = parseValue(index, valuePointer);
        index = child.end;
        entries.push({ key: keyParsed.value, keyRaw: text.slice(keyStart, keyParsed.end), valuePointer });
        record[keyParsed.value] = child.value;
        index = skipWs(text, index);
        if (text[index] === ",") {
          index += 1;
          continue;
        }
        if (text[index] === "}") {
          spans.set(pointer, { start, end: index + 1 });
          objectEntries.set(pointer, entries);
          return { end: index + 1, value: record };
        }
        throw new TypeError("a json pointer edit was given text that is not JSON");
      }
      throw new TypeError("a json pointer edit was given text that is not JSON");
    }
    if (ch === "[") {
      index += 1;
      const array: unknown[] = [];
      index = skipWs(text, index);
      if (text[index] === "]") {
        spans.set(pointer, { start, end: index + 1 });
        return { end: index + 1, value: array };
      }
      let position = 0;
      while (index < text.length) {
        const child = parseValue(index, pointerFromTokens([...tokensOf(pointer), String(position)]));
        index = child.end;
        array.push(child.value);
        position += 1;
        index = skipWs(text, index);
        if (text[index] === ",") {
          index += 1;
          continue;
        }
        if (text[index] === "]") {
          spans.set(pointer, { start, end: index + 1 });
          return { end: index + 1, value: array };
        }
        throw new TypeError("a json pointer edit was given text that is not JSON");
      }
      throw new TypeError("a json pointer edit was given text that is not JSON");
    }
    const literal = parseLiteral(text, index);
    spans.set(pointer, { start, end: literal.end });
    return { end: literal.end, value: literal.value };
  }
  const parsed = parseValue(0, "");
  if (skipWs(text, parsed.end) !== text.length) throw new TypeError("a json pointer edit was given text that is not JSON");
  return { value: parsed.value, spans, objectEntries };
}

function editTargets(edits: readonly JsonPointerEdit[]): Set<string> {
  const targets = new Set<string>();
  for (const edit of edits) {
    const tokens = tokensOf(edit.pointer);
    if (tokens.length === 0) {
      targets.add("");
      continue;
    }
    const last = tokens[tokens.length - 1]!;
    if (last === "-") targets.add(pointerFromTokens(tokens.slice(0, -1)));
    else targets.add(edit.pointer);
  }
  return targets;
}

function subtreeModified(pointer: string, modified: ReadonlySet<string>): boolean {
  if (modified.has(pointer)) return true;
  const prefix = pointer === "" ? "/" : `${pointer}/`;
  for (const target of modified) {
    if (target.startsWith(prefix)) return true;
  }
  return false;
}

function renderPreserving(
  text: string,
  value: unknown,
  pointer: string,
  style: JsonStyle,
  depth: number,
  spans: ReadonlyMap<string, ValueSpan>,
  modified: ReadonlySet<string>,
  objectEntries: ReadonlyMap<string, readonly ObjectEntry[]>,
): string {
  if (!subtreeModified(pointer, modified)) {
    const span = spans.get(pointer);
    if (span !== undefined) return text.slice(span.start, span.end);
  }
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const rendered = value.map((entry, index) =>
      renderPreserving(text, entry, pointerFromTokens([...tokensOf(pointer), String(index)]), style, depth + 1, spans, modified, objectEntries),
    );
    if (style.indent === "") return `[${rendered.join(",")}]`;
    const pad = style.indent.repeat(depth + 1);
    const inner = rendered.map((entry) => `${pad}${entry}`).join(`,${style.newline}`);
    return `[${style.newline}${inner}${style.newline}${style.indent.repeat(depth)}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 0) return "{}";
    const sourceEntries = objectEntries.get(pointer);
    const rendered =
      sourceEntries === undefined
        ? keys.map((key) => {
            const childPointer = pointerFromTokens([...tokensOf(pointer), key]);
            return `${JSON.stringify(key)}:${style.colon}${renderPreserving(text, record[key], childPointer, style, depth + 1, spans, modified, objectEntries)}`;
          })
        : (() => {
            const written = new Set<string>();
            const parts: string[] = [];
            for (const entry of sourceEntries) {
              if (!Object.hasOwn(record, entry.key)) continue;
              written.add(entry.key);
              parts.push(
                `${entry.keyRaw}:${style.colon}${renderPreserving(text, record[entry.key], entry.valuePointer, style, depth + 1, spans, modified, objectEntries)}`,
              );
            }
            for (const key of keys) {
              if (written.has(key)) continue;
              const childPointer = pointerFromTokens([...tokensOf(pointer), key]);
              parts.push(`${JSON.stringify(key)}:${style.colon}${renderPreserving(text, record[key], childPointer, style, depth + 1, spans, modified, objectEntries)}`);
            }
            return parts;
          })();
    if (style.indent === "") return `{${rendered.join(",")}}`;
    const pad = style.indent.repeat(depth + 1);
    const inner = rendered.map((entry) => `${pad}${entry}`).join(`,${style.newline}`);
    return `{${style.newline}${inner}${style.newline}${style.indent.repeat(depth)}}`;
  }
  throw new TypeError("a json pointer edit was given a value JSON cannot render");
}

function unchangedBytesPreserved(original: string, edited: string, spans: ReadonlyMap<string, ValueSpan>, modified: ReadonlySet<string>): boolean {
  for (const [pointer, span] of spans) {
    if (subtreeModified(pointer, modified)) continue;
    const slice = original.slice(span.start, span.end);
    if (!edited.includes(slice)) return false;
  }
  return true;
}

function detectStyle(text: string): JsonStyle {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const escaped = newline === "\r\n" ? "\\r\\n" : "\\n";
  const indent = new RegExp(`${escaped}([ \\t]+)\\S`, "u").exec(text)?.[1] ?? "";
  return { indent, newline, finalNewline: text.endsWith("\n"), colon: /:[ \t]/u.test(text) ? " " : "" };
}

function renderValue(value: unknown, style: JsonStyle, depth: number): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const rendered = value.map((entry) => renderValue(entry, style, depth + 1));
    if (style.indent === "") return `[${rendered.join(",")}]`;
    const pad = style.indent.repeat(depth + 1);
    const inner = rendered.map((entry) => `${pad}${entry}`).join(`,${style.newline}`);
    return `[${style.newline}${inner}${style.newline}${style.indent.repeat(depth)}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 0) return "{}";
    const rendered = keys.map((key) => `${JSON.stringify(key)}:${style.colon}${renderValue(record[key], style, depth + 1)}`);
    if (style.indent === "") return `{${rendered.join(",")}}`;
    const pad = style.indent.repeat(depth + 1);
    const inner = rendered.map((entry) => `${pad}${entry}`).join(`,${style.newline}`);
    return `{${style.newline}${inner}${style.newline}${style.indent.repeat(depth)}}`;
  }
  throw new TypeError("a json pointer edit was given a value JSON cannot render");
}

function finish(body: string, style: JsonStyle): string {
  if (style.finalNewline) return body.endsWith("\n") ? body : `${body}${style.newline}`;
  return body.replace(/\r?\n$/u, "");
}

function isIndex(token: string): boolean {
  return /^(?:0|[1-9]\d*)$/u.test(token);
}

function containerFor(next: string): [] | Record<string, unknown> {
  return next === "-" || isIndex(next) ? [] : {};
}

function childOf(parent: unknown, token: string, next: string): unknown {
  if (Array.isArray(parent)) {
    if (!isIndex(token)) throw new TypeError("a json pointer does not address an array index");
    const index = Number(token);
    const current = parent[index];
    if (current === undefined) {
      const created = containerFor(next);
      parent[index] = created;
      return created;
    }
    return current;
  }
  if (parent === null || typeof parent !== "object") throw new TypeError("a json pointer does not address an object");
  const record = parent as Record<string, unknown>;
  if (!Object.hasOwn(record, token) || record[token] === undefined) {
    const created = containerFor(next);
    record[token] = created;
    return created;
  }
  return record[token];
}

function assign(parent: unknown, token: string, edit: JsonPointerEdit): void {
  if (Array.isArray(parent)) {
    if (token === "-") {
      if (edit.remove === true) throw new TypeError("a json pointer cannot remove an append");
      parent.push(edit.value);
      return;
    }
    if (!isIndex(token)) throw new TypeError("a json pointer does not address an array index");
    const index = Number(token);
    if (!Object.hasOwn(parent, index)) throw new TypeError("a json pointer does not address an array index");
    if (edit.remove === true) parent.splice(index, 1);
    else parent[index] = edit.value;
    return;
  }
  if (parent === null || typeof parent !== "object") throw new TypeError("a json pointer does not address an object");
  const record = parent as Record<string, unknown>;
  if (edit.remove === true) delete record[token];
  else record[token] = edit.value;
}

function applyOne(root: unknown, edit: JsonPointerEdit): unknown {
  const tokens = tokensOf(edit.pointer);
  if (tokens.length === 0) {
    if (edit.remove === true) throw new TypeError("a json pointer edit cannot remove the whole document");
    return edit.value;
  }
  if (root === null || typeof root !== "object") throw new TypeError("a json pointer does not address an object");
  let parent: unknown = root;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    parent = childOf(parent, tokens[index]!, tokens[index + 1] ?? "");
  }
  assign(parent, tokens[tokens.length - 1]!, edit);
  return root;
}

/**
 * The value a JSON pointer addresses in `text`, or `{ found: false }` when
 * a token along the pointer is absent. The text must be JSON; a parse
 * failure throws a TypeError that does not quote the text.
 */
export function valueAtJsonPointer(text: string, pointer: string): JsonPointerValue {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new TypeError("a json pointer was given text that is not JSON");
  }
  const tokens = tokensOf(pointer);
  let current = root;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (!isIndex(token) || !Object.hasOwn(current, Number(token))) return { found: false, value: undefined };
      current = current[Number(token)];
      continue;
    }
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, token)) return { found: false, value: undefined };
    current = (current as Record<string, unknown>)[token];
  }
  return { found: true, value: current };
}

/**
 * Applies `edits` to `text` and returns the edited document. An empty edit
 * list returns `text` unchanged. Indent, the order of existing keys, and
 * whether the text ended in a newline are taken from `text` and used for
 * the render. The render is parsed and rendered a second time, and the two
 * results must be the same bytes.
 */
export function editJsonPointer(text: string, edits: readonly JsonPointerEdit[]): string {
  if (edits.length === 0) return text;
  let indexed: { value: unknown; spans: Map<string, ValueSpan>; objectEntries: Map<string, readonly ObjectEntry[]> };
  try {
    indexed = indexJsonSpans(text);
  } catch (cause) {
    if (cause instanceof JsonEditUnstableError) throw cause;
    throw new TypeError("a json pointer edit was given text that is not JSON");
  }
  let root = indexed.value;
  for (const edit of edits) root = applyOne(root, edit);
  const modified = editTargets(edits);
  const style = detectStyle(text);
  const rendered = finish(renderPreserving(text, root, "", style, 0, indexed.spans, modified, indexed.objectEntries), style);
  if (!unchangedBytesPreserved(text, rendered, indexed.spans, modified)) throw new JsonEditUnstableError();
  let again: string;
  try {
    const reread = indexJsonSpans(rendered);
    again = finish(renderPreserving(rendered, reread.value, "", style, 0, reread.spans, new Set(), reread.objectEntries), style);
  } catch (cause) {
    if (cause instanceof JsonEditUnstableError) throw cause;
    throw new JsonEditUnstableError();
  }
  if (rendered !== again) throw new JsonEditUnstableError();
  return rendered;
}
