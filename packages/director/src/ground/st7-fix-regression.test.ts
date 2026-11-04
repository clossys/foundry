import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { main } from "../cli.js";
import { buildFactIndex, isTracedSurfaceForm, type FactIndex } from "../fact-index.js";
import type { Finding } from "../format/types.js";
import { readStrategyRoot } from "../store.js";
import { checkWontClaimDrift } from "../wont-claim-drift.js";
import { stageCell, stageFinding, stageWontClaimCells } from "./fixtures.js";

let root: string;
let scan: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ground-regression-root-"));
  scan = mkdtempSync(join(tmpdir(), "ground-regression-scan-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(scan, { recursive: true, force: true });
  vi.restoreAllMocks();
});

it.each([
  ['Don\'t claim \'guaranteed results\'.', 'Don\'t say "risk-free" because it isn\'t.'],
  ['Don\'t claim "guaranteed results".', "Don't say 'risk-free' because it isn't."],
  ["Don’t claim ‘guaranteed results’.", "Don’t say “risk-free” because it isn’t."],
])("finds quoted active prohibitions after contractions: %s / %s", (proof, voice) => {
  stageWontClaimCells(root);
  stageCell(root, "advantage.proposition.proof", 1, "Never-claim", proof);
  stageCell(root, "identity.verbal.voice", 1, "Never", voice);
  const result = checkWontClaimDrift([{ path: "page.md", content: "guaranteed results; risk-free" }], readStrategyRoot(root));
  expect(result.state).toBe("hit");
  expect(result.findings.map(finding => finding.found)).toEqual(["guaranteed results", "risk-free"]);
  expect(result.unchecked).toEqual([]);
});

it.each(["'", '"', "‘", "“"])("does not treat a %s delimiter within a word as a quoted prohibition", opening => {
  const closing = opening === "‘" ? "’" : opening === "“" ? "”" : opening;
  stageWontClaimCells(root);
  stageCell(root, "advantage.proposition.proof", 1, "Never-claim", `prefix${opening}guaranteed results${closing}`);
  stageCell(root, "identity.verbal.voice", 1, "Never", `${opening}risk-free${closing}suffix`);
  const result = checkWontClaimDrift([{ path: "page.md", content: "guaranteed results; risk-free" }], readStrategyRoot(root));
  expect(result.state).toBe("clean");
  expect(result.findings).toEqual([]);
  expect(result.unchecked).toHaveLength(2);
});

it.each([
  ["Do not say 'world's best'.", "world's best"],
  ["Do not say ‘world’s best’.", "world’s best"],
  ['Do not say "world\'s best".', "world's best"],
])("finds the full quoted prohibition containing an apostrophe: %s", (proof, surface) => {
  stageWontClaimCells(root);
  stageCell(root, "advantage.proposition.proof", 1, "Never-claim", proof);
  const model = readStrategyRoot(root);
  expect(model.issues).toEqual([]);
  const result = checkWontClaimDrift([{ path: "page.md", content: surface }], model);
  expect(result.state).toBe("hit");
  expect(result.findings).toEqual([expect.objectContaining({
    id: "advantage.proposition.proof@1#13", file: "page.md", line: 1, found: surface,
  })]);
  expect(result.unchecked).toEqual([]);
});

it.each(["missing-findings", "malformed-findings", "partial-findings", "empty-scan", "filtered-scan", "evidence-only-scan"])(
  "ground --json returns exactly one structured indeterminate result for %s", scenario => {
    if (scenario !== "missing-findings") stageFinding(root);
    if (scenario === "malformed-findings") writeFileSync(join(root, "findings/active-customers.md"), "broken");
    if (scenario === "partial-findings") writeFileSync(join(root, "findings/bad.md"), "broken");
    if (scenario !== "empty-scan") writeFileSync(join(scan, "page.md"), "4,200 customers");
    const scanRoot = scenario === "evidence-only-scan" ? root : scan;
    const flags = scenario === "filtered-scan" ? ["--extensions", ".html"] : [];
    expect(main(["ground", root, scanRoot, "--json", ...flags])).toBe(2);
    const calls = vi.mocked(console.log).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(1);
    const result = JSON.parse(String(calls[0]?.[0]));
    expect(result).toMatchObject({ state: "indeterminate", findings: [], filesScanned: 0 });
    expect(result.indeterminateReasons.length).toBeGreaterThan(0);
    expect(result.indeterminateReasons.every((reason: unknown) => typeof reason === "string" && reason.length > 0)).toBe(true);
    const reasons = result.indeterminateReasons.join(" ");
    if (scenario === "missing-findings") expect(reasons).toContain("no valid findings");
    if (scenario === "malformed-findings" || scenario === "partial-findings") expect(reasons).toContain("findings/");
    if (scenario === "empty-scan" || scenario === "filtered-scan") expect(reasons).toContain("No files matched");
    if (scenario === "evidence-only-scan") expect(reasons).toContain("No surface files");
  },
);

it("infers Finding lookup types and uses Finding as the default", () => {
  stageFinding(root);
  const findings: Finding[] = readStrategyRoot(root).findings;
  const findingIndex: FactIndex = buildFactIndex(findings);
  const finding: Finding | undefined = findingIndex.byKey.get("active-customers");
  const id: string | undefined = findingIndex.byKey.get("active-customers")?.id;
  expect(finding).toBe(findings[0]);
  expect(id).toBe("active-customers");
  expect(isTracedSurfaceForm(findingIndex, "4,200")).toBe(true);
});
