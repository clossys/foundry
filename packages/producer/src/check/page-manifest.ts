import { open } from "node:fs/promises";
import type { PageManifest, PageTarget } from "./page-types.js";

const HEAD = /^[a-f0-9]{40}$/;
const MAX_PAGES = 2_000;

async function jsonFile(path: string | URL, maxBytes: number): Promise<unknown> {
  const file = await open(path, "r");
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maxBytes) throw new Error("PROC-5 requires a bounded, nonempty regular JSON file.");
    const content = await file.readFile({ encoding: "utf8" });
    if (Buffer.byteLength(content) > maxBytes) throw new Error("PROC-5 JSON input exceeds its byte budget.");
    return JSON.parse(content);
  } finally {
    await file.close();
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function page(value: unknown): value is PageTarget {
  if (!record(value) || !exactKeys(value, ["url", "cellIds"]) || typeof value.url !== "string" || !Array.isArray(value.cellIds)) return false;
  try {
    const url = new URL(value.url);
    if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      || url.username || url.password || url.hash) return false;
  } catch { return false; }
  return value.cellIds.length <= 20_000 && value.cellIds.every(id => typeof id === "string" && id.length > 0 && id.length <= 512 && id.trim() === id)
    && new Set(value.cellIds).size === value.cellIds.length;
}

/** PROC-6 supplies the generated canonical route inventory; absence is never an empty PASS. */
export async function readPageManifest(path: string): Promise<PageManifest> {
  const value = await jsonFile(path, 16 * 1024 * 1024);
  if (!record(value) || !exactKeys(value, ["schemaVersion", "sourceHead", "pages"]) || value.schemaVersion !== 1
    || typeof value.sourceHead !== "string" || !HEAD.test(value.sourceHead) || !Array.isArray(value.pages)
    || value.pages.length === 0 || value.pages.length > MAX_PAGES || !value.pages.every(page)
    || new Set(value.pages.map(target => new URL(target.url).href)).size !== value.pages.length) {
    throw new Error("PROC-5 requires a version-1 manifest with a full source head and a nonempty, unique loopback page inventory with explicit cellIds.");
  }
  return value as unknown as PageManifest;
}

/** Written by the native Producer build and carried in the packed artifact. */
export async function readPageCheckSource(): Promise<{ sourceHead: string; sourceDirty: boolean }> {
  const value = await jsonFile(new URL("./source-receipt.json", import.meta.url), 8_192);
  if (!record(value) || !exactKeys(value, ["schemaVersion", "sourceHead", "sourceDirty"]) || value.schemaVersion !== 1
    || typeof value.sourceHead !== "string" || !HEAD.test(value.sourceHead) || typeof value.sourceDirty !== "boolean") {
    throw new Error("PROC-5 native build source receipt is missing or invalid; rebuild the artifact from its pinned source.");
  }
  return { sourceHead: value.sourceHead, sourceDirty: value.sourceDirty };
}
