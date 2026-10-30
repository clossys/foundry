import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as namespace from "./index.js";
import { TOKENS, TOKEN_FAMILIES } from "./tokens.js";

// The first RED run deliberately uses the existing namespace, so missing
// additions fail an authored assertion rather than module resolution.
type Guidance = {
  purpose: string; use: string; misuse: string;
  application: { cssProperty: string; valueType: string; context: string };
  specimen: string;
};
type Group = { id: string; label: string; families: readonly { id: string; label: string; properties: readonly string[] }[] };
const additions = namespace as unknown as {
  TOKEN_GUIDANCE?: Readonly<Record<string, Guidance>>;
  TOKEN_DISPLAY_GROUPS?: readonly Group[];
};
const expected = {
  color: { surface: 9, ink: 8, line: 5, accent: 5, action: 5, control: 5, status: 12, chart: 22, neutral: 11, overlay: 3, skeleton: 1 },
  typography: { "font-families": 3, "display-settings": 4, "font-sizes": 13, "letter-spacing": 4, "line-height": 2 },
  spacing: { scale: 11, "page-inset": 1, "density-spacing": 2, "brandmark-gaps": 3 },
  sizing: { "content-widths": 7, "app-regions": 12, "interaction-target": 9, "row-height": 3, "icon-sizes": 3, "brandmark-heights": 3, "scene-card-width": 1 },
  shape: { "corner-radii": 8, "border-widths": 4, "icon-stroke": 1 },
  effects: { opacity: 4, "backdrop-blur": 2, shadows: 4, rings: 5 },
  layering: { "stacking-order": 11 },
  motion: { duration: 12, easing: 6 },
  responsive: { breakpoints: 6 },
};

describe("shared token guidance and display taxonomy", () => {
  it("covers TOKENS bidirectionally with exactly one guidance entry per property", () => {
    expect(additions.TOKEN_GUIDANCE, "TOKEN_GUIDANCE must be public").toBeDefined();
    expect(Object.keys(additions.TOKEN_GUIDANCE ?? {}).sort()).toEqual(Object.keys(TOKENS).sort());
  });

  it("places all 230 properties once in nine groups and 38 explicitly counted families", () => {
    expect(additions.TOKEN_DISPLAY_GROUPS, "TOKEN_DISPLAY_GROUPS must be public").toBeDefined();
    const groups = additions.TOKEN_DISPLAY_GROUPS ?? [];
    expect(groups.map(group => group.id)).toEqual(Object.keys(expected));
    expect(groups.flatMap(group => group.families)).toHaveLength(38);
    const leaves = groups.flatMap(group => group.families.flatMap(family => family.properties));
    expect(leaves).toHaveLength(230);
    expect(new Set(leaves).size).toBe(230);
    expect([...leaves].sort()).toEqual(Object.keys(TOKENS).sort());
    for (const group of groups) {
      expect(group.label.trim().length).toBeGreaterThan(0);
      const counts = Object.fromEntries(group.families.map(family => [family.id, family.properties.length]));
      expect(counts).toEqual(expected[group.id as keyof typeof expected]);
      for (const family of group.families) expect(family.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives every property distinct meaningful purpose, use and misuse guidance", () => {
    expect(additions.TOKEN_GUIDANCE).toBeDefined();
    const entries = Object.entries(additions.TOKEN_GUIDANCE ?? {});
    expect(entries).toHaveLength(230);
    for (const field of ["purpose", "use", "misuse"] as const) {
      const texts = entries.map(([, guidance]) => guidance[field].trim());
      expect(texts.every(text => text.length > 20), field).toBe(true);
      expect(new Set(texts).size, `${field} must distinguish properties`).toBe(230);
    }
    for (const [property, guidance] of entries) {
      expect(new Set([guidance.purpose, guidance.use, guidance.misuse]).size, property).toBe(3);
      expect(guidance.application.context.length, property).toBeGreaterThan(15);
      expect(guidance.application.cssProperty.length, property).toBeGreaterThan(0);
      expect(guidance.application.valueType.length, property).toBeGreaterThan(0);
      expect(guidance.specimen.length, property).toBeGreaterThan(0);
      for (const mechanical of ["value", "default", "brandable", "themeDependent", "sourceFamily"]) {
        expect(Object.hasOwn(guidance, mechanical), `${property}: derive ${mechanical} from TOKENS`).toBe(false);
      }
    }
  });

  it("uses semantic scope and CSS application rather than group or equal-value inference", () => {
    const guidance = additions.TOKEN_GUIDANCE ?? {};
    expect(guidance["--ui-alpha-disabled"]?.application).toMatchObject({ cssProperty: "opacity", valueType: "number" });
    expect(guidance["--ui-ring-focus"]?.application).toMatchObject({ cssProperty: "box-shadow", valueType: "shadow" });
    expect(guidance["--font-display-scale-x"]?.application).toMatchObject({ cssProperty: "transform", valueType: "number" });
    expect(guidance["--ui-icon-stroke"]?.application).toMatchObject({ cssProperty: "stroke-width", valueType: "number" });
    expect(guidance["--breakpoint-tablet"]?.application).toMatchObject({ cssProperty: "@media (min-width)", valueType: "length" });
    expect(guidance["--color-chart-axis-label"]?.application.cssProperty).toBe("fill");
    expect(guidance["--color-chart-surface"]?.application.cssProperty).toBe("stroke");
    expect(guidance["--color-chart-surface"]?.application.context).toMatch(/transparent/i);
    expect(guidance["--color-chart-diverging-neutral"]?.use).toMatch(/nonzero totals/i);
    expect(guidance["--ease-bounce"]?.application.context).toMatch(/do not promise geometric overshoot/i);
    const groups = additions.TOKEN_DISPLAY_GROUPS ?? [];
    const placement = (property: string) => groups.flatMap(group => group.families.filter(family => family.properties.includes(property)).map(family => `${group.id}/${family.id}`));
    expect(placement("--color-chart-axis")).toEqual(["color/chart"]);
    expect(placement("--ui-alpha-disabled")).toEqual(["effects/opacity"]);
    expect(placement("--ui-width-page-padding-x")).toEqual(["spacing/page-inset"]);
    expect(placement("--ui-density-row")).toEqual(["sizing/row-height"]);
    expect(guidance["--color-ink-secondary"]?.purpose).not.toBe(guidance["--color-ink-link"]?.purpose);
    expect(guidance["--ui-ring-on-inverse"]?.misuse).toMatch(/focus/i);
  });

  it("leaves the source identity, defaults, flags and 32 legacy families intact", () => {
    expect(Object.keys(TOKENS)).toHaveLength(230);
    expect(TOKEN_FAMILIES).toHaveLength(32);
    expect(Object.values(TOKENS).filter(token => token.themeDependent)).toHaveLength(56);
    for (const [property, token] of Object.entries(TOKENS)) expect(token.property).toBe(property);
    expect(TOKENS["--color-chart-axis"]?.family).toBe("chart");
    expect(TOKENS["--ui-alpha-disabled"]?.family).toBe("alpha");
    expect(TOKENS["--ui-density-row"]?.family).toBe("density");
  });

  it("gives every property one generated-sheet record, including aliases and composites", () => {
    const sheet = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "TOKENS.md"), "utf8");
    const records = [...sheet.matchAll(/^##### `(--[^`]+)`$/gm)].map(match => match[1]);
    expect(records).toHaveLength(230);
    expect(new Set(records).size).toBe(230);
    expect(records.sort()).toEqual(Object.keys(TOKENS).sort());
    expect(records).toContain("--color-ink-on-accent");
    expect(records).toContain("--ui-ring-focus");
    expect(records).toContain("--color-control-tonal-hover");
    expect(records).toContain("--ui-icon-sm");
  });
});
