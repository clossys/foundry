import { readdirSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { expect, it } from "vitest";
import { checkWiring, type WiringSource } from "../../catalog-core/wiring.js";

/**
 * The system canvas sits in Studio, above Components, under the same WL4 rule as
 * `studio-raw-values.test.ts` (which reads only the top-level Studio folder):
 * no inline style, arbitrary utility, hard-coded duration, var() fallback or
 * numeric layout constant. Its geometry comes from tokens and is placed by the
 * canvas blocks.
 */
const dir = resolvePath(process.cwd(), "src/studio/system-canvas");
const sources = (): WiringSource[] => readdirSync(dir)
  .filter(file => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
  .map(file => ({ path: `src/studio/system-canvas/${file}`, content: readFileSync(resolvePath(dir, file), "utf8"), layer: "sections" as const }));

it("measures every system canvas source", () => {
  expect(sources().map(source => source.path)).toContain("src/studio/system-canvas/SystemCanvas.tsx");
  expect(sources().map(source => source.path)).toContain("src/studio/system-canvas/layout.ts");
});

it("system canvas sources carry no raw value above Components: WL4 is 0", () => {
  const findings = checkWiring({ sources: sources() }).findings.filter(finding => finding.code === "WL4");
  expect(findings.map(finding => `${finding.file}:${finding.line} ${finding.evidence}`)).toEqual([]);
});
