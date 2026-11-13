/**
 * The stock shadcn `--color-<leaf>: var(--<leaf>)` utility keys, emitted from the
 * themes layer (`src/catalog/slots/themes.json`) into a generated region of
 * `styles/theme-keys.css`'s `@theme inline` block. One key per themes colour token,
 * named after the token's own emitted variable, so `bg-background`, `border-border`,
 * `text-muted-foreground` and the `sidebar-*` utilities read the selected theme.
 *
 * A hand-authored legacy key outside the region that already claims a generated name
 * (`--color-accent`, the legacy Foundry brand colour) is a collision: the generator
 * never overwrites it and reports it instead, so the region never changes what a legacy
 * utility means. `styles/legacy-color-map.json` records where each legacy key goes.
 */

export const SHADCN_KEYS_BEGIN = "/* BEGIN GENERATED shadcn colour keys: emitted from src/catalog/slots/themes.json by src/compiled-css/shadcn-theme-keys.ts (npm run generate:compiled-css). Do not edit. */";
export const SHADCN_KEYS_END = "/* END GENERATED shadcn colour keys */";

export interface ThemesTokenSlot {
  id: string;
  contract: { $type?: string; emit?: Record<string, string> };
}

export interface ShadcnColorKeys {
  /** `--color-<leaf>: var(--<leaf>);` declarations, sorted by key. */
  declarations: string[];
  /** Generated key names a hand-authored legacy key already claims; never emitted. */
  collisions: string[];
}

const THEME_INLINE = "@theme inline {";

function region(css: string): { start: number; end: number } | undefined {
  const start = css.indexOf(SHADCN_KEYS_BEGIN);
  if (start < 0) return undefined;
  const endMarker = css.indexOf(SHADCN_KEYS_END, start);
  if (endMarker < 0) throw new Error("styles/theme-keys.css: generated shadcn key region has no end marker");
  return { start, end: endMarker + SHADCN_KEYS_END.length };
}

/** The first `@theme inline` block's body with the generated region removed: what hand-authored keys claim. */
export function handAuthoredThemeKeys(css: string): Set<string> {
  const at = region(css);
  const rest = at ? css.slice(0, at.start) + css.slice(at.end) : css;
  const open = rest.indexOf(THEME_INLINE);
  if (open < 0) throw new Error("styles/theme-keys.css: no `@theme inline` block");
  const close = rest.indexOf("\n}", open);
  const body = rest.slice(open + THEME_INLINE.length, close < 0 ? undefined : close).replace(/\/\*[\s\S]*?\*\//g, "");
  return new Set([...body.matchAll(/^\s*(--[a-zA-Z0-9-]+)\s*:/gm)].map(match => match[1]!));
}

export function shadcnColorKeys(themes: readonly ThemesTokenSlot[], themeKeysCss: string): ShadcnColorKeys {
  const claimed = handAuthoredThemeKeys(themeKeysCss);
  const keys = new Map<string, string>();
  const collisions: string[] = [];
  for (const token of themes) {
    if (token.contract.$type !== "color") continue;
    const target = token.contract.emit?.default;
    if (!target || !/^--[a-z][a-z0-9-]*$/.test(target)) throw new Error(`${token.id}: a themes colour token emits no single default variable`);
    const key = `--color-${target.slice(2)}`;
    if (claimed.has(key)) { collisions.push(key); continue; }
    keys.set(key, `${key}: var(${target});`);
  }
  return {
    declarations: [...keys.keys()].sort().map(key => keys.get(key)!),
    collisions: collisions.sort(),
  };
}

/** `styles/theme-keys.css` with its generated region replaced (or inserted first in the `@theme inline` block). */
export function renderThemeKeys(themes: readonly ThemesTokenSlot[], themeKeysCss: string): string {
  const { declarations } = shadcnColorKeys(themes, themeKeysCss);
  const block = [SHADCN_KEYS_BEGIN, ...declarations.map(line => `  ${line}`), `  ${SHADCN_KEYS_END}`].join("\n");
  const at = region(themeKeysCss);
  if (at) {
    const lineStart = themeKeysCss.lastIndexOf("\n", at.start) + 1;
    return themeKeysCss.slice(0, lineStart) + `  ${block}` + themeKeysCss.slice(at.end);
  }
  const open = themeKeysCss.indexOf(THEME_INLINE);
  if (open < 0) throw new Error("styles/theme-keys.css: no `@theme inline` block");
  const insert = open + THEME_INLINE.length;
  return `${themeKeysCss.slice(0, insert)}\n  ${block}${themeKeysCss.slice(insert)}`;
}
