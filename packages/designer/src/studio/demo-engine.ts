import {
  CatalogError, isPrefixOf, stableStringify,
  type CatalogData, type ChangeSet, type CheckResult, type DtcgNode, type DtcgToken, type DtcgValue, type EmitFile, type EmitOptions, type EmitTarget,
  type FillDoc, type Finding, type LibraryData, type Mode, type Pick, type Resolved, type ResolvedMember, type Selection, type Slot,
} from "../catalog-core/index.js";
import { DEMO_CATALOG } from "./demo-data.js";

/**
 * THROWAWAY engine for the Studio first look, written to the contract of `catalog-core/api.ts`. It covers only what the
 * Studio calls: `resolve` for closed slots, `check` for unsafe text and reference picks, `emit` for `css-brand`,
 * `applyChangeSet` and `selectionHash`. It is deleted when the real engine lands (see `engine.ts`).
 */

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const UNSAFE = [";", "{", "}", "<", ">", "\\", "/*", "*/", "@", "url(", "expression(", "!important"] as const;
const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong"]);
const DEFAULT_SELECTORS = {
  light: ":root[data-brand-bound]",
  mediaDark: "@media (prefers-color-scheme: dark) { :root[data-brand-bound]:not([data-theme=\"light\"])",
  dark: ":root[data-brand-bound][data-theme=\"dark\"]",
};

const isToken = (node: DtcgNode | undefined): node is DtcgToken => node !== undefined && Object.hasOwn(node, "$value");
const aliasOf = (value: DtcgValue | undefined): string | undefined => (typeof value === "string" && /^\{[^{}]+\}$/.test(value) ? value.slice(1, -1) : undefined);

function leafOf(doc: FillDoc, slotId: string, name: string): DtcgToken | undefined {
  let node: DtcgNode | undefined = doc.tokens;
  for (const key of [slotId.split(".")[1] as string, ...name.split(".")]) {
    node = node && !isToken(node) ? (node as { readonly [key: string]: DtcgNode })[key] : undefined;
  }
  return isToken(node) ? node : undefined;
}

function formatCss(token: DtcgToken, value: DtcgValue): string {
  const raw = token.$extensions?.["com.clossys.css"]?.raw;
  if (raw !== undefined) return raw;
  const object = (typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}) as { [key: string]: DtcgValue };
  switch (token.$type) {
    case "color": return typeof object.hex === "string" ? object.hex : String(value);
    case "dimension": return `${String(object.value)}${String(object.unit)}`;
    case "duration": return `${String(object.value)}ms`;
    case "cubicBezier": return `cubic-bezier(${(value as readonly DtcgValue[]).map(String).join(", ")})`;
    case "fontFamily": return (Array.isArray(value) ? value : [value]).map((name) => {
      const text = String(name);
      return GENERIC.has(text) || text.startsWith("-") ? text : `"${text}"`;
    }).join(", ");
    default: return String(value);
  }
}

interface Chosen { slot: Slot; name: string; doc: FillDoc; token: DtcgToken; via: ResolvedMember["via"]; source: string }

function profile(catalog: CatalogData, library: LibraryData, selection: Selection): Map<string, Chosen> {
  if (selection.version !== 1) throw new CatalogError(`selection version ${String(selection.version)} is not supported`);
  const docs = [...catalog.fills, ...library.fills];
  const fillOf = (source: string, slotId: string): FillDoc | undefined =>
    docs.find((doc) => doc.$extensions["com.clossys.fill"].source === source && doc.$extensions["com.clossys.fill"].slot === slotId && doc.$extensions["com.clossys.fill"].mode !== "reference");
  const chosen = new Map<string, Chosen>();
  for (const slot of [...catalog.slots].sort((a, b) => byCodeUnit(a.id, b.id))) {
    const names = slot.contract.members.mode === "closed" ? [...slot.contract.members.names].sort(byCodeUnit) : [];
    for (const name of names) {
      const id = `${slot.id}.${name}`;
      const attempts: readonly (readonly [Pick | undefined, ResolvedMember["via"]])[] = [
        [selection.picks.find((pick) => pick.scope === "member" && pick.target === id), "member"],
        [selection.picks.find((pick) => pick.scope === "slot" && pick.target === slot.id), "slot"],
      ];
      // The first pick that exists decides; a member pick that cannot provide the member leaves it unresolved, any other falls to the default chain.
      const [pick, via] = attempts.find(([candidate]) => candidate !== undefined) ?? [undefined, "default" as const];
      let found: Chosen | undefined;
      if (pick) {
        const doc = fillOf(pick.source, slot.id);
        const token = doc && leafOf(doc, slot.id, name);
        if (doc && token) found = { slot, name, doc, token, via, source: pick.source };
      }
      if (!found && via !== "member") {
        for (const source of selection.defaultChain) {
          const doc = fillOf(source, slot.id);
          const token = doc && leafOf(doc, slot.id, name);
          if (doc && token) { found = { slot, name, doc, token, via: "default", source }; break; }
        }
      }
      if (found) chosen.set(id, found);
    }
  }
  return chosen;
}

function valueAt(chosen: ReadonlyMap<string, Chosen>, id: string, mode: Mode, stack: readonly string[]): { value: DtcgValue; css: string; alias?: string } | undefined {
  const entry = chosen.get(id);
  if (!entry || stack.includes(id) || stack.length >= 16) return undefined;
  const darkValue = mode === "dark" ? entry.token.$extensions?.["com.clossys.modes"]?.dark : undefined;
  const value = darkValue !== undefined ? darkValue : entry.token.$value;
  const target = aliasOf(value);
  if (target === undefined) return { value, css: formatCss(entry.token, value) };
  const inner = valueAt(chosen, target, mode, [...stack, id]);
  if (!inner) return undefined;
  const emit = chosen.get(target)?.slot.contract.emit?.[chosen.get(target)?.name ?? ""];
  return { value: inner.value, css: emit ? `var(${emit}, ${inner.css})` : inner.css, alias: target };
}

export function resolve(input: { catalog: CatalogData; library: LibraryData; selection: Selection }): Resolved {
  const chosen = profile(input.catalog, input.library, input.selection);
  const members: { [id: string]: ResolvedMember } = {};
  for (const id of [...chosen.keys()].sort(byCodeUnit)) {
    const entry = chosen.get(id) as Chosen;
    const light = valueAt(chosen, id, "light", []);
    if (!light) continue;
    const dark = entry.slot.contract.modes.includes("dark") ? valueAt(chosen, id, "dark", []) : undefined;
    const emit = entry.slot.contract.emit?.[entry.name];
    const font = entry.token.$extensions?.["com.clossys.font"];
    members[id] = {
      slot: entry.slot.id, source: entry.source, fill: entry.doc.$extensions["com.clossys.fill"].id, via: entry.via, $type: entry.token.$type,
      value: { light: light.value, ...(dark ? { dark: dark.value } : {}) },
      css: { light: light.css, ...(dark ? { dark: dark.css } : {}) },
      alias: { ...(light.alias ? { light: light.alias } : {}), ...(dark?.alias ? { dark: dark.alias } : {}) },
      ...(emit ? { emit } : {}), ...(font ? { font } : {}),
    };
  }
  return { version: 1, consumer: input.selection.consumer, selectionHash: selectionHash(input.selection), members, notices: [] };
}

export function check(input: { catalog: CatalogData; library: LibraryData; selection: Selection; resolved?: Resolved }): CheckResult {
  const resolved = input.resolved ?? resolve(input);
  const findings: Finding[] = [];
  for (const [id, member] of Object.entries(resolved.members)) {
    for (const text of [member.css.light, member.css.dark ?? ""]) {
      const hit = UNSAFE.find((token) => text.includes(token));
      if (hit !== undefined) {
        findings.push({ code: "C1", rule: "contract", severity: "error", subject: member.fill, message: `contract: ${member.fill} member ${id} has unsafe CSS text (${hit})` });
        break;
      }
    }
  }
  for (const pick of input.selection.picks) {
    for (const doc of [...input.catalog.fills, ...input.library.fills]) {
      const meta = doc.$extensions["com.clossys.fill"];
      if (meta.mode !== "reference" || meta.source !== pick.source) continue;
      if (!isPrefixOf(pick.target, meta.slot) && !isPrefixOf(meta.slot, pick.target)) continue;
      findings.push({ code: "C7", rule: "selection", severity: "error", subject: meta.id, message: `selection: ${meta.id} is a reference cell and cannot be selected (${pick.scope} pick ${pick.target})` });
    }
  }
  findings.sort((a, b) => byCodeUnit(a.code, b.code) || byCodeUnit(a.subject, b.subject) || byCodeUnit(a.message, b.message));
  return { ok: findings.every((finding) => finding.severity !== "error"), findings };
}

export function emit(resolved: Resolved, targets: readonly EmitTarget[], options: EmitOptions = {}): EmitFile[] {
  if (targets.length !== 1 || targets[0] !== "css-brand") throw new CatalogError("demo-engine: only css-brand is implemented");
  const { light: lightHead, mediaDark: mediaHead, dark: darkHead } = options.selectors ?? DEFAULT_SELECTORS;
  const members = Object.entries(resolved.members).sort(([a], [b]) => byCodeUnit(a, b));
  const bound = members.filter(([, member]) => member.emit !== undefined).sort(([, a], [, b]) => byCodeUnit(a.emit as string, b.emit as string));
  const unbound = options.extraVars ? members.filter(([, member]) => member.emit === undefined) : [];
  const names = [...bound.map(([, member]) => [member.emit as string, member] as const), ...unbound.map(([, member], at) => [`--studio-m-${at}`, member] as const)];
  const block = (head: string, mode: Mode, closing: string, differing: boolean): string[] => {
    const lines = names
      .filter(([, member]) => !differing || (member.css.dark !== undefined && member.css.dark !== member.css.light))
      .map(([name, member]) => `  ${name}: ${mode === "dark" ? member.css.dark ?? member.css.light : member.css.light};`);
    return lines.length === 0 ? [] : [`${head} {`, ...lines, closing];
  };
  const full = options.full === true;
  const lines = [
    ...block(lightHead, "light", "}", false),
    ...block(mediaHead, "dark", "}\n}", !full),
    ...block(darkHead, "dark", "}", !full),
  ];
  const header = options.header === false ? [] : [`/* Generated by @clossys/designer/catalog (css-brand). Do not edit. consumer ${resolved.consumer} selection ${resolved.selectionHash} */`];
  const text = [...header, ...lines].join("\n");
  return [{ path: "brand.css", contents: text === "" ? "" : text + "\n" }];
}

const pickKey = (scope: string, target: string): string => `${scope}\u0000${target}`;

export function applyChangeSet(selection: Selection, changes: ChangeSet): Selection {
  if (changes.baseHash !== selectionHash(selection)) throw new CatalogError("conflict: change set was made against a different selection");
  const picks = new Map(selection.picks.map((pick) => [pickKey(pick.scope, pick.target), pick] as const));
  for (const change of changes.changes) {
    if (change.op === "set") picks.set(pickKey(change.pick.scope, change.pick.target), change.pick);
    else picks.delete(pickKey(change.scope, change.target));
  }
  return { ...selection, picks: [...picks.entries()].sort(([a], [b]) => byCodeUnit(a, b)).map(([, pick]) => pick) };
}

export function selectionHash(selection: Selection): string {
  const prime = 0x100000001b3n;
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(stableStringify(selection))) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * prime);
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

export function loadCatalog(): CatalogData {
  return DEMO_CATALOG;
}
