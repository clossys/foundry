import { readdirSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { expect, it } from "vitest";
import { checkWiring, type WiringSource } from "../catalog-core/wiring.js";

/**
 * Studio sits above Components, so its own sources read tokens and hand values off through registered
 * components and blocks: no inline style, no arbitrary utility, no hard-coded duration or var() fallback
 * (WL4). The specimen files (WIRE-5b) and the specimen sample dataset render sample values by design and
 * are measured with the specimens, not here.
 */
const SPECIMEN_FILES = new Set([
  "asset-specimens.tsx", "component-specimens.tsx", "component-specimen-samples.tsx", "previews.tsx", "frame-preview.tsx",
  "planned-surface-previews.tsx", "surface-preview-samples.tsx", "ratio-fixture.tsx", "specimen-dataset.ts",
]);
const dir = resolvePath(process.cwd(), "src/studio");
const studioSources = (): WiringSource[] => readdirSync(dir)
  .filter(file => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !SPECIMEN_FILES.has(file))
  .map(file => ({ path: `src/studio/${file}`, content: readFileSync(resolvePath(dir, file), "utf8"), layer: "sections" as const }));

it("measures the Studio canvas sources it names", () => {
  const paths = studioSources().map(source => source.path);
  for (const file of ["canvas-boards.tsx", "CandidateCell.tsx",    "component-specimen-contained.tsx"])
    expect(paths).toContain(`src/studio/${file}`);
});

it("Studio's own sources carry no raw value above Components: WL4 is 0", () => {
  const findings = checkWiring({ sources: studioSources() }).findings.filter(finding => finding.code === "WL4");
  expect(findings.map(finding => `${finding.file}:${finding.line} ${finding.evidence}`)).toEqual([]);
});
