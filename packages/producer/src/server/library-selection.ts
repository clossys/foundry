/**
 * Studio selection and brand from a library workspace (`clossys/selection.json`, schema
 * `clossys.selection/1`, pinning shadcn registry items under `clossys/library/`). This is the
 * current library reader; the legacy Designer fills schema is only read when no such workspace
 * exists.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSelection, SELECTION_FILE } from "../records/index.js";
import { themeHash, type StudioTheme } from "./theme-default.js";

export interface LibrarySelection {
  hash: string;
  leaves: { leaf: string; source: "consumer"; fill: string; hash?: string }[];
  gateReports: never[];
}

const SCHEMA = "clossys.selection/1";

/** The library workspace of a consumer root, when it pins items in the current selection format. */
export function libraryWorkspace(root: string): string | undefined {
  const library = join(root, "clossys"), file = join(library, SELECTION_FILE);
  if (!existsSync(file) || !existsSync(join(library, "library"))) return undefined;
  try { return (JSON.parse(readFileSync(file, "utf8")) as { schema?: unknown }).schema === SCHEMA ? library : undefined; } catch { return undefined; }
}

/** One leaf per pinned slot, provenance `consumer`, hashed from the selection file's bytes. */
export function librarySelection(library: string): LibrarySelection {
  const file = join(library, SELECTION_FILE);
  const pins = loadSelection(file).pins;
  return {
    hash: themeHash(readFileSync(file, "utf8")),
    leaves: Object.entries(pins).sort(([a], [b]) => a.localeCompare(b)).map(([leaf, pin]) => ({ leaf, source: "consumer" as const, fill: `${pin.element}@v${pin.version}`, ...(pin.hash ? { hash: pin.hash } : {}) })),
    gateReports: [],
  };
}

const CSS_NAME = /^[a-z][a-z0-9-]*$/;
const CSS_VALUE = /^[^;{}<>]+$/;
const declarations = (vars: unknown) => Object.entries(vars && typeof vars === "object" ? vars as Record<string, unknown> : {})
  .filter(([name, value]) => CSS_NAME.test(name) && typeof value === "string" && CSS_VALUE.test(value))
  .map(([name, value]) => `  --${name}: ${value};`);

/** The pinned theme (and heading font) as Studio's brand stylesheet: shadcn variables for light and dark. */
export function libraryTheme(library: string): StudioTheme | undefined {
  const pins = loadSelection(join(library, SELECTION_FILE)).pins;
  const item = (slot: string) => {
    const pin = pins[slot];
    if (!pin) return undefined;
    try { return JSON.parse(readFileSync(join(library, "library", slot, pin.element, `v${pin.version}`, "registry-item.json"), "utf8")); } catch { return undefined; }
  };
  const theme = item("themes.theme");
  if (!theme?.cssVars) return undefined;
  const font = item("themes.font-heading")?.font;
  const root = [...declarations(theme.cssVars.theme), ...declarations(theme.cssVars.light)];
  if (font && CSS_NAME.test(String(font.variable).replace(/^--/, "")) && typeof font.family === "string" && CSS_VALUE.test(font.family)) root.push(`  ${font.variable}: ${font.family};`);
  const css = [`:root {\n${root.join("\n")}\n}`, `.dark {\n${declarations(theme.cssVars.dark).join("\n")}\n}`, ""].join("\n");
  return { source: "consumer", css, hash: themeHash(css) };
}
