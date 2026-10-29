import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { main } from "../cli.js";
import { checkGrounding } from "../facts-gate.js";
import { readFindings } from "../facts-dir.js";
import { parseFinding } from "../format/finding.js";
import { readStrategyRoot } from "../store.js";
import { checkWontClaimDrift } from "../wont-claim-drift.js";
import { findingFixture, stageCell, stageFinding, stageWontClaimCells } from "./fixtures.js";
let root: string; let scan: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ground-root-")); scan = mkdtempSync(join(tmpdir(), "ground-scan-"));
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); rmSync(scan, { recursive: true, force: true }); vi.restoreAllMocks(); });
it("traces a finding's scalar value, unit form and declared aliases; refuses a nearby untraced number", () => {
  const parsed = parseFinding(findingFixture("customers", 42, ["4,200"]));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  expect(checkGrounding([{ path: "page.md", content: "42 customers; 4,200 customers; 17 customers." }], [parsed.value]).findings).toEqual([
    expect.objectContaining({ rule: "untraced-numeric-claim", snippet: expect.stringContaining("17 customers") }),
  ]);
  expect(checkGrounding([{ path: "page.md", content: "20%" }], [{ ...parsed.value, value: "20%", aliases: [] }]).findings).toEqual([]);
});
it("validates finding citations, with no value required", () => {
  stageFinding(root); const model = readStrategyRoot(root);
  expect(checkGrounding([{ path: "page.md", content: "the only tool <!-- finding:active-customers -->" }], model.findings).findings).toEqual([]);
  expect(checkGrounding([{ path: "page.md", content: "the only tool <!-- finding:missing -->" }], model.findings).findings.length).toBeGreaterThan(0);
});
it("the bare positional form equals ground, and --root supports a single scan positional", () => {
  stageFinding(root); writeFileSync(join(scan, "page.md"), "4,200 customers");
  expect(main([root, scan])).toBe(0);
  expect(main(["ground", root, scan])).toBe(0);
  expect(main(["ground", "--root", root, scan, "--json"])).toBe(0);
  expect(JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]))).toMatchObject({ findings: [], filesScanned: 1 });
  writeFileSync(join(scan, "page.md"), "8,000 customers");
  expect(main([root, scan])).toBe(1); expect(main(["ground", root, scan])).toBe(1);
});
it("refuses malformed and symlink finding inputs even when another leaf validates", () => {
  stageFinding(root); writeFileSync(join(scan, "page.md"), "clean");
  writeFileSync(join(root, "findings/bad.md"), "broken"); expect(main(["ground", root, scan])).toBe(2);
  rmSync(join(root, "findings/bad.md")); symlinkSync(join(scan, "page.md"), join(root, "findings/linked.md"));
  expect(main(["ground", root, scan])).toBe(2);
});
it("uses only quoted labels in active Proof and Voice selected by the tree, ignoring newer drafts and other sections", () => {
  stageWontClaimCells(root);
  stageCell(root, "advantage.proposition.proof", 2, "Never-claim", '"draft promise"', "draft");
  stageCell(root, "identity.verbal.voice", 2, "Never", '"draft voice"', "draft");
  const path = join(root, "cells/identity.verbal.voice/v1.md");
  writeFileSync(path, readFileSync(path, "utf8").replace('## Because\n', '- Sound: "incidental quote"\n\n## Because\n- Never: "because quote"\n'));
  const model = readStrategyRoot(root);
  expect(model.issues).toEqual([]);
  const result = checkWontClaimDrift([{ path: "page.md", content: "Guaranteed results; risk-free.\ndraft promise; draft voice" }], model);
  expect(result.state).toBe("hit"); expect(result.findings.map(f => f.line)).toEqual([1, 1]);
  expect(checkWontClaimDrift([{ path: "page.md", content: "draft promise; draft voice; incidental quote; because quote" }], model).state).toBe("clean");
  writeFileSync(join(scan, "page.md"), "risk-free"); expect(main(["wont-claim", root, scan])).toBe(1);
});
it("fails closed for a dangling active pointer or status mismatch", () => {
  stageWontClaimCells(root); writeFileSync(join(scan, "page.md"), "clean");
  stageCell(root, "identity.verbal.voice", 1, "Never", '"risk-free"', "draft");
  expect(main(["wont-claim", root, scan])).toBe(2);
  rmSync(join(root, "cells/identity.verbal.voice/v1.md")); expect(main(["wont-claim", root, scan])).toBe(2);
});

it("ignores malformed draft versions, and records unquoted prohibitions as unchecked", () => {
  stageWontClaimCells(root);
  writeFileSync(join(root, "cells/identity.verbal.voice/v2.md"), "malformed draft");
  stageCell(root, "advantage.proposition.proof", 1, "Never-claim", "Unquoted constraint");
  const result = checkWontClaimDrift([{ path: "page.md", content: "Unquoted constraint" }], readStrategyRoot(root));
  expect(result.state).toBe("clean"); expect(result.unchecked).toHaveLength(1);
});
it("the pure findings reader accounts for every leaf and validates filename identity", () => {
  expect(readFindings({ files: { "active-customers.md": findingFixture() } })).toMatchObject({ complete: true, findings: [expect.objectContaining({ id: "active-customers" })] });
  expect(readFindings({ files: { "wrong.md": findingFixture() } }).complete).toBe(false);
  expect(readFindings({ files: { "note.txt": "unaccounted" } }).complete).toBe(false);
  expect(readFindings({ files: {} }).complete).toBe(false);
});
