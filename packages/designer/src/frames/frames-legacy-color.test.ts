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
 * shadcn role (inverse, glass) is listed, never given an invented variable.
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

  it("keeps the generated shadcn key region fresh, with the legacy brand accent as its only collision", () => {
    expect(renderThemeKeys(themes, themeKeysCss)).toBe(themeKeysCss);
    expect(shadcnColorKeys(themes, themeKeysCss).collisions).toEqual(["--color-accent"]);
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
