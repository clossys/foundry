import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import tokenSlots from "../catalog/slots/tokens.json" with { type: "json" };
import tailwindSource from "../catalog/sources/tailwind-default.json" with { type: "json" };
import { parseFill } from "../catalog-core/cell.js";
import { stableStringify } from "../catalog-core/stable.js";
import type { DtcgToken, FillDoc, Slot, Source } from "../catalog-core/types.js";
import { importTailwindDefault } from "./tailwind-default.js";

const slots = tokenSlots as unknown as readonly Slot[];
const source = tailwindSource as unknown as Source;
const here = dirname(fileURLToPath(import.meta.url));
const themePath = createRequire(import.meta.url).resolve("tailwindcss/theme.css");
const themeCss = readFileSync(themePath, "utf8");
const installed = (JSON.parse(readFileSync(resolve(dirname(themePath), "package.json"), "utf8")) as { version: string }).version;
const fills = importTailwindDefault({ themeCss, source, slots });
const byId = new Map(fills.map(fill => [fill.$extensions["com.clossys.fill"].slot, fill]));
const declared = new Map<string, number>();
themeCss.split("\n").forEach((text, index) => { const match = /^\s+(--[a-z0-9-]+)\s*:/.exec(text); if (match) declared.set(match[1]!, index + 1); });

function token(slot: string, member: string): DtcgToken {
  let node: unknown = byId.get(slot)?.tokens;
  for (const segment of [slot.split(".")[1]!, ...member.split(".")]) node = (node as Record<string, unknown> | undefined)?.[segment];
  return node as DtcgToken;
}
function lines(node: unknown, found: number[] = []): number[] {
  if (node === null || typeof node !== "object") return found;
  const record = node as Record<string, unknown>;
  if (Object.hasOwn(record, "$value")) {
    const line = (record.$extensions as { "com.clossys.source"?: { line: number } } | undefined)?.["com.clossys.source"]?.line;
    if (line !== undefined) found.push(line);
  } else for (const child of Object.values(record)) lines(child, found);
  return found;
}
const css = (text: string) => ({ "com.clossys.css": { raw: text } });
const from = (line: number, text: string) => ({ ...css(text), "com.clossys.source": { line } });
const sample = (text: string): FillDoc[] => importTailwindDefault({ themeCss: text, source, slots });

describe("tailwind-default pin", () => {
  it("fills are pinned to the installed tailwindcss and its theme.css bytes", () => {
    expect(installed, `pin: tailwindcss installed ${installed}, fills pinned ${source.pin!.version}`).toBe(source.pin!.version);
    expect(createHash("sha256").update(themeCss).digest("hex")).toBe(source.pin!.sha256);
    for (const fill of fills) {
      const meta = fill.$extensions["com.clossys.fill"];
      expect(meta.pin).toEqual(source.pin);
      expect(meta.sourceAddress).toBe("tailwindcss@4.3.3/theme.css");
    }
  });
});

describe("importTailwindDefault", () => {
  it("matches every generated cell against its committed JSON file", async () => {
    expect(fills.map(fill => fill.$extensions["com.clossys.fill"].slot)).toEqual([
      "tokens.blur", "tokens.breakpoint", "tokens.color-ramp", "tokens.easing", "tokens.font-size", "tokens.font-weight",
      "tokens.letter-spacing", "tokens.line-height", "tokens.radius", "tokens.shadow", "tokens.spacing", "tokens.typeface",
    ]);
    for (const fill of fills) await expect(stableStringify(fill)).toMatchFileSnapshot(resolve(here, `../catalog/fills/tailwind-default/${fill.$extensions["com.clossys.fill"].slot}.json`));
    expect(readdirSync(resolve(here, "../catalog/fills/tailwind-default")).sort()).toEqual(fills.map(fill => fill.$extensions["com.clossys.fill"].slot + ".json"));
  });
  it("writes every colour step of every hue as typed oklch with the exact upstream text", () => {
    const hues = Object.keys((byId.get("tokens.color-ramp")!.tokens as { "color-ramp": Record<string, unknown> })["color-ramp"]);
    expect(hues).toHaveLength(26);
    expect(lines(byId.get("tokens.color-ramp")!.tokens)).toHaveLength(286);
    expect(token("tokens.color-ramp", "red.500")).toEqual({ $type: "color", $value: { colorSpace: "oklch", components: [0.637, 0.237, 25.331], alpha: 1 }, $extensions: from(declared.get("--color-red-500")!, "oklch(63.7% 0.237 25.331)") });
    expect(token("tokens.color-ramp", "neutral.50").$value).toEqual({ colorSpace: "oklch", components: [0.985, 0, "none"], alpha: 1 });
    expect(byId.get("tokens.color-ramp")!.$extensions["com.clossys.fill"]).toMatchObject({
      mode: "implementation", relation: "superset", builtOn: ["tailwind-v4-theme"], conforms: ["dtcg#alias", "dtcg#color", "dtcg#format", "dtcg#types"], trust: "pinned-upstream", author: "third-party", license: "MIT", status: "draft",
    });
  });
  it("keeps a size and its line height in separate leaves", () => {
    expect(token("tokens.font-size", "2xl")).toEqual({ $type: "dimension", $value: { value: 1.5, unit: "rem" }, $extensions: from(declared.get("--text-2xl")!, "1.5rem") });
    expect(token("tokens.font-size", "xs--line-height")).toBeUndefined();
    expect(token("tokens.line-height", "xs")).toEqual({ $type: "number", $value: 1.333333, $extensions: from(declared.get("--text-xs--line-height")!, "calc(1 / 0.75)") });
    expect(token("tokens.line-height", "5xl")).toEqual({ $type: "number", $value: 1, $extensions: from(declared.get("--text-5xl--line-height")!, "1") });
    expect(token("tokens.line-height", "snug")).toEqual({ $type: "number", $value: 1.375, $extensions: from(declared.get("--leading-snug")!, "1.375") });
    expect(Object.keys((byId.get("tokens.font-size")!.tokens as { "font-size": object })["font-size"])).toHaveLength(13);
    expect(Object.keys((byId.get("tokens.line-height")!.tokens as { "line-height": object })["line-height"])).toHaveLength(18);
  });
  it("maps weights, tracking, faces, breakpoints, radii, blur, easing and shadows", () => {
    expect(token("tokens.font-weight", "bold")).toEqual({ $type: "fontWeight", $value: 700, $extensions: from(declared.get("--font-weight-bold")!, "700") });
    expect(token("tokens.letter-spacing", "tight")).toEqual({ $type: "number", $value: -0.025, $extensions: { ...from(declared.get("--tracking-tight")!, "-0.025em"), "com.clossys.unit": "em" } });
    expect(token("tokens.typeface", "mono").$value).toEqual(["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Courier New", "monospace"]);
    expect(token("tokens.typeface", "mono").$extensions).toMatchObject({ "com.clossys.font": { kind: "system" } });
    expect(token("tokens.typeface", "body").$value).toHaveLength(12);
    expect(token("tokens.typeface", "serif")).toBeUndefined();
    expect(token("tokens.breakpoint", "2xl").$value).toEqual({ value: 96, unit: "rem" });
    expect(token("tokens.radius", "4xl").$value).toEqual({ value: 2, unit: "rem" });
    expect(token("tokens.blur", "3xl").$value).toEqual({ value: 64, unit: "px" });
    expect(token("tokens.easing", "in-out")).toEqual({ $type: "cubicBezier", $value: [0.4, 0, 0.2, 1], $extensions: from(declared.get("--ease-in-out")!, "cubic-bezier(0.4, 0, 0.2, 1)") });
    expect(token("tokens.shadow", "sm")).toEqual({ $type: "shadow", $value: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)", $extensions: from(declared.get("--shadow-sm")!, "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)") });
    expect(byId.get("tokens.shadow")!.$extensions["com.clossys.fill"].conforms).toEqual(["dtcg#alias", "dtcg#format"]);
    expect(byId.get("tokens.typeface")!.$extensions["com.clossys.fill"]).toMatchObject({ relation: "subset" });
  });
  it("derives the ten spacing members from the upstream multiplier", () => {
    const spacing = (name: string) => (token("tokens.spacing", name).$value as { value: number }).value;
    expect(["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"].map(spacing)).toEqual([0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8]);
    expect(token("tokens.spacing", "md")).toEqual({ $type: "dimension", $value: { value: 0.75, unit: "rem" }, $extensions: from(declared.get("--spacing")!, "0.75rem") });
    expect(byId.get("tokens.spacing")!.$extensions["com.clossys.fill"]).toMatchObject({
      mode: "derived", relation: "derived", derivation: { from: "tailwind-v4-theme#spacing-multiplier", rule: "n x --spacing" },
    });
    expect(spacing("xs")).toBeCloseTo(0.25);
    expect(sample("@theme default {\n  --spacing: 0.5rem;\n}").map(fill => (fill.tokens as { spacing: { xs: { $value: { value: number } } } }).spacing.xs.$value.value)).toEqual([0.5]);
  });
  it("accounts for every upstream declaration exactly once", () => {
    const carriers = fills.filter(fill => fill.$extensions["com.clossys.fill"].unmapped !== undefined);
    expect(carriers.map(fill => fill.$extensions["com.clossys.fill"].slot)).toEqual(["tokens.blur"]);
    const unmapped = carriers[0]!.$extensions["com.clossys.fill"].unmapped!;
    expect(unmapped).toEqual(expect.arrayContaining(["--color-black", "--color-white", "--font-serif", "--container-3xs", "--aspect-video", "--animate-spin", "--text-shadow-sm", "--default-font-family", "--blur", "--shadow", "--radius", "--max-width-prose"]));
    expect(unmapped).not.toContain("--spacing");
    const mapped = new Set(fills.flatMap(fill => lines(fill.tokens)));
    const all = [...mapped, ...unmapped.map(name => declared.get(name)!)].sort((a, b) => a - b);
    expect(all).toEqual([...declared.values()].sort((a, b) => a - b));
  });
  it("sends names without a rule to unmapped and keeps the rest", () => {
    const result = sample("@theme default {\n  --color-black: #000;\n  --container-sm: 24rem;\n  --spacing: 0.25rem;\n  --radius-md: 0.375rem;\n  --text-shadow-sm: 0 1px red;\n}");
    expect(result.map(fill => fill.$extensions["com.clossys.fill"].slot)).toEqual(["tokens.radius", "tokens.spacing"]);
    expect(result[0]!.$extensions["com.clossys.fill"].unmapped).toEqual(["--color-black", "--container-sm", "--text-shadow-sm"]);
  });
  it("rejects a theme without a usable spacing multiplier", () => {
    expect(() => sample("@theme default {\n  --radius-md: 0.375rem;\n}")).toThrow(new Error("importer: --spacing is missing"));
    expect(() => sample("@theme default {\n  --spacing: 4px;\n}")).toThrow(new Error("importer: --spacing is not a rem length"));
  });
  it("rejects a source without a package pin and a missing slot", () => {
    expect(() => importTailwindDefault({ themeCss, source: { ...source, pin: undefined }, slots })).toThrow(new Error("importer: source tailwind-default has no package pin"));
    expect(() => importTailwindDefault({ themeCss, source, slots: slots.filter(slot => slot.id !== "tokens.blur") })).toThrow(new Error("importer: no slot tokens.blur"));
  });
  it("parses every generated cell", () => {
    for (const fill of fills) expect(parseFill(fill).findings).toEqual([]);
  });
});
