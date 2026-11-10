// Fake-gates audit row 10: `page-dogfood --check` passed an `ok:false` report with 1273 findings because it
// enforced report freshness only. `--check` now judges the findings; `--freshness` is the separate staleness check.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MODES, dogfoodVerdict } from "../../scripts/page-dogfood.mjs";

const dirty = { ok: false, summary: { elements: 3 }, findings: [{ code: "DF5" }, { code: "DF5" }, { code: "DF2" }] };
const clean = { ok: true, summary: { elements: 3 }, findings: [] };

describe("page-dogfood verdict", () => {
  it("--check fails a current report that is not clean, naming the finding codes", () => {
    const verdict = dogfoodVerdict({ mode: "--check", report: dirty, output: "x", existing: "x" });
    expect(verdict.exitCode).toBe(1);
    expect(verdict.errors.join("\n")).toMatch(/ok:false, 3 findings \(DF5 2, DF2 1\)/);
  });
  it("--check passes a current clean report and fails a stale one", () => {
    expect(dogfoodVerdict({ mode: "--check", report: clean, output: "x", existing: "x" }).exitCode).toBe(0);
    expect(dogfoodVerdict({ mode: "--check", report: clean, output: "x", existing: "y" }).exitCode).toBe(1);
    expect(dogfoodVerdict({ mode: "--check", report: clean, output: "x", existing: undefined }).exitCode).toBe(1);
  });
  it("--freshness judges staleness only, as its own check", () => {
    expect(dogfoodVerdict({ mode: "--freshness", report: dirty, output: "x", existing: "x" }).exitCode).toBe(0);
    expect(dogfoodVerdict({ mode: "--freshness", report: dirty, output: "x", existing: "y" }).exitCode).toBe(1);
  });
  it("--write never fails on findings or staleness", () => {
    expect(dogfoodVerdict({ mode: "--write", report: dirty, output: "x", existing: "y" }).exitCode).toBe(0);
    expect(MODES).toEqual(["--check", "--freshness", "--write"]);
  });
  it("the committed report is the one --check now refuses", () => {
    const committed = JSON.parse(readFileSync(new URL("../catalog/reports/page-dogfood.json", import.meta.url), "utf8"));
    const verdict = dogfoodVerdict({ mode: "--check", report: committed, output: "x", existing: "x" });
    expect(committed.ok ? verdict.exitCode : 1).toBe(verdict.exitCode);
  });
});
