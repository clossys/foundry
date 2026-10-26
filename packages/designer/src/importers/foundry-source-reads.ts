/**
 * Token reads a Foundry component's own source actually consumes, derived from
 * the shipped CSS properties each token slot emits. Pure text in, slot ids out:
 * callers supply the source bytes, so this module never touches the filesystem.
 */
export interface EmittingSlot {
  id: string;
  contract: { kind: string; emit?: Readonly<Record<string, string>> };
}
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** Shipped CSS property -> token slot id, from every token contract's explicit `emit` binding. */
export function tokenPropertyIndex(slots: readonly EmittingSlot[]): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const slot of slots) {
    if (slot.contract.kind !== "token") continue;
    for (const property of Object.values(slot.contract.emit ?? {})) {
      const owner = index.get(property);
      if (owner && owner !== slot.id) throw new Error(`foundry-source-reads: ${property} is emitted by ${owner} and ${slot.id}`);
      index.set(property, slot.id);
    }
  }
  return index;
}

/** `export const NAME = "..."` string constants (the raw `var()` reads modules such as ui-vars share). */
export function sourceConstants(moduleSource: string): Readonly<Record<string, string>> {
  return Object.fromEntries([...moduleSource.matchAll(/export\s+const\s+([A-Z][A-Z0-9_]*)\s*=\s*"([^"]*)"/g)].map(match => [match[1]!, match[2]!]));
}

/** Outermost `var(--x)` reads only: a fallback `var()` inside another `var()` is not consumed while the outer token resolves. */
function outerVarReads(text: string): string[] {
  const reads: string[] = [];
  const stack: { fallback: boolean }[] = [];
  for (let at = 0; at < text.length; at++) {
    if (text.startsWith("var(", at)) {
      const inFallback = stack.some(frame => frame.fallback);
      const name = /^--[a-zA-Z0-9-]*(?:\$\{)?/.exec(text.slice(at + 4))?.[0];
      if (name && !inFallback) reads.push(name);
      stack.push({ fallback: false });
      at += 3;
      continue;
    }
    const char = text[at];
    if (char === "(" && stack.length) stack.push({ fallback: stack.at(-1)!.fallback });
    else if (char === ")" && stack.length) stack.pop();
    else if (char === "," && stack.length) stack.at(-1)!.fallback = true;
  }
  return reads;
}

const SPACING = /^-?(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y|inset|top|bottom|left|right|start|end)-(.+)$/;
/** Tailwind theme namespaces a named utility can resolve through; every candidate must be an emitted property. */
function utilityProperties(utility: string): string[] {
  const bare = utility.slice(utility.lastIndexOf(":") + 1).replace(/^!/, "");
  const out: string[] = [];
  const key = (prefix: string): string | undefined => bare.startsWith(prefix) ? bare.slice(prefix.length) : undefined;
  for (const [prefix, namespaces] of [["text-", ["--text-", "--color-"]], ["font-", ["--font-", "--font-weight-"]], ["bg-", ["--color-"]], ["border-", ["--color-"]],
    ["outline-", ["--color-"]], ["ring-", ["--color-"]], ["fill-", ["--color-"]], ["stroke-", ["--color-"]], ["divide-", ["--color-"]], ["shadow-", ["--shadow-"]],
    ["leading-", ["--leading-"]], ["tracking-", ["--tracking-"]], ["ease-", ["--ease-"]]] as const) {
    const value = key(prefix);
    if (value) for (const namespace of namespaces) out.push(namespace + value);
  }
  const radius = /^rounded(?:-[trblse]{1,2})?-(.+)$/.exec(bare);
  if (radius) out.push(`--radius-${radius[1]}`);
  const spacing = SPACING.exec(bare);
  if (spacing) out.push(`--spacing-${spacing[1]}`);
  return out;
}

/**
 * Sorted token slot ids the source reads: outer `var()` properties (an interpolated
 * suffix such as `--ui-control-h-${size}` reads every emitted member with that prefix),
 * imported string constants, and named utilities inside string or template literals.
 */
export function foundrySourceTokenReads(source: string, index: ReadonlyMap<string, string>, constants: Readonly<Record<string, string>> = {}): string[] {
  const names = Object.keys(constants).sort((a, b) => b.length - a.length);
  const text = names.length ? source.replace(new RegExp(`\\b(?:${names.join("|")})\\b`, "g"), name => `"${constants[name]}"`) : source;
  const slots = new Set<string>();
  for (const read of outerVarReads(text)) {
    if (read.endsWith("${")) {
      const prefix = read.slice(0, -2);
      for (const [property, slot] of index) if (property.startsWith(prefix) && /^[a-z0-9]+$/.test(property.slice(prefix.length))) slots.add(slot);
    } else if (index.has(read)) slots.add(index.get(read)!);
  }
  for (const literal of text.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)) {
    for (const utility of (literal[1] ?? literal[2] ?? literal[3] ?? "").split(/\s+/)) {
      if (!/^[!a-z0-9:-]+$/.test(utility)) continue;
      for (const property of utilityProperties(utility)) if (index.has(property)) slots.add(index.get(property)!);
    }
  }
  return [...slots].sort(compare);
}
