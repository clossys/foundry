import foundrySource from "../catalog/sources/foundry.json" with { type: "json" };
import type { DtcgNode, DtcgToken, DtcgType, DtcgValue, FillDoc, FillMeta, FontPayload, Slot } from "../catalog-core/types.js";
import type { TokenDefinition } from "../tokens/tokens.js";
import { parseDeclarationsForSelector } from "../tokens/internal/parse-css.js";

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong"]);
type Classified = { value: DtcgValue; unit?: "em"; font?: FontPayload };

function splitFamilies(text: string): string[] | undefined {
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

function classify(text: string, type: DtcgType, property: string): Classified {
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
    const [channels = "", alpha] = oklch[1]!.split(/\s*\/\s*/);
    const components = channels.trim().split(/\s+/);
    if (components.length === 3 && components.every(value => NUMBER.test(value)) && (alpha === undefined || NUMBER.test(alpha))) {
      return { value: { colorSpace: "oklch", components: components.map(Number), ...(alpha === undefined ? {} : { alpha: Number(alpha) }) } };
    }
  }
  const unit = /^(.*?)(px|rem|ms|em)$/.exec(text);
  if (unit && NUMBER.test(unit[1]!)) {
    const value = Number(unit[1]);
    return unit[2] === "em" ? { value, unit: "em" } : { value: { value, unit: unit[2]! } };
  }
  if (NUMBER.test(text)) return { value: Number(text) };
  const bezier = /^cubic-bezier\(([^)]+)\)$/.exec(text);
  if (bezier) {
    const parts = bezier[1]!.split(",").map(value => value.trim());
    if (parts.length === 4 && parts.every(value => NUMBER.test(value))) return { value: parts.map(Number) };
  }
  return { value: text };
}

/** Format typed dark values to decide whether their text survives without raw storage. */
function formatTyped(classified: Classified, type: DtcgType): string {
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

function isWholeVar(text: string): boolean {
  if (!text.startsWith("var(")) return false;
  let depth = 0;
  for (let index = 3; index < text.length; index++) {
    if (text[index] === "(") depth++;
    else if (text[index] === ")" && --depth === 0) return index === text.length - 1;
  }
  return false;
}

function putToken(root: Record<string, DtcgNode>, path: readonly string[], token: DtcgToken): void {
  let group = root;
  for (const segment of path.slice(0, -1)) {
    if (!Object.hasOwn(group, segment)) group[segment] = {};
    group = group[segment] as Record<string, DtcgNode>;
  }
  group[path[path.length - 1]!] = token;
}

export function importFoundry(input: { tokens: readonly TokenDefinition[]; tokensCss: string; slots: readonly Slot[] }): FillDoc[] {
  const tokens = new Map(input.tokens.map(token => [token.property, token]));
  const bindings = new Map<string, string>();
  for (const slot of input.slots) for (const [member, property] of Object.entries(slot.contract.emit ?? {})) bindings.set(property, slot.id + "." + member);
  const dark = parseDeclarationsForSelector(input.tokensCss, ':root[data-theme="dark"]');
  const fills: FillDoc[] = [];
  for (const slot of [...input.slots].sort((a, b) => compare(a.id, b.id))) {
    const entries = Object.entries(slot.contract.emit ?? {});
    if (entries.length === 0) continue;
    const meta: FillMeta = {
      id: "foundry/" + slot.id, slot: slot.id, source: "foundry", mode: "implementation", sourceAddress: "styles/tokens.css", relation: "same-contract", builtOn: [], conforms: slot.requires,
      evidence: slot.requires.map(clause => ({ clause, check: clause === "dtcg#format" ? "C1" : clause === "dtcg#alias" ? "C2" : "C9" })),
      author: "foundry", trust: "foundry", license: foundrySource.license, status: "draft",
    };
    const root: Record<string, DtcgNode> = {};
    for (const [member, property] of entries) {
      const definition = tokens.get(property)!;
      const text = definition.value;
      const type = slot.contract.memberTypes?.[member] ?? slot.contract.$type;
      const targets = [...text.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map(match => {
        const target = bindings.get(match[1]!);
        if (!target) throw new Error(`importer: ${property} aliases unbound ${match[1]}`);
        return target;
      });
      let token: DtcgToken;
      if (isWholeVar(text) && targets[0]) token = { $type: type, $value: "{" + targets[0] + "}" };
      else if (text.includes("var(")) token = { $type: type, $value: text, $extensions: { "com.clossys.css": { raw: text, reads: [...new Set(targets)].sort(compare) } } };
      else {
        const classified = classify(text, type, property);
        token = { $type: type, $value: classified.value, $extensions: { "com.clossys.css": { raw: text }, ...(classified.unit ? { "com.clossys.unit": classified.unit } : {}), ...(classified.font ? { "com.clossys.font": classified.font } : {}) } };
      }
      if (definition.themeDependent) {
        const darkText = dark.get(property);
        if (darkText === undefined) throw new Error(`importer: ${property} has no dark value`);
        if (darkText !== text) {
          const classified = classify(darkText, type, property);
          token.$extensions = { ...token.$extensions, "com.clossys.modes": { dark: formatTyped(classified, type) === darkText ? classified.value : darkText } };
        }
      }
      putToken(root, [slot.id.split(".")[1]!, ...member.split(".")], token);
    }
    fills.push({ $extensions: { "com.clossys.fill": meta }, tokens: root });
  }
  return fills;
}
