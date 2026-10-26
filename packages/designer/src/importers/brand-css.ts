import tokenSlots from "../catalog/slots/tokens.json" with { type: "json" };
import type { FillDoc, Slot, Source } from "../catalog-core/types.js";
import { parseBrandDeclarations } from "../tokens/parse-brand-declarations.js";
import { resolveCascade, type CascadeRule } from "../tokens/internal/cascade.js";
import { cells, type ImportedValue } from "./shared.js";

type Rule = CascadeRule & { property: string; line: number };
/** Read supported root rules structurally; unknown selectors/media fail rather than flatten. */
function rulesFromCss(css: string): Rule[] {
  const unchecked = parseBrandDeclarations(css).unchecked;
  if (unchecked.length) throw new Error(`importer: unchecked CSS at line ${unchecked[0]!.line}`);
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, " "));
  const rules: Rule[] = [];
  const walk = (start: number, end: number, insideDarkMedia: boolean): void => {
    let cursor = start;
    while (cursor < end) {
      const open = cleaned.indexOf("{", cursor);
      if (open < 0 || open >= end) break;
      const selector = cleaned.slice(cursor, open).trim();
      let close = open + 1, depth = 1, quote = "";
      for (; close < end && depth; close++) {
        const char = cleaned[close]!;
        if (quote) { if (char === "\\") close++; else if (char === quote) quote = ""; }
        else if (char === '"' || char === "'") quote = char;
        else if (char === "{") depth++;
        else if (char === "}") depth--;
      }
      if (depth) throw new Error("importer: unterminated CSS block");
      if (selector.startsWith("@media")) {
        if (!/^@media\s*\(prefers-color-scheme:\s*dark\)$/.test(selector)) throw new Error(`importer: unsupported media ${selector}`);
        walk(open + 1, close - 1, true);
      } else {
        if (selector.startsWith("@")) throw new Error(`importer: unsupported grouping ${selector}`);
        const declarations = parseBrandDeclarations(`:root {${cleaned.slice(open + 1, close - 1)}}`).declarations;
        for (const part of selector.split(",").map(text => text.trim())) {
          // Resolve once to validate every selector, including declarations not bound to a token.
          resolveCascade([{ selector: part, insideDarkMedia, sourceIndex: open, value: "" }], { brandBound: true, dataTheme: "light", osDark: false });
          for (const [property, value] of Object.entries(declarations)) {
            const body = cleaned.slice(open + 1, close - 1);
            const position = open + 1 + body.lastIndexOf(property);
            rules.push({ property, selector: part, insideDarkMedia, sourceIndex: open, value, line: cleaned.slice(0, position).split("\n").length });
          }
        }
      }
      cursor = close;
    }
  };
  walk(0, cleaned.length, false);
  return rules;
}

export function importBrandCss(input: { css: string; source: string | Source; slots?: readonly Slot[]; sourceAddress?: string }): FillDoc[] {
  const source: Source = typeof input.source === "string" ? { id: input.source, kind: "consumer", author: "consumer", license: "UNLICENSED", extends: "foundry" } : input.source;
  const slots = input.slots ?? tokenSlots as unknown as readonly Slot[];
  const rules = rulesFromCss(input.css);
  const bound = new Set(slots.flatMap(slot => slot.contract.kind === "token" ? Object.values(slot.contract.emit ?? {}) : []));
  const unmapped = rules.filter(rule => !bound.has(rule.property as `--${string}`)).map(rule => rule.property);
  const values: ImportedValue[] = [];
  for (const slot of slots) if (slot.contract.kind === "token") for (const [member, property] of Object.entries(slot.contract.emit ?? {})) {
    const candidates = rules.filter(rule => rule.property === property);
    const light = resolveCascade(candidates, { brandBound: true, dataTheme: "light", osDark: false });
    const dark = resolveCascade(candidates, { brandBound: true, dataTheme: "dark", osDark: false });
    const automaticDark = resolveCascade(candidates, { brandBound: true, dataTheme: undefined, osDark: true });
    const automaticLight = resolveCascade(candidates, { brandBound: true, dataTheme: undefined, osDark: false });
    const forcedLight = resolveCascade(candidates, { brandBound: true, dataTheme: "light", osDark: true });
    if (light?.value !== automaticLight?.value || light?.value !== forcedLight?.value || dark?.value !== automaticDark?.value) throw new Error(`importer: theme cascade differs for ${property}`);
    if (!light) { if (dark) throw new Error(`importer: dark-only ${property}`); continue; }
    values.push({ leaf: slot.id.split(".")[1]!, member, text: light.value, ...(dark ? { dark: dark.value } : {}), line: (light as Rule).line });
  }
  const fills = cells({ values, slots, source, sourceAddress: input.sourceAddress ?? "brand.css", unmapped });
  if (source.kind === "consumer") for (const fill of fills) {
    fill.$extensions["com.clossys.fill"].originKinds = ["authored"];
    const mark = (node: import("../catalog-core/types.js").DtcgNode): void => {
      if ("$value" in node) { const token = node as import("../catalog-core/types.js").DtcgToken; token.$extensions = { ...token.$extensions, "com.clossys.origin": { kind: "authored", license: source.license } }; }
      else Object.values(node).forEach(mark);
    };
    mark(fill.tokens!);
  }
  return fills;
}
