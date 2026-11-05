/**
 * Legacy Foundry colour names in source above Components. `styles/legacy-color-map.json`
 * records, once, where every legacy `--color-<name>` key goes: the stock shadcn semantic
 * variable with the same role, or null when shadcn has no variable for that role.
 *
 * `legacyColorUses` finds every legacy name a source still uses, as a colour utility
 * (`bg-surface-base`, `hover:text-ink-primary/80`) or as a custom property
 * (`var(--color-line-base)`). `recomposeLegacyColors` is the H-TOKEN swap: each mapped
 * use becomes the same-kind shadcn theme-variable utility (`bg-background`) or variable
 * (`var(--border)`); a use with no shadcn role is left exactly as it is.
 */

export interface LegacyColorTarget { shadcn: string | null; role: string }
export interface LegacyColorMap { map: Readonly<Record<string, LegacyColorTarget>> }
export interface LegacyColorUse {
  file: string;
  line: number;
  /** The legacy name as written: a utility (`hover:bg-surface-sunken`) or a property (`--color-line-base`). */
  use: string;
  legacy: string;
  /** The shadcn variable this use maps to, or null when the map records no shadcn role. */
  shadcn: string | null;
}

const COLOR_PREFIXES = ["bg", "text", "border", "border-x", "border-y", "border-t", "border-r", "border-b", "border-l", "border-s", "border-e", "divide", "ring", "ring-offset", "outline", "fill", "stroke", "decoration", "accent", "caret", "from", "via", "to", "shadow", "placeholder"];
const byLength = (names: readonly string[]) => [...names].sort((a, b) => b.length - a.length || a.localeCompare(b));
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

function patterns(map: LegacyColorMap) {
  const legacy = byLength(Object.keys(map.map)).map(escape).join("|");
  const prefix = byLength(COLOR_PREFIXES).map(escape).join("|");
  return {
    // A utility token: optional variants, optional important, prefix-name, optional /modifier, optional trailing important.
    utility: new RegExp(`(?<![\\w-])((?:[^\\s"'\`{}();,<>]*:)?!?)(${prefix})-(${legacy})(?=(?:/[\\w.\\[\\]%-]+)?!?(?![\\w-]))`, "g"),
    property: new RegExp(`--color-(${legacy})(?![\\w-])`, "g"),
  };
}

const lineAt = (content: string, index: number) => content.slice(0, index).split("\n").length;

export function legacyColorUses(sources: readonly { path: string; content: string }[], map: LegacyColorMap): LegacyColorUse[] {
  const { utility, property } = patterns(map);
  const uses: LegacyColorUse[] = [];
  for (const source of sources) {
    for (const match of source.content.matchAll(utility)) {
      const legacy = match[3]!;
      uses.push({ file: source.path, line: lineAt(source.content, match.index!), use: `${match[1]}${match[2]}-${legacy}`, legacy, shadcn: map.map[legacy]!.shadcn });
    }
    for (const match of source.content.matchAll(property)) {
      const legacy = match[1]!;
      uses.push({ file: source.path, line: lineAt(source.content, match.index!), use: `--color-${legacy}`, legacy, shadcn: map.map[legacy]!.shadcn });
    }
  }
  return uses.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.use.localeCompare(b.use));
}

/** The H-TOKEN swap over one source: every mapped legacy name to its shadcn utility or variable; unmapped names unchanged. */
export function recomposeLegacyColors(content: string, map: LegacyColorMap): string {
  const { utility, property } = patterns(map);
  return content
    .replace(utility, (whole, lead: string, prefix: string, legacy: string) => {
      const target = map.map[legacy]!.shadcn;
      return target ? `${lead}${prefix}-${target}` : whole;
    })
    .replace(property, (whole, legacy: string) => {
      const target = map.map[legacy]!.shadcn;
      return target ? `--${target}` : whole;
    });
}
