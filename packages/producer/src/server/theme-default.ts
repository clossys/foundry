import { createHash } from "node:crypto";
import { applyLibraryChange, emit, libraryHash, loadCatalog, resolve, type LibraryData } from "@clossys/designer/catalog";

export interface StudioTheme {
  source: "consumer" | "foundry";
  css: string;
  hash: string;
  /** A failed consumer theme remains distinguishable from an uninitialized one. */
  message?: string;
}

let foundryTheme: StudioTheme | undefined;
/** The same catalog adoption and CSS emitter used by a Designer library. */
export function defaultStudioTheme(): StudioTheme {
  if (!foundryTheme) {
    const catalog = loadCatalog();
    const empty: LibraryData = { source: { id: "studio", kind: "consumer", author: "consumer", license: "MIT", extends: "foundry" }, adoptedAt: "2026-10-29", fills: [] };
    const library = applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: catalog.fills.filter(fill => {
      const meta = fill.$extensions["com.clossys.fill"];
      return meta.source === "foundry" && meta.slot.startsWith("tokens.");
    }).map(fill => ({ op: "adopt", slot: fill.$extensions["com.clossys.fill"].slot, source: "foundry" })) });
    const css = themeCss(library);
    foundryTheme = { source: "foundry", css, hash: themeHash(css) };
  }
  return { ...foundryTheme };
}

export function themeCss(library: LibraryData): string {
  const profile = resolve({ catalog: loadCatalog(), library });
  // Fonts are emitted as package imports for a build tool, not browser URLs.
  // Profile identity and adoption provenance are not visual output.
  return emit(profile, ["css-brand", "css-scales"], { full: true, header: false }).map(file => file.contents).join("\n");
}

/** Hash the exact CSS bytes that the browser binds. */
export function themeHash(css: string): string { return `sha256:${createHash("sha256").update(css, "utf8").digest("hex")}`; }
