import { parseBrandRules } from "./parse-brand-declarations.js";
import { parseDeclarationsForSelector, parseRootDeclarations } from "./internal/parse-css.js";
import { mergeDeclarations, registryFromDeclarations } from "./internal/registry-from-css.js";
import { resolveCascade, specificity, type CascadeRule, type ThemeAttr } from "./internal/cascade.js";
import { checkFieldTokens, type FieldTokenReport } from "./field-tokens.js";

/** Resolves the documented root/theme overlay dialect; unknown condition, selector or layer ordering fails closed. */
export function checkFieldBrandCss(brandCss: string, tokensCss: string): FieldTokenReport {
  const result: FieldTokenReport = { ok: false, findings: [], unchecked: [], contrast: {} };
  const decline = (message: string) => result.unchecked.push({ rule: "field-alpha-contrast", theme: "light", message });
  try {
    const base = parseRootDeclarations(tokensCss);
    const dark = mergeDeclarations(base, parseDeclarationsForSelector(tokensCss, ':root[data-theme="dark"]'));
    const parsed = parseBrandRules(brandCss);
    for (const item of parsed.unchecked) decline(`Brand CSS line ${item.line}: ${item.detail}`);
    // Follow every possible alias binding before filtering rules: even a scoped
    // custom alias can change a field dependency and must fail closed.
    const needed = new Set(["--color-field-dot", "--ui-field-alpha", "--ui-field-scale", "--ui-field-lens", "--color-surface-inverse", "--color-ink-on-inverse"]);
    const bindings = [...base, ...dark, ...parsed.rules.flatMap((rule) => Object.entries(rule.declarations))];
    for (let changed = true; changed;) {
      changed = false;
      for (const [name, value] of bindings) {
        if (!needed.has(name)) continue;
        for (const match of value.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
          if (!needed.has(match[1]!)) { needed.add(match[1]!); changed = true; }
        }
      }
    }
    const rules = new Map<string, CascadeRule[]>();
    for (const rule of parsed.rules) {
      const relevant = Object.entries(rule.declarations).filter(([name]) => needed.has(name));
      if (!relevant.length) continue;
      let insideDarkMedia = false;
      try {
        specificity(rule.selector);
        if (!rule.selector.startsWith(":root")) throw new Error("Only root token selectors can bind field tokens.");
        for (const group of rule.groups) {
          if (/^@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/.test(group)) insideDarkMedia = true;
          else throw new Error(`The field check cannot resolve conditional or layered binding ${group}.`);
        }
      } catch (error) { decline(error instanceof Error ? error.message : String(error)); continue; }
      for (const [name, value] of relevant) {
        const entries = rules.get(name) ?? [];
        entries.push({ selector: rule.selector, insideDarkMedia, sourceIndex: rule.sourceIndex, value });
        rules.set(name, entries);
      }
    }
    const states: Array<{ theme: "light" | "dark"; dataTheme: ThemeAttr; osDark: boolean }> = [
      { theme: "light", dataTheme: undefined, osDark: false },
      { theme: "light", dataTheme: "light", osDark: false },
      { theme: "light", dataTheme: "light", osDark: true },
      { theme: "dark", dataTheme: "dark", osDark: false },
      { theme: "dark", dataTheme: undefined, osDark: true },
      { theme: "dark", dataTheme: "dark", osDark: true },
    ];
    for (const state of states) {
      const declarations = new Map(state.theme === "dark" ? dark : base);
      for (const [name, entries] of rules) {
        const winner = resolveCascade(entries, { ...state, brandBound: true });
        if (winner) declarations.set(name, winner.value);
      }
      // The CSS resolver proves each state's bindings, including a brand that deliberately uses invariant colours.
      const check = checkFieldTokens({ tokens: registryFromDeclarations(declarations), themes: "light-only" });
      result.findings.push(...check.findings.map((f) => ({ ...f, theme: state.theme })));
      result.unchecked.push(...check.unchecked.map((u) => ({ ...u, theme: state.theme })));
      if (check.contrast.light !== undefined) result.contrast[state.theme] = Math.min(result.contrast[state.theme] ?? Infinity, check.contrast.light);
    }
  } catch (error) { decline(error instanceof Error ? error.message : String(error)); }
  result.findings = result.findings.filter((f, i, all) => all.findIndex((other) => other.rule === f.rule && other.theme === f.theme && other.message === f.message) === i);
  result.unchecked = result.unchecked.filter((u, i, all) => all.findIndex((other) => other.rule === u.rule && other.theme === u.theme && other.message === u.message) === i);
  result.ok = result.unchecked.length === 0 && !result.findings.some((f) => f.severity === "error");
  return result;
}
