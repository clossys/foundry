import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { stableStringify } from "../catalog-core/stable.js";

/**
 * DESIGNER-GATE: the library receipt. Every designer write records, inside the same atomic generation it
 * persists, which command made it, that command's inputs and the content hash of the library it left.
 * `checkReceipt` fails when the library on disk differs from what the last designer write recorded, or when
 * a designer write carried forward a change made outside one. The receipt is a tamper-evident record for
 * review, not a cryptographic seal: a hand-forged receipt is caught only by comparing it with a base receipt.
 */
export const DESIGNER_RECEIPT_FILE = "designer-receipt.json";
/**
 * Agent-written input records at the library root. Commands consume them (and record their digest as an
 * input); they are not design-system state, so they stay outside the content hash.
 */
export const DESIGNER_INPUT_FILES: readonly string[] = ["decisions.json", "component-observations.json", "dogfood-exceptions.json"];

export interface DesignerWriteStamp { command: string; inputs?: Readonly<Record<string, unknown>> }
export interface DesignerWriteEntry {
  /** The designer command or package write function that made this generation. */
  command: string;
  /** Its inputs: small values verbatim, large ones as `sha256:` digests. */
  inputs: Record<string, unknown>;
  /** `sha256:` over the canonical file manifest this write left. */
  contentHash: string;
  /** Paths changed outside a designer write before this write that it carried forward unrepaired. */
  unreceipted: string[];
}
export interface DesignerReceipt { version: 1; files: Record<string, string>; writes: DesignerWriteEntry[] }
export type DesignerReceiptCode = "DR1" | "DR2" | "DR3" | "DR4" | "DR5";
export interface DesignerReceiptFinding { code: DesignerReceiptCode; path?: string; message: string }
export interface DesignerReceiptVerdict { ok: boolean; contentHash: string; findings: DesignerReceiptFinding[] }

const HASH = /^sha256:[a-f0-9]{64}$/;
export const digest = (bytes: string | Uint8Array): string => "sha256:" + createHash("sha256").update(bytes).digest("hex");
/** Digest of a JSON input, independent of key order; a non-JSON value falls back to its plain serialization. */
export const inputDigest = (value: unknown): string => {
  try { return digest(stableStringify(value)); } catch { return digest(JSON.stringify(value) ?? "undefined"); }
};
export const contentHashOf = (manifest: Readonly<Record<string, string>>): string => inputDigest(manifest);
/** One stamp per write: the caller's command wins over the write function's default; inputs merge. */
export const resolveStamp = (fallback: string, own: Record<string, unknown>, stamp?: DesignerWriteStamp): Required<DesignerWriteStamp> =>
  ({ command: stamp?.command ?? fallback, inputs: { ...own, ...(stamp?.inputs ?? {}) } });

/** Every library file except the receipt and the root input records, as `path -> sha256:` in path order. */
export async function libraryManifest(root: string): Promise<Record<string, string>> {
  const rows: [string, string][] = [];
  async function walk(directory: string, prefix: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name), name = prefix + entry.name;
      if (entry.isDirectory()) await walk(path, name + "/");
      else if (entry.isFile()) { if (prefix || (name !== DESIGNER_RECEIPT_FILE && !DESIGNER_INPUT_FILES.includes(name))) rows.push([name, digest(await fs.readFile(path))]); }
      else throw new Error("Library contains a symlink or special file");
    }
  }
  await walk(root, "");
  return Object.fromEntries(rows.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

const changedPaths = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): string[] =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(path => a[path] !== b[path]).sort();

/**
 * The receipt after one write, or undefined when nothing needs recording (the library was already exactly as
 * receipted and the write left it so). Drift found at write start that the write did not restore is recorded.
 */
export function nextReceipt(previous: DesignerReceipt | undefined, stamp: Required<DesignerWriteStamp>, before: Record<string, string>, after: Record<string, string>): DesignerReceipt | undefined {
  const prior = previous?.files;
  if (prior && !changedPaths(prior, before).length && !changedPaths(prior, after).length) return undefined;
  const unreceipted = prior ? changedPaths(prior, before).filter(path => after[path] !== prior[path]) : [];
  return { version: 1, files: after, writes: [...previous?.writes ?? [], { command: stamp.command, inputs: stamp.inputs, contentHash: contentHashOf(after), unreceipted }] };
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, names: string[]) => Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
function receiptShape(value: unknown): value is DesignerReceipt {
  return record(value) && keys(value, ["version", "files", "writes"]) && value.version === 1
    && record(value.files) && Object.values(value.files).every(hash => typeof hash === "string" && HASH.test(hash))
    && Array.isArray(value.writes) && value.writes.every(row => record(row) && keys(row, ["command", "inputs", "contentHash", "unreceipted"])
      && typeof row.command === "string" && row.command.length > 0 && record(row.inputs) && typeof row.contentHash === "string" && HASH.test(row.contentHash)
      && Array.isArray(row.unreceipted) && row.unreceipted.every(path => typeof path === "string"));
}
/** A stored receipt: canonical bytes, at least one write, and a manifest that hashes to the last write. */
export function parseReceipt(text: string): DesignerReceipt | string {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return "receipt is not JSON"; }
  if (!receiptShape(value)) return "receipt does not have the designer receipt shape";
  if (stableStringify(value) !== text) return "receipt is not canonical; only designer writes produce it";
  if (!value.writes.length) return "receipt records no write";
  if (contentHashOf(value.files) !== value.writes.at(-1)!.contentHash) return "receipt file manifest does not match its last write's content hash";
  return value;
}

/** Read the stored receipt for a write: absent starts history; an invalid one refuses the write. */
export async function readReceipt(root: string): Promise<DesignerReceipt | undefined | string> {
  let text: string;
  try { text = await fs.readFile(join(root, DESIGNER_RECEIPT_FILE), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  return parseReceipt(text);
}

/**
 * The check. DR1 no receipt; DR2 invalid receipt; DR3 a file differs from the last designer write;
 * DR4 a designer write carried a change made outside one; DR5 history is not an append-only extension of `base`.
 */
export async function checkReceipt(root: string, base?: unknown): Promise<DesignerReceiptVerdict> {
  const manifest = await libraryManifest(root), contentHash = contentHashOf(manifest), findings: DesignerReceiptFinding[] = [];
  const done = () => ({ ok: findings.length === 0, contentHash, findings });
  const stored = await readReceipt(root);
  if (stored === undefined) { findings.push({ code: "DR1", message: `no ${DESIGNER_RECEIPT_FILE}: no designer write has stamped this library; run a designer-library command instead of editing files` }); return done(); }
  if (typeof stored === "string") { findings.push({ code: "DR2", message: stored }); return done(); }
  for (const path of changedPaths(stored.files, manifest)) {
    const change = stored.files[path] === undefined ? "added" : manifest[path] === undefined ? "removed" : "changed";
    findings.push({ code: "DR3", path, message: `${change} without a designer write receipt; revert it or make the change through the designer package` });
  }
  stored.writes.forEach((write, index) => { for (const path of write.unreceipted) findings.push({ code: "DR4", path, message: `write ${index + 1} (${write.command}) carried a change made outside a designer write` }); });
  if (base !== undefined) {
    if (!receiptShape(base)) findings.push({ code: "DR5", message: "base receipt does not have the designer receipt shape" });
    else if (base.writes.length > stored.writes.length || base.writes.some((write, index) => stableStringify(write) !== stableStringify(stored.writes[index]))) findings.push({ code: "DR5", message: `receipt history does not extend the base receipt's ${base.writes.length} writes` });
  }
  return done();
}
