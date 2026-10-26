import tokenSlots from "../catalog/slots/tokens.json" with { type: "json" };
import source from "../catalog/sources/shadcn-aria.json" with { type: "json" };
import type { FillDoc, Slot, Source } from "../catalog-core/types.js";
import { parseDeclarationsForSelector } from "../tokens/internal/parse-css.js";
import { cells, sourceSha256, type ImportedValue } from "./shared.js";

export const SHADCN_MEMBERS: Readonly<Record<string, readonly [string, string]>> = {
  background: ["surface-color", "base"], foreground: ["text-color", "primary"], card: ["surface-color", "raised"], popover: ["surface-color", "overlay"],
  primary: ["accent-color", "default"], "primary-foreground": ["text-color", "on-accent"], secondary: ["control-color", "tonal"], muted: ["surface-color", "sunken"],
  "muted-foreground": ["text-color", "muted"], accent: ["surface-color", "selected"], destructive: ["status-color", "danger"], border: ["border-color", "base"], input: ["border-color", "strong"], ring: ["focus-color", "default"], radius: ["radius", "default"],
  ...Object.fromEntries([1, 2, 3, 4, 5].map(n => [`chart-${n}`, ["categorical-color", String(n)] as const])),
};

/** Import the pinned shared neutral theme; aria adds no token variables of its own. */
export function importShadcnAria(input: { css: string; slots?: readonly Slot[] }): FillDoc[] {
  const light = parseDeclarationsForSelector(input.css, ":root");
  const dark = parseDeclarationsForSelector(input.css, ".dark");
  if (sourceSha256(input.css) !== source.pin.sha256) throw new Error("importer: source bytes differ from the pinned shadcn-aria source");
  const values: ImportedValue[] = [];
  const unmapped: string[] = [];
  for (const [property, text] of light) {
    const target = SHADCN_MEMBERS[property.slice(2)];
    if (!target) { unmapped.push(property); continue; }
    values.push({ leaf: target[0], member: target[1], text, ...(dark.has(property) ? { dark: dark.get(property)! } : {}) });
  }
  for (const property of dark.keys()) if (!light.has(property)) unmapped.push(property);
  return cells({ values, slots: input.slots ?? tokenSlots as unknown as readonly Slot[], source: source as Source, sourceAddress: "src/importers/vendor/shadcn-aria.css", unmapped });
}
