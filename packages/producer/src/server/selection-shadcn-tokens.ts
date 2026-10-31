import type { Resolved, ResolvedMember } from "@clossys/designer/catalog";

/** The installed Designer contract supplies names; the consumer supplies values. */
export interface SelectionShadcnTokenContract {
  readonly leaves: Readonly<Record<string, {
    readonly members?: Readonly<Record<string, { readonly kind: string; readonly target: string; readonly status: string }>>;
  }>>;
  readonly aliases: Readonly<Record<string, string>>;
}

export interface SelectionShadcnTokens {
  /** Browser declarations, using the same explicit and system theme signals as Designer. */
  readonly css: string;
  /** Input for the real Tailwind compiler, never hand-written utility rules. */
  readonly theme: string;
  readonly properties: readonly string[];
}

/**
 * Map the selected consumer's resolved tokens to every live exact contract key.
 * Wildcard scale namespaces remain the existing Designer emitter's responsibility.
 * No preset or contract default value can substitute for a missing consumer token.
 */
export function selectionShadcnTokens(resolved: Pick<Resolved, "members">, contract: SelectionShadcnTokenContract): SelectionShadcnTokens {
  const targets = new Map<string, { id: string; kind: string }[]>();
  for (const [slot, leaf] of Object.entries(contract.leaves)) {
    for (const [name, member] of Object.entries(leaf.members ?? {})) {
      if (member.status !== "live" || member.kind === "moved") continue;
      const candidates = targets.get(member.target) ?? [];
      candidates.push({ id: `${slot}.${name}`, kind: member.kind });
      targets.set(member.target, candidates);
    }
  }
  const owners = new Map<string, { id: string; kind: string }>();
  for (const [target, candidates] of targets) {
    // Each themes leaf names exactly one shadcn variable; a shared target is a contract defect.
    const owner = candidates.length === 1 ? candidates[0] : undefined;
    if (!owner) throw new Error(`NEED: selected shadcn token ${target} has no unambiguous native owner`);
    owners.set(target, owner);
  }
  for (const [target, id] of Object.entries(contract.aliases)) {
    const previous = owners.get(target);
    if (previous && previous.id !== id) throw new Error(`NEED: selected shadcn alias ${target} conflicts with its native owner`);
    owners.set(target, { id, kind: previous?.kind ?? "alias" });
  }

  const property = (name: string): string => {
    if (!/^--[a-zA-Z0-9-]+$/.test(name)) throw new Error("NEED: invalid selected shadcn token property");
    return name;
  };
  const memberFor = (id: string): ResolvedMember => {
    const member = resolved.members[id];
    if (!member || member.slot !== id.split(".").slice(0, 2).join(".")) throw new Error(`NEED: selected shadcn token ${id} is unavailable`);
    return member;
  };
  const literal = (id: string, mode: "light" | "dark", seen = new Set<string>()): string => {
    if (seen.has(id)) throw new Error(`NEED: selected shadcn token ${id} has a cyclic ${mode} alias`);
    seen.add(id);
    const member = memberFor(id);
    const alias = member.alias[mode] ?? (mode === "dark" && member.value.dark === undefined ? member.alias.light : undefined);
    if (alias) return literal(alias, mode, seen);
    const value = member.css[mode] ?? (mode === "dark" && !["color", "shadow"].includes(member.$type) ? member.css.light : undefined);
    if (!value?.trim()) throw new Error(`NEED: selected shadcn token ${id} has no ${mode} value`);
    return value;
  };

  const properties = [...owners.keys()].sort();
  const declarations = (mode: "light" | "dark") => properties.map(target => `  ${property(target)}: ${literal(owners.get(target)!.id, mode)};`).join("\n");
  const light = declarations("light");
  const dark = declarations("dark");
  const theme = new Map<string, string>();
  for (const target of properties) {
    const owner = owners.get(target)!;
    const member = memberFor(owner.id);
    if (member.$type === "color") theme.set(`--color-${target.slice(2)}`, `var(${target})`);
    else if (owner.kind === "tailwind") theme.set(target, `var(${property(member.emit ?? target)})`);
  }
  return {
    properties,
    css: `:root {\n${light}\n}\n@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n${dark}\n  }\n}\n:root[data-theme="dark"] {\n${dark}\n}\n`,
    theme: `@theme inline {\n${[...theme].sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => `  ${property(name)}: ${value};`).join("\n")}\n}\n`,
  };
}
