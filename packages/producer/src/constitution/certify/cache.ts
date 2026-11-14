/**
 * The certification cache (R05): `node_modules/.cache/clossys/certify.json` under the workspace
 * root, never committed. An entry's key is the R16.4 key (candidate, standard, contract, pinSet;
 * no recipe field). The certifier version and the environment hash (TypeScript, React, the lock,
 * the step graph, the criteria registry) sit in the file header: a header that differs discards the
 * whole file, so no key needs a fifth field.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CERTIFY_KEY_FIELDS, type CertifyKey } from "../criteria/core/verdict.js";
import type { Certification } from "./types.js";

export const CACHE_SCHEMA = "clossys.certify-cache/1";
export const CACHE_FILE = "node_modules/.cache/clossys/certify.json";

export interface CertifyCache {
  get(key: CertifyKey): Certification | undefined;
  set(key: CertifyKey, value: Certification): void;
  /** Writes the file when an entry was added or the header changed; returns whether it wrote. */
  save(): boolean;
  readonly hits: number;
  readonly misses: number;
}

export const keyText = (key: CertifyKey): string => CERTIFY_KEY_FIELDS.map(field => key[field]).join(":");

interface CacheFile { readonly schema: string; readonly version: string; readonly env: string; readonly entries: Record<string, Certification> }

/** A cache over `path` (none: in memory only) for one certifier version and environment. */
export function openCache(path: string | undefined, version: string, env: string): CertifyCache {
  let entries: Record<string, Certification> = {};
  let dirty = false;
  if (path) {
    try {
      const doc = JSON.parse(readFileSync(path, "utf8")) as CacheFile;
      if (doc?.schema === CACHE_SCHEMA && doc.version === version && doc.env === env && doc.entries && typeof doc.entries === "object") entries = doc.entries;
      else dirty = true;
    } catch { dirty = true; }
  }
  let hits = 0, misses = 0;
  return {
    get(key) {
      const hit = Object.hasOwn(entries, keyText(key)) ? entries[keyText(key)] : undefined;
      if (hit) hits++; else misses++;
      return hit;
    },
    set(key, value) { entries[keyText(key)] = value; dirty = true; },
    save() {
      if (!path || !dirty) return false;
      mkdirSync(dirname(path), { recursive: true });
      const temp = `${path}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify({ schema: CACHE_SCHEMA, version, env, entries } satisfies CacheFile));
      renameSync(temp, path);
      dirty = false;
      return true;
    },
    get hits() { return hits; },
    get misses() { return misses; },
  };
}

export const cachePath = (root: string): string => join(root, CACHE_FILE);
