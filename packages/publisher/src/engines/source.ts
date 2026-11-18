import stack from "./sources/stack.json" with { type: "json" };
import split from "./sources/split.json" with { type: "json" };
import sidebar from "./sources/sidebar-content.json" with { type: "json" };
import bento from "./sources/bento.json" with { type: "json" };
import { sha256 } from "../planning/digest.js";
import type { LayoutRendererSource } from "../core/instance-binding.js";
/**
 * The byte digests of each render engine's shipped source closure. These are integrity records for an internal render
 * primitive, not slot candidates: an engine is never pinned, and a page chooses one only through its `layout.*` slot.
 */
export const ENGINE_SOURCES = [stack, split, sidebar, bento] as const;
export function engineSource(engine: string) {
  const record = ENGINE_SOURCES.find(record => record.engine === engine);
  const entry = record?.files.find(file => /^src\/web\/engines\/[^/]+\.tsx$/.test(file.path))?.path.slice(4);
  return record && entry ? { record, entry, export: entry.split("/").at(-1)!.slice(0, -4), files: Object.fromEntries(record.files.map(file => [file.path.slice(4), `sha256:${file.sha256}`])) } : undefined;
}
/** Match only the engine's shipped source closure, independent of React renderers. */
export function engineSourceMatches(engine: string, source: LayoutRendererSource): boolean {
  const known = engineSource(engine);
  return !!known && source.entry === known.entry && Object.keys(source.files).sort().join(",") === Object.keys(known.files).sort().join(",") && Object.entries(known.files).every(([file, hash]) => `sha256:${sha256(source.files[file]!)}` === hash);
}
