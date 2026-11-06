// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { legacyColorUses, recomposeLegacyColors, type LegacyColorMap } from "../catalog-core/legacy-color.js";
import { handAuthoredThemeKeys, renderThemeKeys, shadcnColorKeys, type ThemesTokenSlot } from "../compiled-css/shadcn-theme-keys.js";

/**
 * H-TOKEN (GATES-RED round 3): frames compose on the stock shadcn semantic variables.
 * `styles/legacy-color-map.json` records once where each legacy Foundry colour key goes;
 * the shadcn `--color-*` keys are generated from the themes layer. A frame source that
 * still uses a legacy name the map gives a shadcn role fails here. A legacy name with no
 * shadcn role (glass, status, neutral) is listed, never given an invented variable.
 *
 * G7 (GATES-RED round 4, planner decision): the inverse plate is the shadcn
 * foreground/background swap (`bg-foreground text-background`); an inverse state that was
 * a translucent tone of the plate's ink keeps its legacy opacity as an `alpha` on the same
 * variable. The 36 inverse uses the frame layer had, now in the frame layer and in the
 * component plates it reads (Card GROUND_PAINT, button-classes INVERSE_CONTROL_INK,
 * Brandmark, Logomark, ToggleButton), carry no inverse legacy utility. The token-layer
 * fallback chain in components/internal/ui-vars.ts (a custom-property read of the legacy
 * token with its literal fallback) stays on the legacy token layer.
 */
const pkg = new URL("../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, pkg), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(new URL(dir, pkg), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);

interface ConsumptionFill { slot: string; sourceFiles?: string[] }
const fills = (report: string): ConsumptionFill[] => (JSON.parse(read(report)) as { fills: ConsumptionFill[] }).fills;
const local = (file: string): string => file.replace(/^packages\/designer\//, "");
// The frame layer, derived exactly as `frames-wiring.test.ts` derives it: registered component fills under src/shell are Components.
const frameFiles = new Set(fills("src/catalog/reports/sections-frames-consumption.json").filter(fill => fill.slot.startsWith("frames.")).flatMap(fill => (fill.sourceFiles ?? []).map(local)));
const componentFiles = new Set(fills("src/catalog/reports/components-consumption.json").flatMap(fill => (fill.sourceFiles ?? []).map(local)).filter(file => /^src\/(?:frames|shell)\//.test(file) && !frameFiles.has(file)));
const isSource = (path: string): boolean => /\.(?:tsx?|css)$/.test(path) && !/\.test\.tsx?$|\.check\.tsx$/.test(path);
const sources = [...walk("src/frames"), ...walk("src/shell")]
  .filter(path => isSource(path) && !componentFiles.has(path))
  .map(path => ({ path, content: read(path) }));

const legacyMap = JSON.parse(read("styles/legacy-color-map.json")) as LegacyColorMap & { schema: string };
const themeKeysCss = read("styles/theme-keys.css");
const themes = JSON.parse(read("src/catalog/slots/themes.json")) as ThemesTokenSlot[];
const mapped = (rows: ReturnType<typeof legacyColorUses>) => rows.filter(row => row.shadcn !== null).map(row => `${row.file}:${row.line} ${row.use} -> ${row.shadcn}`);

describe("legacy colour map (H-TOKEN)", () => {
  it("records every hand-authored legacy colour key exactly once", () => {
    expect(legacyMap.schema).toBe("clossys.legacy-color-map/1");
    const legacyKeys = [...handAuthoredThemeKeys(themeKeysCss)].filter(key => key.startsWith("--color-")).map(key => key.slice("--color-".length)).sort();
    expect(Object.keys(legacyMap.map).sort()).toEqual(legacyKeys);
  });

  it("maps only onto a shadcn variable the themes layer emits", () => {
    const emitted = new Set(themes.filter(token => token.contract.$type === "color").map(token => token.contract.emit!.default!.slice(2)));
    for (const [legacy, target] of Object.entries(legacyMap.map)) if (target.shadcn) expect(emitted.has(target.shadcn), legacy).toBe(true);
  });

  it("keeps the generated shadcn key region fresh, with no collision now the legacy brand accent is migrated (G4)", () => {
    expect(renderThemeKeys(themes, themeKeysCss)).toBe(themeKeysCss);
    expect(shadcnColorKeys(themes, themeKeysCss).collisions).toEqual([]);
    expect(themeKeysCss).toContain("--color-accent: var(--accent);");
  });
});

const INVERSE_KEYS = Object.keys(legacyMap.map).filter(key => key.includes("inverse") && !key.includes("glass")).sort();
// The component plates the frame layer's inverse uses moved to (GATES-RED round 4, G1/G2).
const INVERSE_PLATES = ["src/components/Card.tsx", "src/components/button-classes.ts", "src/components/ToggleButton.tsx", "src/components/Logomark.tsx", "src/shell/Brandmark.tsx"];

describe("inverse plate = shadcn foreground/background swap (G7)", () => {
  it("maps every inverse key onto the swap, with no new variable", () => {
    expect(INVERSE_KEYS).toHaveLength(11);
    const swap = new Set(["foreground", "background", "card-foreground", "primary-foreground"]);
    for (const key of INVERSE_KEYS) {
      const target = legacyMap.map[key]!;
      expect(target.shadcn !== null && swap.has(target.shadcn), key).toBe(true);
      if (target.alpha !== undefined) expect(Number.isInteger(target.alpha) && target.alpha > 0 && target.alpha < 100, key).toBe(true);
    }
    expect(legacyMap.map["surface-inverse"]).toMatchObject({ shadcn: "foreground" });
    expect(legacyMap.map["ink-on-inverse"]).toMatchObject({ shadcn: "background" });
  });

  it("leaves no inverse legacy name in the frame layer or the component plates it reads", () => {
    const plates = INVERSE_PLATES.map(path => ({ path, content: read(path) }));
    const left = legacyColorUses([...sources, ...plates], legacyMap).filter(row => row.legacy.includes("inverse") && !row.legacy.includes("glass"));
    expect(left.map(row => `${row.file}:${row.line} ${row.use}`)).toEqual([]);
    expect(read("src/components/Card.tsx")).toContain(`inverse: { surface: "bg-foreground", primary: "text-background", secondary: "text-background/75", border: "border-background/14", focus: "focus-visible:outline-background" }`);
  });

  it("recomposes an inverse use to the swap, keeps the legacy alpha, and never stacks two opacities (mutation)", () => {
    const content = `["bg-surface-inverse text-ink-on-inverse", "border-line-on-inverse hover:bg-control-tonal-inverse-hover", "border-line-on-inverse/50", "var(--color-line-on-inverse)"]`;
    const out = recomposeLegacyColors(content, legacyMap);
    expect(out).toBe(`["bg-foreground text-background", "border-background/14 hover:bg-background/16", "border-line-on-inverse/50", "var(--color-line-on-inverse)"]`);
    expect(mapped(legacyColorUses([{ path: "m.ts", content: out }], legacyMap)).map(row => row.replace(/:\d+ /, " "))).toEqual([
      "m.ts --color-line-on-inverse -> background/14",
      "m.ts border-line-on-inverse -> background/14",
    ]);
  });
});

describe("frames use no mapped legacy colour name (H-TOKEN)", () => {
  it("scans the frame layer", () => {
    expect(sources.length).toBeGreaterThan(20);
    expect(sources.map(source => source.path)).toEqual(expect.arrayContaining(["src/frames/AppFrame.tsx", "src/shell/SiteHeader.tsx", "src/shell/internal/shell-ground.ts"]));
  });

  it("uses the shadcn variable wherever the map gives a legacy name a shadcn role", () => {
    expect(mapped(legacyColorUses(sources, legacyMap))).toEqual([]);
  });

  it("leaves only names the map records with no shadcn role", () => {
    for (const row of legacyColorUses(sources, legacyMap)) expect(legacyMap.map[row.legacy]!.shadcn, `${row.file}:${row.line} ${row.use}`).toBeNull();
  });

  it("flags a reintroduced legacy utility and variable, and the recompose swap clears them (mutation)", () => {
    const mutated = sources.map(source => source.path !== "src/frames/AuthFrame.tsx" ? source
      : { ...source, content: `${source.content}\nexport const legacy = ["hover:bg-surface-sunken/80 text-ink-primary", "var(--color-line-base)"];\n` });
    expect(mapped(legacyColorUses(mutated, legacyMap)).map(row => row.replace(/:\d+ /, " "))).toEqual([
      "src/frames/AuthFrame.tsx --color-line-base -> border",
      "src/frames/AuthFrame.tsx hover:bg-surface-sunken -> muted",
      "src/frames/AuthFrame.tsx text-ink-primary -> foreground",
    ]);
    const swapped = mutated.map(source => ({ ...source, content: recomposeLegacyColors(source.content, legacyMap) }));
    expect(mapped(legacyColorUses(swapped, legacyMap))).toEqual([]);
    expect(swapped.find(source => source.path === "src/frames/AuthFrame.tsx")!.content).toContain(`["hover:bg-muted/80 text-foreground", "var(--border)"]`);
  });
});
