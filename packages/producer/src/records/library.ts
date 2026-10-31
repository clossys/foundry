import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { hashFiles, listFiles } from "./hash.js";
import type { SchemaIssue } from "./schema.js";
import type { ElementRecord, PreviewRecord } from "./types.js";
import { loadElement, loadPreview, RecordError, validateElement, validatePreview } from "./validate.js";

/**
 * Consumer library layout: `library/<slot>/<element>/v<n>/`. A version
 * directory is immutable once written; a change is always a new version.
 */
export const ELEMENT_FILE = "element.json";
export const PREVIEW_FILE = "preview.json";
const RECORD_FILES = new Set([ELEMENT_FILE, PREVIEW_FILE]);
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9.-]*$/;

function segment(value: string, what: string): string {
  if (!SAFE_SEGMENT.test(value) || value.includes("..")) throw new Error(`unsafe ${what} "${value}"`);
  return value;
}

export function elementDir(libraryRoot: string, slot: string, element: string): string {
  return join(libraryRoot, segment(slot, "slot"), segment(element, "element"));
}

export function versionDir(libraryRoot: string, slot: string, element: string, version: number): string {
  if (!Number.isInteger(version) || version < 1) throw new Error(`invalid version ${version}`);
  return join(elementDir(libraryRoot, slot, element), `v${version}`);
}

/** Versions present on disk for one element, ascending. */
export function listVersions(libraryRoot: string, slot: string, element: string): number[] {
  const dir = elementDir(libraryRoot, slot, element);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => /^v([1-9][0-9]*)$/.exec(name)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

/** Payload files of a version directory: the declared list, or every file but the two record files. */
export function payloadFiles(dir: string, record: Pick<ElementRecord, "payload">): string[] {
  return record.payload ? [...record.payload].sort() : listFiles(dir).filter((path) => !RECORD_FILES.has(path));
}

export type ElementVersion = {
  readonly dir: string;
  readonly element: ElementRecord;
  readonly preview: PreviewRecord;
};

export function readElementVersion(libraryRoot: string, slot: string, element: string, version: number): ElementVersion {
  const dir = versionDir(libraryRoot, slot, element, version);
  const record = loadElement(join(dir, ELEMENT_FILE));
  const expected = { slot, id: element, version };
  for (const [key, value] of Object.entries(expected)) {
    if (record[key as keyof typeof expected] !== value) {
      throw new RecordError(`element record ${dir}`, [{ path: `$.${key}`, message: `must be ${value} to match its directory` }]);
    }
  }
  return { dir, element: record, preview: loadPreview(join(dir, PREVIEW_FILE)) };
}

/** Recompute the payload hash and compare it with element.json. Detects an edit after write. */
export function verifyElementVersion(libraryRoot: string, slot: string, element: string, version: number): SchemaIssue[] {
  let read: ElementVersion;
  try {
    read = readElementVersion(libraryRoot, slot, element, version);
  } catch (error) {
    if (error instanceof RecordError) return [...error.issues];
    throw error;
  }
  const files = payloadFiles(read.dir, read.element);
  for (const path of files) {
    if (!existsSync(join(read.dir, path))) return [{ path: `$.payload`, message: `missing payload file ${path}` }];
  }
  const actual = hashFiles(read.dir, files);
  return actual === read.element.hash ? [] : [{ path: "$.hash", message: `payload hash ${actual} differs from the record` }];
}

export type NewElementVersion = {
  /** element.json without `hash` and `version`; both are computed here. */
  readonly element: Omit<ElementRecord, "hash" | "version">;
  readonly preview: PreviewRecord;
  /** Payload files, path relative to the version directory. */
  readonly files: Readonly<Record<string, string | Uint8Array>>;
};

/**
 * Write the next version of an element. Refuses to touch an existing version
 * directory, validates both records first, and publishes the directory with a
 * single rename so a half-written version is never visible.
 */
export function writeElementVersion(libraryRoot: string, input: NewElementVersion): ElementVersion {
  const { slot, id } = input.element;
  const version = (listVersions(libraryRoot, slot, id).at(-1) ?? 0) + 1;
  const dir = versionDir(libraryRoot, slot, id, version);
  if (existsSync(dir)) throw new Error(`${dir} already exists; versions are immutable`);
  const paths = Object.keys(input.files).sort();
  if (paths.length === 0) throw new Error("an element version needs at least one payload file");
  for (const path of paths) {
    if (RECORD_FILES.has(path) || path.startsWith("/") || path.split("/").includes("..")) {
      throw new Error(`invalid payload path "${path}"`);
    }
  }

  const staging = `${dir}.staging-${process.pid}-${Date.now()}`;
  mkdirSync(staging, { recursive: true });
  try {
    for (const path of paths) {
      const target = join(staging, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, input.files[path]!);
    }
    const element = { ...input.element, version, hash: hashFiles(staging, paths), payload: input.element.payload ?? paths };
    const checked = validateElement(element);
    if (!checked.ok) throw new RecordError(`new element ${slot}/${id}/v${version}`, checked.issues);
    const preview = validatePreview(input.preview);
    if (!preview.ok) throw new RecordError(`new preview ${slot}/${id}/v${version}`, preview.issues);
    writeFileSync(join(staging, ELEMENT_FILE), `${JSON.stringify(checked.value, null, 2)}\n`);
    writeFileSync(join(staging, PREVIEW_FILE), `${JSON.stringify(preview.value, null, 2)}\n`);
    if (existsSync(dir)) throw new Error(`${dir} already exists; versions are immutable`);
    renameSync(staging, dir);
    return { dir, element: checked.value, preview: preview.value };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}
