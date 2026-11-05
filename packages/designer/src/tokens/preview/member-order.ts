/**
 * Display order and display text for token leaf members (VR2 studio-03, studio-04).
 * A leaf whose member keys are all scale steps sorts by ordinal (`amber.50` before `amber.100`,
 * `xs` .. `9xl`); otherwise a leaf whose values share one unit sorts by value; otherwise scale
 * steps lead in ordinal order and the rest follow in natural order. Values display resolved:
 * a `var(--name, fallback)` reads as its fallback, and a whole-value alias keeps its name.
 */

/** Size steps, smallest first. `base` and `md` both sit between `sm` and `lg`. */
const SCALE = ["3xs", "2xs", "xs", "s", "sm", "m", "md", "base", "l", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"] as const;
const natural = (a: string, b: string): number => a.localeCompare(b, "en", { numeric: true });

type Ordinal = { kind: 0; rank: number } | { kind: 1; prefix: string; rank: number };
function ordinal(segment: string): Ordinal | undefined {
  const scale = (SCALE as readonly string[]).indexOf(segment);
  if (scale >= 0) return { kind: 0, rank: scale };
  const numbered = /^([a-z]*)(\d+)$/.exec(segment);
  return numbered ? { kind: 1, prefix: numbered[1]!, rank: Number(numbered[2]) } : undefined;
}

const split = (key: string): [string, string] => { const dot = key.lastIndexOf("."); return dot < 0 ? ["", key] : [key.slice(0, dot), key.slice(dot + 1)]; };
function compareOrdinal(a: string, b: string): number {
  const [familyA, stepA] = split(a), [familyB, stepB] = split(b);
  if (familyA !== familyB) return natural(familyA, familyB);
  const x = ordinal(stepA), y = ordinal(stepB);
  if (x && y) {
    if (x.kind !== y.kind) return x.kind - y.kind;
    if (x.kind === 1 && y.kind === 1 && x.prefix !== y.prefix) return natural(x.prefix, y.prefix);
    return x.rank - y.rank;
  }
  if (x || y) return x ? -1 : 1;
  return natural(stepA, stepB);
}

/** Index of the parenthesis closing the one opened at `open`, or -1. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === "(") depth++;
    else if (text[index] === ")" && --depth === 0) return index;
  }
  return -1;
}

/** Every `var(--name, fallback)` replaced by its resolved fallback; a `var()` without one stays. */
export function resolveTokenReferences(css: string): string {
  let out = "", rest = css;
  for (let start = rest.indexOf("var("); start >= 0; start = rest.indexOf("var(")) {
    const end = closing(rest, start + 3);
    if (end < 0) break;
    const inner = rest.slice(start + 4, end), comma = inner.indexOf(",");
    out += rest.slice(0, start) + (comma < 0 ? rest.slice(start, end + 1) : resolveTokenReferences(inner.slice(comma + 1).trim()));
    rest = rest.slice(end + 1);
  }
  return out + rest;
}

/** The value a member displays: resolved, with leading zeros restored; `alias` names a whole-value reference. */
export function displayTokenValue(css: string): { text: string; alias?: string } {
  const trimmed = css.trim();
  const alias = /^var\((--[a-zA-Z][\w-]*)\s*,/.exec(trimmed)?.[1];
  const text = resolveTokenReferences(trimmed).replace(/(^|[^\w.])\.(\d)/g, "$10.$2");
  return alias && closing(trimmed, 3) === trimmed.length - 1 ? { text, alias } : { text };
}

const UNITS: Readonly<Record<string, readonly [string, number]>> = { "": ["number", 1], px: ["length", 1], rem: ["length", 16], em: ["em", 1], ms: ["time", 1], s: ["time", 1000] };
function measure(css: string): readonly [string, number] | undefined {
  const match = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem|em|ms|s)?$/.exec(resolveTokenReferences(css.trim()));
  const unit = match ? UNITS[match[2] ?? ""] : undefined;
  return match && unit ? [unit[0], Number(match[1]) * unit[1]] : undefined;
}

type Entry = { readonly id: string; readonly member: { readonly slot: string; readonly css: { readonly light: string } } };
/** The members of one leaf in display order; a stable copy, the input is never reordered. */
export function orderTokenMembers<T extends Entry>(members: readonly T[]): T[] {
  const keyOf = (entry: T) => entry.id.slice(entry.member.slot.length + 1);
  const keyed = members.map(entry => ({ entry, key: keyOf(entry), value: measure(entry.member.css.light) }));
  const allOrdinal = keyed.every(({ key }) => ordinal(split(key)[1]) !== undefined);
  const ordinals = keyed.filter(({ key }) => ordinal(split(key)[1]) !== undefined).length;
  const unit = keyed[0]?.value?.[0];
  const byValue = !allOrdinal && keyed.length > 1 && keyed.every(({ value }) => value !== undefined && value[0] === unit);
  return keyed
    // A lone scale word in a named leaf (`surface-color.base`) is a name, not a scale: natural order.
    .sort((a, b) => byValue ? a.value![1] - b.value![1] || compareOrdinal(a.key, b.key) : ordinals < 2 ? natural(a.key, b.key) : compareOrdinal(a.key, b.key))
    .map(({ entry }) => entry);
}
