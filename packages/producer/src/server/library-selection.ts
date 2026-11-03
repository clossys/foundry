/**
 * Studio selection and brand from the Designer slot model (`clossys/agents/designer`): each
 * slot's `pin.json` and the shadcn registry item candidate it names. The legacy Designer fills
 * schema is only read when the consumer has no Designer slot model.
 */
import { join } from "node:path";
import { listSlots, readCandidate } from "../records/slots.js";
import { hasAgentSlots } from "./slot-gallery.js";
import { themeHash, type StudioTheme } from "./theme-default.js";

export interface LibrarySelection {
  hash: string;
  leaves: { leaf: string; source: "consumer"; fill: string; hash?: string }[];
  gateReports: never[];
}

/** The consumer's `clossys/` root, when it carries a Designer slot model. */
export function libraryWorkspace(root: string): string | undefined {
  const library = join(root, "clossys");
  return hasAgentSlots(library, "designer") ? library : undefined;
}

/** A pinned candidate's registry item, only while its bytes still match the pin. */
function pinnedItems(library: string): Map<string, { item: Record<string, any>; version: number; sha256: string }> {
  const items = new Map<string, { item: Record<string, any>; version: number; sha256: string }>();
  for (const entry of listSlots(library, "designer")) {
    if (!entry.pin || !entry.candidates.includes(entry.pin.candidate)) continue;
    try {
      const candidate = readCandidate(library, "designer", entry.id, entry.pin.candidate);
      const item = JSON.parse(candidate.bytes);
      const version = Number(/-v([1-9][0-9]*)\.json$/.exec(entry.pin.candidate)?.[1] ?? 0);
      if (candidate.sha256 === entry.pin.sha256 && typeof item?.name === "string" && version) items.set(entry.id, { item, version, sha256: candidate.sha256 });
    } catch { /* an unreadable pin is not part of the selection */ }
  }
  return items;
}

/** One leaf per pinned slot, provenance `consumer`, hashed from the pins it reads. */
export function librarySelection(library: string): LibrarySelection {
  const leaves = [...pinnedItems(library)].sort(([a], [b]) => a.localeCompare(b))
    .map(([leaf, pin]) => ({ leaf, source: "consumer" as const, fill: `${pin.item.name}@v${pin.version}`, hash: `sha256:${pin.sha256}` }));
  return { hash: themeHash(JSON.stringify(leaves)), leaves, gateReports: [] };
}

const CSS_NAME = /^[a-z][a-z0-9-]*$/;
const CSS_VALUE = /^[^;{}<>]+$/;
const declarations = (vars: unknown) => Object.entries(vars && typeof vars === "object" ? vars as Record<string, unknown> : {})
  .filter(([name, value]) => CSS_NAME.test(name) && typeof value === "string" && CSS_VALUE.test(value))
  .map(([name, value]) => `  --${name}: ${value};`);

/**
 * The pinned `themes.*` slots composed into Studio's brand stylesheet: each `registry:theme`
 * item's shadcn variables (theme and light on `:root`, dark on `.dark`) and each
 * `registry:font` item's variable. Undefined when the consumer pins no theme slot.
 */
export function libraryTheme(library: string): StudioTheme | undefined {
  const themes = [...pinnedItems(library)].filter(([slot]) => slot.startsWith("themes.")).sort(([a], [b]) => a.localeCompare(b));
  if (!themes.length) return undefined;
  const root: string[] = [], dark: string[] = [];
  for (const [, { item }] of themes) {
    if (item.type === "registry:font") {
      const font = item.font;
      const name = String(font?.variable ?? "").replace(/^--/, "");
      if (CSS_NAME.test(name) && typeof font?.family === "string" && CSS_VALUE.test(font.family)) root.push(`  --${name}: ${font.family};`);
      continue;
    }
    root.push(...declarations(item.cssVars?.theme), ...declarations(item.cssVars?.light));
    dark.push(...declarations(item.cssVars?.dark));
  }
  if (!root.length && !dark.length) return undefined;
  const css = [`:root {\n${root.join("\n")}\n}`, `.dark {\n${dark.join("\n")}\n}`, ""].join("\n");
  return { source: "consumer", css, hash: themeHash(css) };
}
