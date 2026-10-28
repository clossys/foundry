import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, lstatSync, mkdirSync, openSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WriterLibrary, WriterLocaleContent, WriterReceipt } from "../model/types.js";

/** Deterministic JSON: lexicographic object keys and unchanged array order. */
export function canonicalWriterJSON(value: unknown): string {
  const ancestors = new Set<object>();
  const encode = (item: unknown): string => {
    if (item === null) return "null";
    if (typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new TypeError("Writer JSON refuses non-finite numbers");
      return JSON.stringify(item);
    }
    if (typeof item !== "object") throw new TypeError(`Writer JSON refuses ${typeof item}`);
    if (ancestors.has(item)) throw new TypeError("Writer JSON refuses cyclic objects");
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        const entries: string[] = [];
        for (let index = 0; index < item.length; index += 1) entries.push(encode(item[index]));
        return `[${entries.join(",")}]`;
      }
      const prototype: unknown = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Writer JSON requires plain objects");
      const record = item as Record<string, unknown>;
      return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${encode(record[key])}`).join(",")}}`;
    } finally {
      ancestors.delete(item);
    }
  };
  return encode(value);
}

const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const digest = (value: unknown): string => createHash("sha256").update(canonicalWriterJSON(value), "utf8").digest("hex");

function localeIdentity(content: WriterLocaleContent) {
  return {
    records: [...content.records].sort((left, right) => compare(left.id, right.id)),
    documents: [...content.documents].sort((left, right) => compare(left.path, right.path)),
    files: (content.files ?? []).map(file => ({ path: file.path, recordIds: [...file.recordIds].sort() }))
      .sort((left, right) => compare(left.path, right.path)),
  };
}

/** Hash source content only; markdown contributes bytes, never inferred statuses. */
export function computeWriterReceipt(library: WriterLibrary): WriterReceipt {
  const defaultIds = new Set(library.locales[library.manifest.defaultLocale]?.records.map(record => record.id) ?? []);
  const tags = [...new Set([...library.manifest.locales.map(locale => locale.tag), ...Object.keys(library.locales)])].sort();
  const identities = Object.fromEntries(tags.map(tag => [tag, localeIdentity(library.locales[tag] ?? { records: [], documents: [] })]));
  const locales: WriterReceipt["locales"] = Object.fromEntries(tags.map(tag => {
    const content = identities[tag]!;
    const counts = { draft: 0, approved: 0, retired: 0, missing: 0 };
    for (const record of content.records) counts[record.status] += 1;
    if (tag !== library.manifest.defaultLocale) {
      const ids = new Set(content.records.map(record => record.id));
      counts.missing = [...defaultIds].filter(id => !ids.has(id)).length;
    }
    return [tag, { digest: digest(content), counts }];
  }));
  const manifest = { ...library.manifest, locales: [...library.manifest.locales].sort((left, right) => compare(left.tag, right.tag)) };
  return { libraryDigest: digest({ manifest, locales: identities }), locales };
}

function fileStatus(path: string) {
  try { return lstatSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function assertDestination(directory: string, destination: string): void {
  const parent = lstatSync(directory);
  if (parent.isSymbolicLink() || !parent.isDirectory()) throw new Error("Writer receipt .generated must be a directory, never a symlink");
  if (realpathSync(directory) !== directory) throw new Error("Writer receipt directory escapes its root");
  const target = fileStatus(destination);
  if (target?.isSymbolicLink()) throw new Error("Writer receipt destination must not be a symlink");
  if (target && !target.isFile()) throw new Error("Writer receipt destination must be a regular file");
}

/** Write the sole generated receipt through a fresh file and atomic rename. */
export function writeWriterReceipt(root: string, library: WriterLibrary): WriterReceipt {
  const receipt = computeWriterReceipt(library);
  const resolvedRoot = realpathSync(root);
  if (!lstatSync(resolvedRoot).isDirectory()) throw new Error("Writer root must be a directory");
  const directory = join(resolvedRoot, ".generated");
  const destination = join(directory, "writer-receipt.json");
  try { mkdirSync(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  assertDestination(directory, destination);
  const temporary = join(directory, `.writer-receipt-${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  let created = false;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    created = true;
    writeFileSync(descriptor, `${canonicalWriterJSON(receipt)}\n`, "utf8");
    closeSync(descriptor);
    descriptor = undefined;
    assertDestination(directory, destination);
    renameSync(temporary, destination);
    created = false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (created) rmSync(temporary, { force: true });
  }
  return receipt;
}
