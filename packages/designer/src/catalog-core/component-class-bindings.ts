import type { ComponentCheckInput } from "./check-components.js";

/**
 * Class -> token-member bindings read from a compiled stylesheet, in the
 * `evidence.classBindings` shape the component check consumes.
 *
 * A class is bound only when its compiled rule is a plain single-class selector
 * whose every declaration value is one `var(--property[, fallback])` and all of
 * those properties name the same, unambiguous consumer token member. Anything
 * else (literal values, mixed properties, variants, shared properties) stays
 * unbound, so the check keeps reporting it.
 */
export function bindCompiledClasses(css: string, tokens: ComponentCheckInput["tokens"]): Record<string, string> {
  const byProperty = new Map<string, string[]>();
  for (const [member, token] of Object.entries(tokens)) byProperty.set(token.property, [...(byProperty.get(token.property) ?? []), member]);
  const seen = new Map<string, string | null>();
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of text.matchAll(/(?<=^|[;{}])\s*\.((?:\\.|[A-Za-z0-9_-])+)\s*\{([^{}]*)\}/g)) {
    const name = rule[1]!.replace(/\\(.)/g, "$1");
    const declarations = rule[2]!.split(";").map(part => part.trim()).filter(Boolean);
    const members = new Set<string>();
    let bound = declarations.length > 0;
    for (const declaration of declarations) {
      const value = /^[a-z-]+\s*:\s*var\(\s*(--[A-Za-z0-9-]+)\s*(?:,[^()]*(?:\([^()]*\)[^()]*)*)?\)\s*$/.exec(declaration);
      const candidates = value ? byProperty.get(value[1]!) ?? [] : [];
      if (candidates.length !== 1) { bound = false; break; }
      members.add(candidates[0]!);
    }
    const member = bound && members.size === 1 ? [...members][0]! : null;
    // A class compiled more than once with different meanings is ambiguous.
    seen.set(name, seen.has(name) && seen.get(name) !== member ? null : member);
  }
  return Object.fromEntries([...seen].filter((entry): entry is [string, string] => entry[1] !== null).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
