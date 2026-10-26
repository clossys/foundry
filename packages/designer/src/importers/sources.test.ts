import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import slotsJson from "../catalog/slots/tokens.json" with { type: "json" };
import tailwindSource from "../catalog/sources/tailwind-default.json" with { type: "json" };
import shadcnSource from "../catalog/sources/shadcn-aria.json" with { type: "json" };
import type { DtcgToken, FillDoc, Slot } from "../catalog-core/types.js";
import { stableStringify } from "../catalog-core/stable.js";
import { parseDeclarationsForSelector } from "../tokens/internal/parse-css.js";
import { TOKENS } from "../tokens/tokens.js";
import { importFoundry } from "./foundry.js";
import { generatedTokenFills } from "./generate-fills.js";
import { offeredFoundryFills } from "./foundry-offered.js";
import { importTailwindDefault } from "./tailwind-default.js";
import { importShadcnAria } from "./shadcn-aria.js";
import { importBrandCss } from "./brand-css.js";
import { sourceSha256 } from "./shared.js";
import { leafCoverage } from "./leaf-coverage.js";
const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(resolve(here, path), "utf8");
const slots = slotsJson as unknown as readonly Slot[];
const installedTailwind = createRequire(import.meta.url)("tailwindcss/package.json").version;
if (installedTailwind !== tailwindSource.pin.version) throw new Error(`pin: tailwindcss installed ${installedTailwind}, fills pinned ${tailwindSource.pin.version}`);
const tailwindCss = readFileSync(createRequire(import.meta.url).resolve("tailwindcss/theme.css"), "utf8");
const shadcnCss = read("vendor/shadcn-aria.css");
const historical = importFoundry({ tokens: Object.values(TOKENS), tokensCss: read("../../styles/tokens.css"), slots });
const foundry = offeredFoundryFills(historical, slots).filter(fill => fill.$extensions["com.clossys.fill"].source === "foundry");
const tailwind = importTailwindDefault({ css: tailwindCss });
const shadcn = importShadcnAria({ css: shadcnCss });
function token(fills: readonly FillDoc[], leaf: string, member: string): DtcgToken {
  let node: unknown = fills.find(fill => fill.$extensions["com.clossys.fill"].slot === `tokens.${leaf}`)!.tokens[leaf];
  for (const part of member.split(".")) node = (node as Record<string, unknown>)[part];
  return node as DtcgToken;
}
describe("pinned upstream token importers", () => {
  it("pins UTF-8 bytes with a SHA-256 independently checked against Node", () => {
    for (const css of ["", "abc", "é🐾", tailwindCss, shadcnCss]) expect(sourceSha256(css)).toBe(createHash("sha256").update(css).digest("hex"));
    expect(sourceSha256(tailwindCss)).toBe(tailwindSource.pin.sha256);
    expect(sourceSha256(shadcnCss)).toBe(shadcnSource.pin.sha256);
    expect(() => importTailwindDefault({ css: tailwindCss + "\n" })).toThrow("source bytes differ");
    expect(() => importShadcnAria({ css: shadcnCss.replace("0.625rem", "1rem") })).toThrow("source bytes differ");
  });
  it("imports all Tailwind token namespaces without treating text shadows as font sizes", () => {
    expect(token(tailwind, "font-size", "base").$value).toEqual({ value: 1, unit: "rem" });
    expect(token(tailwind, "font-weight", "semibold").$value).toBe(600);
    expect(token(tailwind, "spacing", "6xl").$value).toEqual({ value: 8, unit: "rem" });
    expect(token(tailwind, "typeface", "body").$extensions?.["com.clossys.font"]).toEqual({ kind: "system" });
    expect(token(tailwind, "color-ramp", "red.500").$extensions?.["com.clossys.css"]?.raw).toBe("oklch(63.7% 0.237 25.331)");
    const fontFill = tailwind.find(fill => fill.$extensions["com.clossys.fill"].slot === "tokens.font-size")!;
    expect(Object.keys(fontFill.tokens["font-size"]!)).not.toContain("shadow-sm");
    expect(fontFill.$extensions["com.clossys.fill"].unmapped).toContain("--text-shadow-sm");
    expect(fontFill.$extensions["com.clossys.fill"].unmapped).toContain("--font-serif");
    expect(tailwind.find(fill => fill.$extensions["com.clossys.fill"].slot === "tokens.spacing")!.$extensions["com.clossys.fill"].mode).toBe("derived");
  });
  it("preserves the shared shadcn neutral values, missing members and dark alpha", () => {
    expect(shadcn).toHaveLength(9);
    expect(token(shadcn, "accent-color", "default").$value).toEqual({ colorSpace: "oklch", components: [0.205, 0, 0] });
    expect(token(shadcn, "border-color", "base").$extensions?.["com.clossys.modes"]?.dark).toBe("oklch(1 0 0 / 10%)");
    expect(token(shadcn, "radius", "default").$value).toEqual({ value: 0.625, unit: "rem" });
    expect(shadcn[0]!.$extensions["com.clossys.fill"].unmapped).toContain("--sidebar");
    expect(Object.keys(shadcn.find(fill => fill.$extensions["com.clossys.fill"].slot === "tokens.status-color")!.tokens["status-color"]!)).toEqual(["danger"]);
  });
  it("pins every generated cell and the 53-leaf coverage report", () => {
    for (const [directory, fills] of [["foundry", foundry], ["tailwind-default", tailwind], ["shadcn-aria", shadcn]] as const) {
      expect(readdirSync(resolve(here, "../catalog/fills", directory)).filter(file => file.startsWith("tokens.")).sort()).toEqual(fills.map(fill => `${fill.$extensions["com.clossys.fill"].slot}.json`).sort());
      for (const fill of fills) expect(read(`../catalog/fills/${directory}/${fill.$extensions["com.clossys.fill"].slot}.json`)).toBe(stableStringify(fill));
    }
    const report = leafCoverage(slots, generatedTokenFills());
    expect(report.totals.foundry?.filledLeaves).toBe(38);
    expect(report.unionFilledLeaves).toBe(53);
    expect(report.uncoveredLeaves).toEqual([]);
    expect(read("token-leaf-coverage.json")).toBe(stableStringify(report));
  });
});
describe("consumer CSS importer", () => {
  it("imports the neutral consumer fixture using computed light and dark states", () => {
    const fills = importBrandCss({ css: read("vendor/example-brand.css"), source: "example" });
    expect(token(fills, "accent-color", "default").$value).toMatchObject({ hex: "#8250DF" });
    expect(token(fills, "accent-color", "default").$extensions?.["com.clossys.modes"]?.dark).toBe("#A371F7");
    expect(token(fills, "border-color", "panel").$value).toBe("{tokens.border-color.base}");
    expect(fills.every(fill => fill.$extensions["com.clossys.fill"].status === "draft")).toBe(true);
    const css = read("vendor/example-brand.css");
    const light = parseDeclarationsForSelector(css, ":root[data-brand-bound]");
    const dark = parseDeclarationsForSelector(css, ':root[data-brand-bound][data-theme="dark"]');
    let compared = 0;
    for (const slot of slots) for (const [member, property] of Object.entries(slot.contract.emit ?? {})) {
      if (!light.has(property)) continue;
      const imported = token(fills, slot.id.split(".")[1]!, member);
      const raw = imported.$extensions?.["com.clossys.css"]?.raw;
      // Whole-variable aliases deliberately become DTCG references; all other text is exact.
      if (raw !== undefined) expect(raw).toBe(light.get(property));
      else expect(imported.$value).toMatch(/^\{tokens\./);
      if (dark.has(property) && dark.get(property) !== light.get(property)) {
        const expected = dark.get(property)!;
        const alias = /^var\((--[a-z0-9-]+)\)$/.exec(expected);
        if (!alias) expect(imported.$extensions?.["com.clossys.modes"]?.dark).toBe(expected);
      }
      compared++;
    }
    expect(compared).toBe(59);
  });
  it("honors specificity and explicit-light overrides even when dark media comes later", () => {
    const css = `:root[data-brand-bound] { --color-accent: #111111; } :root[data-brand-bound][data-theme="light"] { --color-accent: #222222; } @media (prefers-color-scheme: dark) { :root[data-brand-bound]:not([data-theme="light"]) { --color-accent: #333333; } } :root[data-brand-bound][data-theme="dark"] { --color-accent: #333333; }`;
    expect(() => importBrandCss({ css, source: "example" })).toThrow("theme cascade differs");
  });
  it("rejects unsupported selectors, unsupported media, dark-only values and unbound aliases", () => {
    for (const css of [".other { --color-accent: red; }", "@media print { :root { --color-accent: red; } }", ':root[data-theme="dark"] { --color-accent: red; }', ':root { --color-accent: var(--missing); }']) expect(() => importBrandCss({ css, source: "example" })).toThrow();
  });
});
