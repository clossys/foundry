import stack from "../layouts/fills/foundry/layouts.stack.json" with { type: "json" };
import split from "../layouts/fills/foundry/layouts.split.json" with { type: "json" };
import sidebar from "../layouts/fills/foundry/layouts.sidebar-content.json" with { type: "json" };
import bento from "../layouts/fills/foundry/layouts.bento.json" with { type: "json" };
import { sha256 } from "../planning/digest.js";
import type { LayoutRendererSource } from "./instance-binding.js";
/** The existing authored fill records remain the sole public source-pin authority. */
export const REGISTERED_LAYOUT_FILLS = [stack, split, sidebar, bento] as const;
export function registeredLayoutSourcePin(leaf: string) {
  const fill = REGISTERED_LAYOUT_FILLS.find(fill => fill.leaf === leaf);
  const entry = fill?.pin.files.find(file => /^src\/web\/layouts\/[^/]+\.tsx$/.test(file.path))?.path.slice(4);
  return fill && entry ? { fill, entry, export: entry.split("/").at(-1)!.slice(0, -4), files: Object.fromEntries(fill.pin.files.map(file => [file.path.slice(4), `sha256:${file.sha256}`])) } : undefined;
}
/** Match only the existing authored source closure, independent of React renderers. */
export function registeredLayoutSourceMatches(leaf: string, source: LayoutRendererSource): boolean {
  const pin = registeredLayoutSourcePin(leaf);
  return !!pin && source.entry === pin.entry && Object.keys(source.files).sort().join(",") === Object.keys(pin.files).sort().join(",") && Object.entries(pin.files).every(([file, hash]) => `sha256:${sha256(source.files[file]!)}` === hash);
}
