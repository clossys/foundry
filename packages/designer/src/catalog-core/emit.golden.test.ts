import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyLibraryChange, libraryHash, emit, loadCatalog, resolve, stableStringify, check, type Resolved, type LibraryData, type FillDoc } from "./index.js";
import { TOKENS, type TokenDefinition } from "../tokens/tokens.js";
import { parseDeclarationsForSelector } from "../tokens/internal/parse-css.js";
import { resolveCascade, type CascadeRule } from "../tokens/internal/cascade.js";
import { resolveTokenValue } from "../tokens/internal/resolve-token-value.js";
import originalFoundryFills from "./__fixtures__/foundry-original-fills.json" with { type: "json" };
function shipped(): Resolved {
  const catalog={...loadCatalog(),fills:structuredClone(originalFoundryFills) as unknown as FillDoc[]}; let library:LibraryData={source:{id:"example",kind:"consumer",author:"consumer",license:"UNLICENSED",extends:"foundry"},fills:[],adoptedAt:"2026-10-23"};
  library=applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:catalog.fills.filter(fill=>fill.$extensions["com.clossys.fill"].source==="foundry").map(fill=>({op:"adopt" as const,slot:fill.$extensions["com.clossys.fill"].slot,source:"foundry"}))});
  const profile=resolve({catalog,library}); return {...profile,baseline:Object.fromEntries(Object.values(profile.members).filter(m=>m.emit).map(m=>[m.emit!,{...m.css}]))};
}

describe("deterministic catalog emit", () => {
  it("matches all four CSS goldens and the complete resolved profile", async () => {
    const profile = shipped();
    const files = emit(profile, ["css-brand", "css-scales", "css-fonts", "tailwind-theme", "notices"]);
    for (const file of files) await expect(file.contents).toMatchFileSnapshot(`__golden__/foundry-${file.path}`);
    await expect(stableStringify(profile)).toMatchFileSnapshot("__golden__/resolved.foundry.json");
  });
  it("preserves computed values in light, OS dark and explicit dark for every shipped property", () => {
    const profile = shipped(); const original = readFileSync(resolvePath(dirname(fileURLToPath(import.meta.url)), "../../styles/tokens.css"), "utf8");
    const generated = emit(profile, ["css-brand", "css-scales"], { header: false }).map(f => f.contents).join("\n");
    const styleRules = (css: string, offset: number): Map<string, CascadeRule[]> => {
      css = css.replace(/\/\*[\s\S]*?\*\//g, "");
      const mediaRanges: [number, number][] = [];
      for (const match of css.matchAll(/@media[^{}]*\{/g)) {
        let depth = 1; let cursor = match.index! + match[0].length;
        for (; cursor < css.length && depth > 0; cursor++) { if (css[cursor] === "{") depth++; if (css[cursor] === "}") depth--; }
        mediaRanges.push([match.index!, cursor]);
      }
      const rules = new Map<string, CascadeRule[]>();
      const matcher = /(:root[^{}]*)\{([^{}]*)\}/g;
      for (const match of css.matchAll(matcher)) {
        const selector = match[1]!.trim(); const media = mediaRanges.some(([start, end]) => match.index! > start && match.index! < end);
        for (const declaration of match[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
          const property = declaration[1]!; const list = rules.get(property) ?? [];
          list.push({ selector, value: declaration[2]!.trim(), insideDarkMedia: media, sourceIndex: offset + match.index! }); rules.set(property, list);
        }
      }
      return rules;
    };
    const originalRules = styleRules(original, 0); const generatedRules = styleRules(generated, original.length);
    for (const state of [{ brandBound: true, dataTheme: "light" as const, osDark: false }, { brandBound: true, dataTheme: undefined, osDark: true }, { brandBound: true, dataTheme: "dark" as const, osDark: false }]) {
      const before: Record<string, TokenDefinition> = {}; const after: Record<string, TokenDefinition> = {};
      for (const token of Object.values(TOKENS)) {
        const rules = originalRules.get(token.property)!;
        before[token.property] = { ...token, value: resolveCascade(rules, state)!.value };
        after[token.property] = { ...token, value: resolveCascade([...rules, ...(generatedRules.get(token.property) ?? [])], state)!.value };
      }
      for (const property of Object.keys(TOKENS)) expect(resolveTokenValue(property, after).value, `${property} ${state.dataTheme ?? "OS-dark"}`).toBe(resolveTokenValue(property, before).value);
    }
  });
  it("deduplicates font imports, sorts theme variables and provides safe scoped preview CSS", () => {
    const profile = structuredClone(shipped());
    for (const id of ["tokens.typeface.body", "tokens.typeface.display"]) profile.members[id]!.font = { kind: "fontsource", package: "@fontsource/inter", version: "5.3.0", weights: [600, 400, 400], styles: ["normal", "italic"], license: "OFL-1.1" };
    expect(emit(profile, ["css-fonts"], { header: false })[0]!.contents).toBe('@import "@fontsource/inter/400-italic.css";\n@import "@fontsource/inter/400.css";\n@import "@fontsource/inter/600-italic.css";\n@import "@fontsource/inter/600.css";\n');
    const scoped = emit(profile, ["css-brand"], { full: true, header: false, selectors: { light: '[data-candidate="0"]', mediaDark: '@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) [data-candidate="0"]', dark: ':root[data-theme="dark"] [data-candidate="0"]' } })[0]!.contents;
    expect(scoped.match(/--color-surface-base:/g)).toHaveLength(3);
    expect((scoped.match(/\{/g) ?? []).length).toBe((scoped.match(/\}/g) ?? []).length);
    profile.members["tokens.typeface.body"]!.css.light = "</style>";
    expect(() => emit(profile, ["css-brand"])).toThrow("emit: unsafe CSS text (<)");
  });
});
