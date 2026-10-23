import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import tokenSlots from "../catalog/slots/tokens.json" with { type: "json" };
import { TOKENS } from "../tokens/tokens.js";
import { parseDeclarationsForSelector } from "../tokens/internal/parse-css.js";
import type { DtcgToken, FillDoc, Slot } from "../catalog-core/types.js";
import { importFoundry } from "./foundry.js";

const tokens = Object.values(TOKENS);
const slots = tokenSlots as unknown as readonly Slot[];
const tokensCss = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../styles/tokens.css"), "utf8");
const dark = parseDeclarationsForSelector(tokensCss, ':root[data-theme="dark"]');
function member(fills: readonly FillDoc[], id: string): DtcgToken {
  const slot = id.split(".").slice(0, 4).join(".");
  const fill = fills.find(fill => fill.$extensions["com.clossys.fill"].slot === slot);
  let node: unknown = fill?.tokens;
  for (const segment of id.split(".").slice(1)) node = (node as Record<string, unknown>)[segment];
  return node as DtcgToken;
}
const raw = (text: string) => ({ "com.clossys.css": { raw: text } });

describe("importFoundry", () => {
  it("preserves exact typed light and differing dark values", () => {
    const fills = importFoundry({ tokens, tokensCss, slots });
    expect(member(fills, "tokens.role.color.surface.base")).toEqual({ $type: "color", $value: { colorSpace: "oklch", components: [0.9702, 0, 0] }, $extensions: { ...raw(TOKENS["--color-surface-base"]!.value), "com.clossys.modes": { dark: { colorSpace: "oklch", components: [0.19, 0, 0] } } } });
    expect(member(fills, "tokens.scale.color.fixed.chart-categorical-6")).toEqual({ $type: "color", $value: { colorSpace: "srgb", components: [0, 0.513725, 0], hex: TOKENS["--color-chart-categorical-6"]!.value }, $extensions: raw(TOKENS["--color-chart-categorical-6"]!.value) });
    expect(member(fills, "tokens.role.depth.elevation.floating")).toEqual({ $type: "shadow", $value: TOKENS["--ui-elevation-floating"]!.value, $extensions: { ...raw(TOKENS["--ui-elevation-floating"]!.value), "com.clossys.modes": { dark: dark.get("--ui-elevation-floating")! } } });
  });
  it("keeps alias targets and composite reads", () => {
    const fills = importFoundry({ tokens, tokensCss, slots });
    expect(member(fills, "tokens.role.color.focus.default")).toEqual({ $type: "color", $value: "{tokens.role.color.action.default}" });
    expect(member(fills, "tokens.role.depth.elevation.raised")).toEqual({ $type: "shadow", $value: TOKENS["--ui-elevation-raised"]!.value, $extensions: { "com.clossys.css": { raw: TOKENS["--ui-elevation-raised"]!.value, reads: ["tokens.role.color.border.base"] } } });
  });
  it("classifies tracking, family, number, bezier and per-member types with raw text", () => {
    const fills = importFoundry({ tokens, tokensCss, slots });
    expect(member(fills, "tokens.scale.type.tracking.tight")).toEqual({ $type: "number", $value: -0.02, $extensions: { ...raw(TOKENS["--tracking-tight"]!.value), "com.clossys.unit": "em" } });
    expect(member(fills, "tokens.scale.type.family.mono")).toEqual({ $type: "fontFamily", $value: ["ui-monospace", "SF Mono", "Menlo", "Consolas", "monospace"], $extensions: { ...raw(TOKENS["--font-mono"]!.value), "com.clossys.font": { kind: "system" } } });
    expect(member(fills, "tokens.scale.depth.layer-order.modal")).toEqual({ $type: "number", $value: 50, $extensions: raw(TOKENS["--ui-z-modal"]!.value) });
    expect(member(fills, "tokens.scale.motion.easing.default")).toEqual({ $type: "cubicBezier", $value: [0.2, 0, 0, 1], $extensions: raw(TOKENS["--ease-default"]!.value) });
    expect(member(fills, "tokens.scale.shape.border-width.icon-stroke")).toEqual({ $type: "number", $value: 2, $extensions: raw(TOKENS["--ui-icon-stroke"]!.value) });
  });
  it("provides the three draft spring numbers", () => {
    const fills = importFoundry({ tokens, tokensCss, slots });
    for (const [key, value] of Object.entries({ stiffness: 300, damping: 30, mass: 1 })) expect(member(fills, `tokens.scale.motion.spring.default.${key}`)).toEqual({ $type: "number", $value: value });
  });
  it("rejects an alias whose target is unbound", () => {
    const changed = tokens.map(token => token.property === "--color-focus-ring" ? { ...token, value: "var(--unbound, red)" } : token);
    expect(() => importFoundry({ tokens: changed, tokensCss, slots })).toThrow(new Error("importer: --color-focus-ring aliases unbound --unbound"));
  });
  it("rejects a missing dark value", () => {
    const missing = tokensCss.replaceAll(/--color-surface-base\s*:[^;]*;/g, "");
    expect(() => importFoundry({ tokens, tokensCss: missing, slots })).toThrow(new Error("importer: --color-surface-base has no dark value"));
  });
  it("keeps automatic and explicit dark declarations identical", () => {
    expect([...parseDeclarationsForSelector(tokensCss, ':root:not([data-theme="light"])')]).toEqual([...dark]);
  });
});
