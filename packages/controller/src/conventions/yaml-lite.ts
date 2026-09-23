/**
 * A small, deliberately incomplete YAML parser for exactly one input shape:
 * a GitHub Actions workflow file. `ci-conventions-check` (`./ci-conventions.ts`)
 * needs to read `on:`, `permissions:`, `concurrency:`, and `jobs:.*` out of a
 * workflow's raw text, and this package ships zero runtime dependencies
 * (`packages/controller/package.json` has no `dependencies` field at all) --
 * pulling in a full YAML implementation for that one shape is a heavier
 * dependency than the shape justifies. This module is the "small,
 * well-tested subset parser" alternative the convention explicitly allows.
 *
 * What it supports, because workflow files use it:
 * - Block mappings (`key: value`, nested by indentation).
 * - Block sequences (`- item`, including `- key: value` sequence-of-mapping).
 * - Flow sequences (`[a, b, c]`) and flow mappings (`{a: b, c: d}`), including
 *   one flow collection nested inside another.
 * - Scalars: bare strings, single- and double-quoted strings, integers,
 *   floats, booleans (`true`/`false`), and null (`~`, `null`, empty).
 * - Literal (`|`) and folded (`>`) block scalars, indentation-delimited, for
 *   `run: |` step bodies. Chomping indicators (`|-`, `|+`) are recognized and
 *   affect only trailing-newline handling.
 * - Comments (`#` outside a quoted string) and blank lines.
 * - Anchors/aliases, tags, multi-document streams, and every other YAML
 *   feature are deliberately unsupported. A construct this parser does not
 *   recognize throws `YamlLiteParseError` rather than silently guessing --
 *   see the header rationale in `../gates/result.ts` for why this package
 *   treats "could not evaluate" as its own outcome rather than a guess.
 *
 * Zero I/O: this module never reads a file. It transforms a string a caller
 * already read into a plain JS value, matching this package's other
 * `conventions` modules.
 */

export class YamlLiteParseError extends Error {
  constructor(message: string, readonly line: number) {
    super(`${message} (line ${line + 1})`);
    this.name = "YamlLiteParseError";
  }
}

export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

interface Line {
  readonly raw: string;
  readonly indent: number;
  readonly content: string;
  readonly blank: boolean;
}

function stripComment(text: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble) {
      // A '#' only starts a comment when it is at the start of the text or
      // preceded by whitespace -- '${{ github.repository }} #foo' vs. a
      // literal '#' inside an unquoted scalar like a hex color is not a
      // shape workflow files use, so this heuristic is sufficient here.
      if (i === 0 || /\s/.test(text[i - 1] as string)) return text.slice(0, i).trimEnd();
    }
  }
  return text;
}

function splitLines(text: string): Line[] {
  return text.split(/\r\n|\n/).map((raw) => {
    const withoutComment = stripComment(raw);
    const trimmed = withoutComment.trim();
    const indentMatch = /^(\s*)/.exec(withoutComment);
    const indent = indentMatch ? indentMatch[1]!.length : 0;
    return { raw, indent, content: trimmed, blank: trimmed === "" };
  });
}

function parseScalar(text: string): YamlValue {
  const t = text.trim();
  if (t === "" || t === "~" || t === "null" || t === "Null" || t === "NULL") return null;
  if (t === "true" || t === "True" || t === "TRUE") return true;
  if (t === "false" || t === "False" || t === "FALSE") return false;
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return JSON.parse(t) as string;
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  if (/^-?\d+$/.test(t)) return Number.parseInt(t, 10);
  if (/^-?\d+\.\d+$/.test(t)) return Number.parseFloat(t);
  if ((t.startsWith("[") && t.endsWith("]")) || (t.startsWith("{") && t.endsWith("}"))) {
    return parseFlow(t);
  }
  return t;
}

/** Splits a flow collection's inner text on top-level commas (not inside nested brackets/quotes). */
function splitFlowItems(inner: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let current = "";
  for (const ch of inner) {
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (!inSingle && !inDouble) {
      if (ch === "[" || ch === "{") depth++;
      else if (ch === "]" || ch === "}") depth--;
    }
    if (ch === "," && depth === 0 && !inSingle && !inDouble) {
      items.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "") items.push(current);
  return items.map((item) => item.trim()).filter((item) => item !== "");
}

function parseFlow(text: string): YamlValue {
  const t = text.trim();
  if (t.startsWith("[") && t.endsWith("]")) {
    return splitFlowItems(t.slice(1, -1)).map((item) => parseScalar(item));
  }
  if (t.startsWith("{") && t.endsWith("}")) {
    const result: Record<string, YamlValue> = {};
    for (const item of splitFlowItems(t.slice(1, -1))) {
      const idx = item.indexOf(":");
      if (idx === -1) throw new Error(`Malformed flow mapping entry: "${item}"`);
      const key = parseScalar(item.slice(0, idx)) as string;
      result[String(key)] = parseScalar(item.slice(idx + 1));
    }
    return result;
  }
  return parseScalar(t);
}

class Cursor {
  index = 0;
  constructor(readonly lines: readonly Line[]) {}

  peek(): Line | undefined {
    while (this.index < this.lines.length && this.lines[this.index]!.blank) this.index++;
    return this.lines[this.index];
  }

  next(): Line {
    const line = this.peek();
    if (!line) throw new Error("Unexpected end of input");
    this.index++;
    return line;
  }
}

/** Finds `key: rest` at the top level of `content`, respecting quotes (a value may itself contain ": "). */
function splitMappingEntry(content: string): { key: string; rest: string } | undefined {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === ":" && !inSingle && !inDouble) {
      const after = content[i + 1];
      if (after === undefined || after === " " || after === "\t") {
        return { key: content.slice(0, i).trim(), rest: content.slice(i + 1).trim() };
      }
    }
  }
  return undefined;
}

function parseKey(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return JSON.parse(t) as string;
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

function readBlockScalar(cursor: Cursor, indicator: string, parentIndent: number): string {
  const chomp = indicator.includes("-") ? "strip" : indicator.includes("+") ? "keep" : "clip";
  const collected: string[] = [];
  let blockIndent: number | undefined;
  while (cursor.index < cursor.lines.length) {
    const line = cursor.lines[cursor.index]!;
    if (line.blank) {
      collected.push("");
      cursor.index++;
      continue;
    }
    if (line.indent <= parentIndent) break;
    if (blockIndent === undefined) blockIndent = line.indent;
    collected.push(line.raw.slice(blockIndent));
    cursor.index++;
  }
  while (collected.length > 0 && collected[collected.length - 1] === "") collected.pop();
  let text = collected.join("\n");
  if (chomp === "keep") text += "\n";
  else if (chomp === "clip") text += "\n";
  return text;
}

function parseBlock(cursor: Cursor, minIndent: number): YamlValue {
  const first = cursor.peek();
  if (!first || first.indent < minIndent) return null;

  const containerIndent = first.indent;

  if (first.content.startsWith("- ") || first.content === "-") {
    const items: YamlValue[] = [];
    while (true) {
      const line = cursor.peek();
      if (!line || line.indent !== containerIndent || !(line.content === "-" || line.content.startsWith("- "))) {
        break;
      }
      cursor.next();
      const remainder = line.content === "-" ? "" : line.content.slice(2).trim();
      if (remainder === "") {
        items.push(parseBlock(cursor, containerIndent + 1));
      } else {
        // `- key: value` starts a mapping whose first entry is on the dash's
        // own line, continuing at the dash's content column.
        const entry = splitMappingEntry(remainder);
        if (entry) {
          const virtualIndent = containerIndent + 2;
          const obj: Record<string, YamlValue> = {};
          obj[parseKey(entry.key)] = parseInlineOrNested(cursor, entry.rest, virtualIndent);
          while (true) {
            const next = cursor.peek();
            if (!next || next.indent !== virtualIndent) break;
            const nextEntry = splitMappingEntry(next.content);
            if (!nextEntry) break;
            cursor.next();
            obj[parseKey(nextEntry.key)] = parseInlineOrNested(cursor, nextEntry.rest, virtualIndent);
          }
          items.push(obj);
        } else {
          items.push(parseScalar(remainder));
        }
      }
    }
    return items;
  }

  const obj: Record<string, YamlValue> = {};
  while (true) {
    const line = cursor.peek();
    if (!line || line.indent !== containerIndent) break;
    const entry = splitMappingEntry(line.content);
    if (!entry) {
      throw new YamlLiteParseError(`Expected "key: value" or a sequence item, got "${line.content}"`, cursor.index);
    }
    cursor.next();
    obj[parseKey(entry.key)] = parseInlineOrNested(cursor, entry.rest, containerIndent + 1);
  }
  return obj;
}

function parseInlineOrNested(cursor: Cursor, rest: string, childMinIndent: number): YamlValue {
  if (rest === "") {
    const next = cursor.peek();
    if (next && next.indent >= childMinIndent) return parseBlock(cursor, childMinIndent);
    return null;
  }
  if (rest === "|" || rest === ">" || /^[|>][+-]?$/.test(rest)) {
    return readBlockScalar(cursor, rest, childMinIndent - 1);
  }
  return parseScalar(rest);
}

/**
 * Parses `text` as a GitHub Actions workflow (or any document within this
 * module's supported subset) and returns the plain-JS value it describes.
 * Throws `YamlLiteParseError` (or a plain `Error` for a malformed flow
 * collection) on anything outside that subset -- never returns a guess.
 */
export function parseYamlLite(text: string): YamlValue {
  const lines = splitLines(text);
  const cursor = new Cursor(lines);
  if (!cursor.peek()) return null;
  return parseBlock(cursor, 0);
}
