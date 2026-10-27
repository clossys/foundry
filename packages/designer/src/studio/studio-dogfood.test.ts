// @vitest-environment node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runDogfood, type DogfoodFinding, type DogfoodInput } from "../catalog-core/dogfood.js";
import { dogfoodSources } from "../library-cli/cli.js";
import { extractStyleCandidates } from "../style-extract.js";

/**
 * Zero-allowlist dogfood check for the Studio (designer-whole-done criterion 9).
 *
 * Studio is a consumer of the Foundry library: it must compose registered components and tokens,
 * never raw react-aria-components, raw html controls, raw colour values or inline styles. The DF
 * scanner runs here in consumer mode with no exception manifest, so DF6 renewals and same-line
 * `token-gate:ignore` comments suppress nothing. Raw colours are read with the scanner's own
 * extractor over each whole source file, because the JSX walk only parses .tsx/.jsx attributes
 * and a colour in a .ts data module would otherwise be invisible.
 *
 * Shell and frames are not scanned as consumers: both runners resolve them as the registered
 * library boundary (they are the components that implement on React Aria), so consumer rules do
 * not apply to their own source.
 */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const STUDIO = "src/studio/";

type Category = "raw-rac-import" | "raw-html-control" | "raw-colour" | "inline-style";
interface Residual { category: Category; file: string; line: number; evidence: string }

const CONTROL_TAGS: readonly string[] = ["button", "input", "select", "textarea", "details", "summary"];
const INLINE_STYLE = "Consumer inline styles bypass library surfaces and tokens.";
const COLOUR_IN_ARBITRARY = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\(/i;

function categorize(finding: DogfoodFinding): Category | undefined {
  if (finding.code === "DF5" && finding.tag === "import") return "raw-rac-import";
  if (finding.code === "DF1" && CONTROL_TAGS.includes(finding.tag)) return "raw-html-control";
  if (finding.code === "DF2" && finding.evidence === INLINE_STYLE) return "inline-style";
  return undefined;
}

/** Consumer mode, zero exceptions, no page leases: only the boundary rules decide. */
function scan(files: DogfoodInput["files"], localModules: DogfoodInput["localModules"] = {}) {
  const report = runDogfood({ files, localModules, exceptions: [], consumerBoundary: { pages: [], sourceImports: {} } });
  const residuals: Residual[] = [
    ...report.findings.flatMap(finding => {
      const category = categorize(finding);
      return category ? [{ category, file: finding.file, line: finding.line, evidence: `<${finding.tag}> ${finding.evidence}` }] : [];
    }),
    ...files.flatMap(row => extractStyleCandidates(row.content, row.file).candidates
      .filter(candidate => candidate.kind === "hex-color" || candidate.kind === "color-function" || (candidate.kind === "tw-arbitrary" && COLOUR_IN_ARBITRARY.test(candidate.value)))
      .map(candidate => ({ category: "raw-colour" as const, file: row.file, line: candidate.line, evidence: candidate.raw }))),
  ];
  return { report, residuals };
}

/**
 * Known residuals at base 73ae54c52, each owned by the lane fixing that file. This list may only
 * shrink: a count may go down or a row may be deleted, never added or raised. When L3 and L7
 * land, delete their rows and flip the `it.fails` below to `it`.
 */
const PINNED_RESIDUALS: readonly { owner: "L3" | "L7"; file: string; category: Category; count: number }[] = [
  { owner: "L3", file: "src/studio/Board.tsx", category: "inline-style", count: 2 },
  { owner: "L3", file: "src/studio/CandidateCell.tsx", category: "inline-style", count: 2 },
  { owner: "L7", file: "src/studio/asset-specimens.tsx", category: "inline-style", count: 2 },
  { owner: "L7", file: "src/studio/component-specimen-contained.tsx", category: "raw-rac-import", count: 1 },
  { owner: "L7", file: "src/studio/component-specimen-contained.tsx", category: "inline-style", count: 1 },
  { owner: "L7", file: "src/studio/component-specimen-samples.tsx", category: "raw-rac-import", count: 1 },
  { owner: "L7", file: "src/studio/component-specimen-samples.tsx", category: "raw-html-control", count: 1 },
  // 6 hex theme values (:81-82), 5 "#1001" order numbers in copy (:130-164; 4-digit hex shape)
  // and 4 hsl() colour-picker values (:196).
  { owner: "L7", file: "src/studio/specimen-dataset.ts", category: "raw-colour", count: 15 },
];

const sources = await dogfoodSources([STUDIO], packageRoot);
const studio = sources.files.filter(row => row.file.startsWith(STUDIO));
const { report, residuals } = scan(studio, sources.localModules);

describe("Studio dogfood, zero allowlist (criterion 9)", () => {
  it("scans every shipped Studio source with no exception or ignore marker honoured", () => {
    const names = studio.map(row => row.file);
    for (const file of ["Board.tsx", "CandidateCell.tsx", "TreeView.tsx", "WholeStudio.tsx", "specimen-dataset.ts", "component-specimen-samples.tsx"]) expect(names).toContain(STUDIO + file);
    expect(names.some(name => /\.test\.[cm]?[jt]sx?$/.test(name))).toBe(false);
    expect(report.exceptions).toEqual([]);
    expect(report.ignored).toEqual([]);
  });

  it("detects each criterion-9 category with the scanner's own rules", () => {
    const probe = scan([{
      file: "src/studio/probe.tsx",
      content: [
        'import { Button as Raw } from "react-aria-components";',
        'export const A = () => <button type="button">Go</button>;',
        "export const B = () => <input />;",
        'export const C = () => <div style={{ color: "red" }} />;',
        'export const D = () => <div className="bg-[#ff0000]" />;',
        'export const E = { ink: "#123456", wash: "rgb(1, 2, 3)" };',
      ].join("\n"),
    }]).residuals;
    const count = (category: Category) => probe.filter(row => row.category === category).length;
    expect(count("raw-rac-import")).toBe(1);
    expect(count("raw-html-control")).toBe(2);
    expect(count("inline-style")).toBe(1);
    expect(count("raw-colour")).toBe(3);
  });

  it("finds nothing outside the pinned, owned residuals (the pin may only shrink)", () => {
    const actual = new Map<string, Residual[]>();
    for (const row of residuals) actual.set(`${row.category} ${row.file}`, [...(actual.get(`${row.category} ${row.file}`) ?? []), row]);
    const excess = [...actual].flatMap(([key, rows]) => {
      const pin = PINNED_RESIDUALS.find(row => `${row.category} ${row.file}` === key);
      return rows.length > (pin?.count ?? 0) ? rows.map(row => `${row.file}:${row.line} ${row.category} ${row.evidence}`) : [];
    });
    expect(excess).toEqual([]);
  });

  // Fails today because of the pinned residuals above (L3: Board.tsx, CandidateCell.tsx; L7:
  // specimen-dataset.ts, asset-specimens.tsx, component-specimen-samples.tsx,
  // component-specimen-contained.tsx). When `it.fails` itself goes red, Studio is clean: flip to `it`.
  it.fails("is strictly clean: no raw RAC import, raw html control, raw colour or inline style", () => {
    expect(residuals.map(row => `${row.file}:${row.line} ${row.category} ${row.evidence}`)).toEqual([]);
  });
});
