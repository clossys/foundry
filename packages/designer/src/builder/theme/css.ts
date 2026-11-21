import { createHash } from "node:crypto";
import { applyLibraryChange, emit, libraryHash, loadCatalog, resolve } from "../../catalog-core/index.js";
import type { LibraryData } from "../../catalog-core/index.js";
import type { ThemeProjection } from "./types.js";

/** `:root { }` for light and `.dark { }` for dark, one declaration per line, in projection order. */
export function toCss(vars: ThemeProjection["vars"]): string {
  const lines = (group: ThemeProjection["vars"]["light"]) => Object.entries(group).map(([name, value]) => `  ${name}: ${value};`).join("\n");
  return [`:root {\n${lines(vars.light)}\n}`, `.dark {\n${lines(vars.dark)}\n}`, ""].join("\n");
}

/** The package theme stylesheet for a Designer library: the catalog's own resolver and emitter. */
export function themeCss(library: LibraryData): string {
  const profile = resolve({ catalog: loadCatalog(), library });
  // Fonts are emitted as package imports for a build tool, not browser URLs.
  // Profile identity and adoption provenance are not visual output.
  return emit(profile, ["css-brand", "css-scales"], { full: true, header: false }).map(file => file.contents).join("\n");
}

let packageDefault: string | undefined;
/**
 * The package default theme, used when a consumer pins no `themes.*` slot: one offer per themes
 * leaf, preferring Foundry, then the shadcn preset, then Tailwind's theme.
 */
export function defaultThemeCss(): string {
  if (packageDefault === undefined) {
    const catalog = loadCatalog();
    const empty: LibraryData = { source: { id: "studio", kind: "consumer", author: "consumer", license: "MIT", extends: "foundry" }, adoptedAt: "2026-10-29", fills: [] };
    const rank = (source: string) => { const index = ["foundry", "shadcn@aria", "tailwind-default"].indexOf(source); return index < 0 ? 3 : index; };
    const chosen = new Map<string, string>();
    for (const fill of catalog.fills) {
      const meta = fill.$extensions["com.clossys.fill"];
      if (!meta.slot.startsWith("themes.") || meta.mode === "reference") continue;
      const previous = chosen.get(meta.slot);
      if (previous === undefined || rank(meta.source) < rank(previous)) chosen.set(meta.slot, meta.source);
    }
    const library = applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: [...chosen].map(([slot, source]) => ({ op: "adopt", slot, source })) });
    packageDefault = themeCss(library);
  }
  return packageDefault;
}

/** Hash the exact CSS bytes that the browser binds. */
export function themeHash(css: string): string { return `sha256:${createHash("sha256").update(css, "utf8").digest("hex")}`; }
