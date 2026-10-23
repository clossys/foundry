import type { DtcgNode, DtcgToken, DtcgType, DtcgValue, Evidence, FontPayload, Slot } from "../catalog-core/types.js";

export const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong"]);
export type Classified = { value: DtcgValue; unit?: "em"; font?: FontPayload };
export interface Declaration { name: string; value: string; line: number; block: string }

export const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/** Custom-property declarations that sit directly inside a top-level block, with the 1-based line each starts on. */
export function scanDeclarations(css: string): Declaration[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, " "));
  const found: Declaration[] = [];
  const stack: string[] = [];
  let start = -1;
  let startLine = 1;
  let line = 1;
  let quote = "";
  const finish = (end: number): void => {
    if (start >= 0 && stack.length === 1) {
      const match = /^(--[A-Za-z0-9-]+)\s*:([\s\S]*)$/.exec(text.slice(start, end).trim());
      if (match) found.push({ name: match[1]!, value: match[2]!.replace(/\s+/g, " ").trim(), line: startLine, block: stack[0]! });
    }
    start = -1;
  };
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (character === "\n") line++;
    if (quote) {
      if (character === "\\") index++;
      else if (character === quote) quote = "";
      continue;
    }
    if (start < 0 && !/\s/.test(character) && character !== ";" && character !== "{" && character !== "}") { start = index; startLine = line; }
    if (character === '"' || character === "'") quote = character;
    else if (character === "{") { stack.push(start < 0 ? "" : text.slice(start, index).replace(/\s+/g, " ").trim()); start = -1; }
    else if (character === "}") { finish(index); stack.pop(); }
    else if (character === ";") finish(index);
  }
  return found;
}

export function splitFamilies(text: string): string[] | undefined {
  const parts: string[] = [];
  let start = 0;
  let quote = "";
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const character = text[i]!;
    if (quote) {
      if (character === "\\") i++;
      else if (character === quote) quote = "";
    } else if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth++;
    else if (character === ")") { if (--depth < 0) return undefined; }
    else if (character === "," && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1; }
  }
  if (quote || depth !== 0) return undefined;
  parts.push(text.slice(start).trim());
  if (parts.some(part => part.length === 0)) return undefined;
  return parts.map(part => (part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'")) ? part.slice(1, -1) : part);
}

function fraction(text: string): number | undefined {
  if (NUMBER.test(text)) return Number(text);
  if (text.endsWith("%") && NUMBER.test(text.slice(0, -1))) return round6(Number(text.slice(0, -1)) / 100);
  return undefined;
}

/**
 * Turn CSS text into a typed DTCG value. Text that has no typed form comes back unchanged as a string.
 * `alpha: "always"` writes `alpha: 1` for a colour without one; `"as-written"` leaves it out.
 */
export function classifyValue(text: string, type: DtcgType, property: string, alpha: "always" | "as-written"): Classified {
  if (type === "fontFamily") {
    const names = splitFamilies(text);
    if (!names) throw new Error(`importer: cannot classify ${property}`);
    return { value: names, font: { kind: "system" } };
  }
  if (/^#[0-9a-fA-F]{6}$/.test(text)) {
    const components = [1, 3, 5].map(index => Math.round((parseInt(text.slice(index, index + 2), 16) / 255) * 1e6) / 1e6);
    return { value: { colorSpace: "srgb", components, hex: text } };
  }
  const oklch = /^oklch\(([^)]+)\)$/.exec(text);
  if (oklch) {
    const [channels = "", alphaText] = oklch[1]!.split(/\s*\/\s*/);
    const parts = channels.trim().split(/\s+/);
    const lightness = parts[0] === undefined ? undefined : fraction(parts[0]);
    const rest = parts.slice(1);
    const opacity = alphaText === undefined ? undefined : fraction(alphaText);
    if (parts.length === 3 && lightness !== undefined && rest.every(value => value === "none" || NUMBER.test(value)) && (alphaText === undefined || opacity !== undefined)) {
      const value: Record<string, DtcgValue> = { colorSpace: "oklch", components: [lightness, ...rest.map(value => (value === "none" ? value : Number(value)))] };
      if (opacity !== undefined) value.alpha = opacity;
      else if (alpha === "always") value.alpha = 1;
      return { value };
    }
  }
  const unit = /^(.*?)(px|rem|ms|em)$/.exec(text);
  if (unit && NUMBER.test(unit[1]!)) {
    const value = Number(unit[1]);
    return unit[2] === "em" ? { value, unit: "em" } : { value: { value, unit: unit[2]! } };
  }
  if (NUMBER.test(text)) return { value: Number(text) };
  const quotient = /^calc\(\s*([0-9.]+)\s*\/\s*([0-9.]+)\s*\)$/.exec(text);
  if (type === "number" && quotient && NUMBER.test(quotient[1]!) && NUMBER.test(quotient[2]!) && Number(quotient[2]) !== 0) return { value: round6(Number(quotient[1]) / Number(quotient[2])) };
  const bezier = /^cubic-bezier\(([^)]+)\)$/.exec(text);
  if (bezier) {
    const parts = bezier[1]!.split(",").map(value => value.trim());
    if (parts.length === 4 && parts.every(value => NUMBER.test(value))) return { value: parts.map(Number) };
  }
  return { value: text };
}

/** Format typed dark values to decide whether their text survives without raw storage. */
export function formatTyped(classified: Classified, type: DtcgType): string {
  const value = classified.value;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value) + (classified.unit ?? "");
  if (Array.isArray(value)) {
    if (type === "fontFamily") return value.map(name => GENERIC_FAMILIES.has(String(name)) || String(name).startsWith("-") ? String(name) : JSON.stringify(name)).join(", ");
    return `cubic-bezier(${value.join(", ")})`;
  }
  if (value !== null && typeof value === "object") {
    const object = value as Readonly<Record<string, DtcgValue>>;
    if (typeof object.hex === "string") return object.hex;
    if (object.colorSpace === "oklch" && Array.isArray(object.components)) {
      const alpha = typeof object.alpha === "number" && object.alpha < 1 ? ` / ${object.alpha}` : "";
      return `oklch(${object.components.join(" ")}${alpha})`;
    }
    if (typeof object.value === "number" && typeof object.unit === "string") return String(object.value) + object.unit;
  }
  return "";
}

export function putToken(root: Record<string, DtcgNode>, path: readonly string[], token: DtcgToken): void {
  let group = root;
  for (const segment of path.slice(0, -1)) {
    if (!Object.hasOwn(group, segment)) group[segment] = {};
    group = group[segment] as Record<string, DtcgNode>;
  }
  group[path[path.length - 1]!] = token;
}

/** Throw unless the member id (relative to the slot) lies inside the slot's member contract. */
export function assertMember(slot: Slot, member: string): void {
  const members = slot.contract.members;
  const inside = members.mode === "closed" ? members.names.includes(member) : new RegExp(members.pattern).test(member);
  if (!inside) throw new Error(`importer: ${slot.id}.${member} is outside the slot contract`);
}

/** `same-contract` and `subset` for closed slots; `superset` for an open slot whose required members are all present. */
export function relationOf(slot: Slot, members: readonly string[]): "same-contract" | "subset" | "superset" {
  const contract = slot.contract.members;
  if (contract.mode === "closed") return contract.names.every(name => members.includes(name)) ? "same-contract" : "subset";
  return (contract.required ?? []).every(name => members.includes(name)) ? "superset" : "subset";
}

/** Evidence for each claimed clause: a test path for the structural clauses, an engine check for the rest. */
export function evidenceFor(clauses: readonly string[], testPath: string): Evidence[] {
  return clauses.map(clause => {
    if (clause === "dtcg#alias") return { clause, check: "C2" };
    if (clause === "wcag-2.2#1.4.3") return { clause, check: "C9" };
    if (clause === "dtcg#format" || clause === "dtcg#types" || clause === "dtcg#color") return { clause, path: testPath };
    throw new Error(`importer: no evidence rule for ${clause}`);
  });
}
