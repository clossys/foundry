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

function decodeToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function tokensOf(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new TypeError("a json pointer does not start with /");
  return pointer.split("/").slice(1).map(decodeToken);
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
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new TypeError("a json pointer edit was given text that is not JSON");
  }
  for (const edit of edits) root = applyOne(root, edit);
  const style = detectStyle(text);
  const rendered = finish(renderValue(root, style, 0), style);
  let again: string;
  try {
    again = finish(renderValue(JSON.parse(rendered), style, 0), style);
  } catch {
    throw new TypeError("a json pointer edit did not re-render to the same bytes");
  }
  if (rendered !== again) throw new TypeError("a json pointer edit did not re-render to the same bytes");
  return rendered;
}
