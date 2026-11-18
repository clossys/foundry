/**
 * Retired-id read check (foundry-build-0037). A retired id is recorded once, in the retired data that retires it; any
 * other mention of it in the Publisher package is a live read and fails. There is no baseline and no allowlist: the
 * only files skipped are the retired data themselves, recognised by shape, never by name.
 *
 * Retired ids: Designer's `src/catalog/retired.json` plus the in-place retirements of its IA extensions, and
 * Publisher's `src/catalog/retired.json`. Retired data: a `retired.json` registry, a file under a `retired/`
 * directory, a JSON document that marks itself retired (a top-level `retired` marker of retiredAt, decidedBy and
 * reason), and a signed leaf-membership freeze (`*.leaf-freeze.json`), which is never edited.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLISHER_RETIRED, loadDesignerCatalog } from "../../catalog/ia/tree.js";

export const publisherRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface RetiredRead { readonly file: string; readonly line: number; readonly id: string }

/** Every retired id Publisher must not read: Designer's and Publisher's own. */
export function retiredIds(): ReadonlySet<string> {
  return new Set([...loadDesignerCatalog().retired, ...PUBLISHER_RETIRED.map(entry => entry.id)]);
}

const SKIPPED_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git", ".turbo", ".cache"]);
const TEXT = /\.(?:[cm]?[jt]sx?|json|md|css|html|txt|ya?ml)$/;

const marker = (value: unknown): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const retired = (value as Record<string, unknown>).retired;
  if (!retired || typeof retired !== "object" || Array.isArray(retired)) return false;
  return ["retiredAt", "decidedBy", "reason"].every(key => typeof (retired as Record<string, unknown>)[key] === "string");
};

/** True for the retired data that records retirements; everything else is checked. */
export function isRetiredData(path: string, text: string): boolean {
  const parts = path.split(sep);
  const name = parts.at(-1)!;
  if (name === "retired.json" || name.endsWith(".leaf-freeze.json") || parts.slice(0, -1).includes("retired")) return true;
  if (!name.endsWith(".json")) return false;
  try { return marker(JSON.parse(text)); } catch { return false; }
}

function files(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (!SKIPPED_DIRS.has(entry.name)) walk(path); }
      else if (entry.isFile() && TEXT.test(entry.name)) out.push(path);
    }
  };
  walk(root);
  return out.sort();
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A retired id is read where it appears whole: not inside a longer id, path segment or dotted name. */
export function retiredPattern(ids: ReadonlySet<string>): RegExp {
  const alternatives = [...ids].sort((a, b) => b.length - a.length || a.localeCompare(b)).map(escape).join("|");
  return new RegExp(`(?<![A-Za-z0-9_.-])(${alternatives})(?![A-Za-z0-9_-])`, "g");
}

/** Every live read of a retired id under `root`, in file and line order. */
export function findRetiredReads(root: string = publisherRoot, ids: ReadonlySet<string> = retiredIds()): RetiredRead[] {
  if (!ids.size) throw new TypeError("No retired ids loaded; the retired data is unavailable");
  const pattern = retiredPattern(ids);
  const reads: RetiredRead[] = [];
  for (const path of files(root)) {
    const text = readFileSync(path, "utf8");
    const file = relative(root, path);
    if (isRetiredData(file, text)) continue;
    text.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(pattern)) reads.push({ file: file.split(sep).join("/"), line: index + 1, id: match[1]! });
    });
  }
  return reads;
}
