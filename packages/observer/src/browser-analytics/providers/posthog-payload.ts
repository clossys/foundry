/**
 * The replay payload check for the PostHog adapter's `before_send` hook
 * (C-68, items 2 to 5).
 *
 * `$snapshot_data` reaches the hook as data. This module decodes it and
 * accepts it only in masked form, so that the adapter does not depend on the
 * SDK's own masking. It reads the recorder's record format as plain data:
 *
 * - a record is `{ type, data }`; type 2 is a full snapshot, 3 an
 *   incremental record whose `data.source` names its kind, 4 a meta record
 *   and 5 a custom record. Any other record type (the plugin record type
 *   among them) and any source outside `REPLAY_RECORD_KINDS` drops the event;
 * - a serialized node is `{ type, ... }` with `childNodes`, `attributes` and
 *   `textContent`; a text, comment or CDATA node holds page text.
 *
 * Nothing here reads a global or touches the SDK. Pure functions of their
 * arguments. Whether the real recorder writes this format is separate
 * evidence the host answers through its probe (H-11).
 */

import { MASKED_TEXT_PATTERN, REPLAY_RECORD_KINDS } from "./posthog-options.js";

type PlainRecord = Record<string, unknown>;

/** The record type numbers the format gives. */
const RECORD_TYPE_KINDS: Readonly<Record<number, string>> = Object.freeze({
  2: "full-snapshot",
  4: "meta",
  5: "custom",
});

/** The incremental `source` numbers that name a listed kind. */
const SOURCE_KINDS: Readonly<Record<number, string>> = Object.freeze({
  0: "mutation",
  1: "mouse-move",
  2: "mouse-interaction",
  3: "scroll",
  4: "viewport-resize",
  5: "input",
  6: "touch-move",
  7: "media-interaction",
  8: "stylesheet-rule",
  13: "style-declaration",
  15: "adopted-style-sheet",
});

const INCREMENTAL_TYPE = 3;

/** Keys that mark a record whose data is compressed or packed. */
const COMPRESSION_MARKERS: readonly string[] = ["cv", "v"];

/** Node type numbers that hold text: text, CDATA, comment. */
const TEXT_NODE_TYPES: ReadonlySet<number> = new Set([3, 4, 5]);

const NODE_TYPES: ReadonlySet<number> = new Set([0, 1, 2, 3, 4, 5]);

function isPlainRecord(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** What the scan found in a decoded payload. */
interface Scan {
  /** False when the payload does not decode (item 2). */
  decoded: boolean;
  /** True when every value that can hold page text is masked (item 3). */
  masked: boolean;
  /** Every address the payload carries, to check for a query or fragment (item 4). */
  addresses: string[];
}

function unmaskedText(value: string): boolean {
  return !MASKED_TEXT_PATTERN.test(value);
}

/** Checks one `value` attribute: a string in masked form, or the format's removal marker `null` when allowed. */
function valueAttributeOk(attributes: PlainRecord, allowNull: boolean): "ok" | "unmasked" | "type" {
  if (!Object.prototype.hasOwnProperty.call(attributes, "value")) return "ok";
  const value = attributes.value;
  if (value === null && allowNull) return "ok";
  if (typeof value !== "string") return "type";
  return unmaskedText(value) ? "unmasked" : "ok";
}

/**
 * Walks serialized nodes without recursion, at any depth: child lists cover
 * shadow roots and same-origin iframe documents. Returns false when a node
 * does not decode.
 */
function scanNodes(roots: readonly unknown[], scan: Scan): boolean {
  const stack: unknown[] = [...roots];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!isPlainRecord(node)) return false;
    const type = node.type;
    if (typeof type !== "number" || !NODE_TYPES.has(type)) return false;

    if (TEXT_NODE_TYPES.has(type)) {
      const text = node.textContent;
      if (typeof text !== "string") return false;
      if (node.isStyle !== undefined && typeof node.isStyle !== "boolean") return false;
      // Only the text of a style element is exempt, and only text nodes can be one.
      const styleText = type === 3 && node.isStyle === true;
      if (!styleText && unmaskedText(text)) scan.masked = false;
    }

    if (node.attributes !== undefined) {
      if (!isPlainRecord(node.attributes)) return false;
      const outcome = valueAttributeOk(node.attributes, false);
      if (outcome === "type") return false;
      if (outcome === "unmasked") scan.masked = false;
    }

    if (node.childNodes !== undefined) {
      if (!Array.isArray(node.childNodes)) return false;
      for (const child of node.childNodes as unknown[]) stack.push(child);
    }
  }
  return true;
}

function scanMutation(data: PlainRecord, scan: Scan): boolean {
  if (data.texts !== undefined) {
    if (!Array.isArray(data.texts)) return false;
    for (const change of data.texts as unknown[]) {
      if (!isPlainRecord(change)) return false;
      // `null` is the format's marker for a node with no text; it carries none.
      const value = change.value;
      if (value === undefined || value === null) continue;
      if (typeof value !== "string") return false;
      if (unmaskedText(value)) scan.masked = false;
    }
  }
  if (data.attributes !== undefined) {
    if (!Array.isArray(data.attributes)) return false;
    for (const change of data.attributes as unknown[]) {
      if (!isPlainRecord(change) || !isPlainRecord(change.attributes)) return false;
      const outcome = valueAttributeOk(change.attributes, true);
      if (outcome === "type") return false;
      if (outcome === "unmasked") scan.masked = false;
    }
  }
  if (data.removes !== undefined && !Array.isArray(data.removes)) return false;
  if (data.adds !== undefined) {
    if (!Array.isArray(data.adds)) return false;
    const nodes: unknown[] = [];
    for (const add of data.adds as unknown[]) {
      if (!isPlainRecord(add)) return false;
      nodes.push(add.node);
    }
    if (!scanNodes(nodes, scan)) return false;
  }
  return true;
}

/** Every string in a custom record that reads as a web address. */
function collectAddresses(root: unknown, into: string[]): void {
  const seen = new Set<unknown>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value === "string") {
      if (/^https?:\/\//i.test(value.trimStart())) into.push(value.trim());
    } else if (value !== null && typeof value === "object" && !seen.has(value)) {
      seen.add(value);
      for (const inner of Object.values(value as object)) stack.push(inner);
    }
  }
}

/** The kind a record names, or `null` when the record is not a listed kind. */
function kindOf(record: PlainRecord): string | null {
  const type = record.type;
  if (typeof type !== "number") return null;
  let kind: string | undefined;
  if (type === INCREMENTAL_TYPE) {
    const data = record.data;
    const source = isPlainRecord(data) ? data.source : undefined;
    kind = typeof source === "number" ? SOURCE_KINDS[source] : undefined;
  } else {
    kind = RECORD_TYPE_KINDS[type];
  }
  return kind !== undefined && REPLAY_RECORD_KINDS.includes(kind) ? kind : null;
}

function scanRecord(record: PlainRecord, kind: string, scan: Scan): boolean {
  const data = record.data as PlainRecord;
  switch (kind) {
    case "full-snapshot":
      return scanNodes([data.node], scan);
    case "meta":
      if (typeof data.href !== "string") return false;
      scan.addresses.push(data.href);
      return true;
    case "custom":
      collectAddresses(data, scan.addresses);
      return true;
    case "mutation":
      return scanMutation(data, scan);
    case "input":
      if (typeof data.text !== "string") return false;
      if (unmaskedText(data.text)) scan.masked = false;
      return true;
    default:
      return true;
  }
}

/** The outcome of decoding and masking-checking a payload. */
export interface ScannedPayload {
  /** The payload's records; empty unless `decoded`. */
  records: readonly PlainRecord[];
  decoded: boolean;
  masked: boolean;
  /** Every address in meta and custom records, read before any rewrite. */
  addresses: readonly string[];
}

/** Items 2 and 3 of C-68: decode the payload and check that every value that can hold page text is masked. */
export function scanReplayPayload(payload: unknown): ScannedPayload {
  const scan: Scan = { decoded: true, masked: true, addresses: [] };
  const failed: ScannedPayload = { records: [], decoded: false, masked: false, addresses: scan.addresses };
  if (!Array.isArray(payload) || payload.length === 0) return failed;
  const records: PlainRecord[] = [];
  for (const entry of payload as unknown[]) {
    if (!isPlainRecord(entry)) return failed;
    for (const marker of COMPRESSION_MARKERS) {
      if (Object.prototype.hasOwnProperty.call(entry, marker)) return failed;
    }
    if (!isPlainRecord(entry.data)) return failed;
    const kind = kindOf(entry);
    if (kind === null) return failed;
    if (!scanRecord(entry, kind, scan)) return failed;
    records.push(entry);
  }
  return { records, decoded: true, masked: scan.masked, addresses: scan.addresses };
}

/** True when an address parses and carries a non-empty query or a non-empty fragment, or does not parse at all. */
export function addressHasQueryOrFragment(address: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return true;
  }
  return url.search !== "" || url.hash !== "";
}

/**
 * Item 5 and the removal of custom records: returns the records to send, or
 * `null` when a meta record's address cannot be rewritten. The input is not
 * changed; a meta record is copied with its sanitized `href`.
 */
export function finishReplayPayload(
  records: readonly PlainRecord[],
  sanitizeUrl: (href: string) => string | null,
): PlainRecord[] | null {
  const out: PlainRecord[] = [];
  for (const record of records) {
    if (record.type === 5) continue;
    if (record.type === 4) {
      const data = record.data as PlainRecord;
      const href = sanitizeUrl(data.href as string);
      if (href === null) return null;
      out.push({ ...record, data: { ...data, href } });
      continue;
    }
    out.push(record);
  }
  return out;
}
