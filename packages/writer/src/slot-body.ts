/** A binding path or an opaque legacy binding object; neither is interpreted here. */
export type WriterSlotBinding = string | Record<string, unknown>;

export interface WriterSlotRecord extends Record<string, unknown> {
  id: string;
  context: string;
  text?: string;
}

/** Rows retain source order, including the same record identity in different locales. */
export interface WriterSlotBodyRecord {
  locale: string;
  record: WriterSlotRecord;
  bindings: WriterSlotBinding[];
}

export class WriterSlotBodyParseError extends Error {
  constructor(message: string, public readonly line: number) {
    super(`Writer slot body:${line}: ${message}`);
    this.name = "WriterSlotBodyParseError";
  }
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const localePattern = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const heading = (line: string) => /^#{2,3}(?:\s|$)/.test(line);

// Compare JSON values without treating object key order as a metadata conflict.
function equalJSON(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((v, i) => equalJSON(v, right[i]));
  if (object(left) && object(right)) {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equalJSON(left[key], right[key]));
  }
  return false;
}

/**
 * Parse a native Writer candidate BODY, without synthesizing a legacy cell.
 * Locales must be unique tags and match the body's sections in order.
 * See README for separator/escaping rules and the envelope validation boundary.
 * Throws on the first malformed structure; no partial result is returned.
 */
export function parseWriterSlotBody(body: string, locales: readonly string[]): WriterSlotBodyRecord[] {
  const fail = (message: string, line: number): never => { throw new WriterSlotBodyParseError(message, line); };
  if (typeof body !== "string") fail("Expected body string", 1);
  if (!Array.isArray(locales) || !locales.length || locales.some(l => typeof l !== "string" || !localePattern.test(l)) || new Set(locales).size !== locales.length) {
    fail("Expected unique locale tags", 1);
  }
  const lines = body.split(/\r?\n/);
  // The final line terminator is transport, separate from the separator blank line.
  if (lines.at(-1) === "") lines.pop();
  const records: WriterSlotBodyRecord[] = [];
  const seenIds = new Set<string>();
  let locale: string | undefined;
  let section = 0;
  let i = 0;
  while (i < lines.length) {
    const row = lines[i]!;
    const line = i + 1;
    if (row === "") { i++; continue; }
    if (row.startsWith("## ")) {
      locale = row.slice(3);
      if (locale !== locales[section]) fail("Unknown, repeated or out-of-order locale section", line);
      section++;
      i++;
      continue;
    }
    if (!locale || !row.startsWith("### ") || !nonempty(row.slice(4))) fail("Expected locale or record heading", line);
    const context = row.slice(4);
    i++;
    const metadataLine = i + 1;
    const match = /^<!-- (.+) -->$/.exec(lines[i] ?? "");
    if (!match) fail("Expected one-line JSON record metadata", metadataLine);
    let meta: unknown;
    try { meta = JSON.parse(match![1]!); } catch { fail("Invalid record metadata JSON", metadataLine); }
    if (!object(meta) || !nonempty(meta.id) || Object.hasOwn(meta, "text") || Object.hasOwn(meta, "context")) {
      fail("Expected non-text record metadata with id", metadataLine);
    }
    const metadata = meta as Record<string, unknown> & { id: string };
    const bindings = Object.hasOwn(metadata, "bindings") ? metadata.bindings : [];
    if (!Array.isArray(bindings) || bindings.some(b => !(nonempty(b) || object(b)))) fail("Invalid record bindings: expected paths or objects", metadataLine);
    const identity = JSON.stringify([locale, metadata.id]);
    if (seenIds.has(identity)) fail("Repeated record id in locale", metadataLine);
    seenIds.add(identity);
    const { bindings: _bindings, ...fields } = metadata;
    let record: WriterSlotRecord = { ...fields, id: metadata.id, context };
    i++;
    if (lines[i] === "```json") {
      const fenceLine = i + 1;
      const start = ++i;
      while (i < lines.length && lines[i] !== "```") i++;
      if (i === lines.length) fail("Unclosed textless record JSON block", fenceLine);
      let value: unknown;
      try { value = JSON.parse(lines.slice(start, i).join("\n")); } catch { fail("Invalid textless record JSON", fenceLine); }
      if (!object(value) || Object.hasOwn(value, "text") || value.id !== record.id || value.context !== context) {
        fail("Textless JSON record disagrees with heading or metadata", fenceLine);
      }
      const payload = value as Record<string, unknown>;
      if (Object.hasOwn(payload, "bindings") && !equalJSON(payload.bindings, bindings)) fail("Textless JSON conflicts with metadata field bindings", fenceLine);
      for (const key of Object.keys(metadata)) {
        if (Object.hasOwn(payload, key) && !equalJSON(payload[key], metadata[key])) fail(`Textless JSON conflicts with metadata field ${key}`, fenceLine);
      }
      record = { ...record, ...payload } as WriterSlotRecord;
      i++;
      while (lines[i] === "") i++;
      if (i < lines.length && !heading(lines[i]!)) fail("Expected heading after textless record JSON", i + 1);
    } else {
      const text: string[] = [];
      while (i < lines.length && !heading(lines[i]!)) {
        if (/^(#|<!--|```json)/.test(lines[i]!)) fail("Escape structural text with a leading backslash", i + 1);
        text.push(lines[i++]!);
      }
      // Remove exactly one separator; all other leading/trailing blank lines are text.
      if (text.at(-1) === "") text.pop();
      record.text = text.map(line => line.startsWith("\\") ? line.slice(1) : line).join("\n");
    }
    records.push({ locale: locale!, record, bindings: bindings as WriterSlotBinding[] });
  }
  if (section !== locales.length) fail("Locale sections must match declared order", lines.length + 1);
  return records;
}
