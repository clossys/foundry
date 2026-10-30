import { describe, expect, it } from "vitest";
import { loadCatalog } from "./catalog.js";
import { formatRef } from "./format/ref.js";
import type { Cell, StrategyModel } from "./format/types.js";
import { checkWontClaimDrift } from "./wont-claim-drift.js";

const MAX_LINE_CHARS = 16384;
const proof = "advantage.proposition.proof";
const voice = "identity.verbal.voice";
const entryId = (line: number) => `${formatRef({ kind: "cell", ref: { cell: proof, version: 1 } })}#${line}`;

/** Fictional active cells exercise the same lexical cases as the retired record fixtures. */
function model(phrases = ['"Guaranteed results" and "risk-free"', "We never call the product the best in its class."]): StrategyModel {
  const cell = (id: string, key: string, texts: string[]): Cell => ({
    id, version: 1, status: "active", updated: "2026-10-29", cites: [], feeds: [], functions: [],
    path: `cells/${id}/v1.md`,
    direction: texts.map((text, i) => ({ key, text, refs: [], line: i + 1 })), because: [], watch: [],
  });
  return {
    root: ".", catalog: loadCatalog(), cells: [cell(proof, "Never-claim", phrases), cell(voice, "Never", ['"unused voice phrase"'])],
    tree: { schemaVersion: 1, catalog: "@clossys/strategist#strategy-v1", archetype: "default", core: "archetype", active: { [proof]: 1, [voice]: 1 } },
    sessions: [], findings: [], requests: [], files: {}, issues: [],
  };
}
const strategy = model();
function check(content: string, source = strategy, path = "page.md") {
  return checkWontClaimDrift([{ path, content }], source);
}

describe("checkWontClaimDrift", () => {
  it("literal whole-phrase match", { timeout: 5_000 }, () => {
    const hit = check("Enjoy guaranteed results today.");
    expect(hit.state).toBe("hit");
    expect(hit.findings).toHaveLength(1);
    expect(hit.findings[0]).toMatchObject({ id: entryId(1), file: "page.md", line: 1 });
    expect(check("We offer unguaranteed results.").state).toBe("clean");
    expect(check("We offer guaranteed resultsets.").state).toBe("clean");
    const dotStar = model(['"guaranteed.*results"']);
    expect(check("guaranteed big results", dotStar).state).toBe("clean");
    expect(check("guaranteed.*results", dotStar).state).toBe("hit");
    const paren = model(['"(free)"']);
    expect(check("a (free) trial", paren).state).toBe("hit");
    expect(check("a free trial", paren).state).toBe("clean");
  });

  it("matches across a run of spaces and reports each id once per line", { timeout: 5_000 }, () => {
    const result = check("Risk-free,   and   RISK-FREE again; guaranteed  results");
    expect(result.findings.map(f => f.id)).toEqual([entryId(1)]);
    expect(result.findings).toHaveLength(1);
  });

  it("ignore and unchecked entries", { timeout: 5_000 }, () => {
    const ignored = check("<!-- wont-claim:ignore --> guaranteed results here\n// wont-claim:ignore risk-free\n# wont-claim:ignore risk-free");
    expect(ignored.findings).toEqual([]);
    expect(ignored.ignored.map(i => i.line)).toEqual([1, 2, 3]);
    expect(ignored.state).toBe("clean");
    expect(check("guaranteed results wont-claim:ignore").state).toBe("hit");
    const clean = check("Nothing to see here.");
    expect(clean.state).toBe("clean");
    expect(clean.unchecked).toEqual([entryId(2)]);
    expect(check("best in its class, guaranteed results", model(["A claim with nothing to match."])))
      .toMatchObject({ state: "clean", unchecked: [entryId(1)], findings: [] });
  });

  it("checks every caller-supplied surface regardless of its basename", () => {
    const result = check("guaranteed results", strategy, "other/strategy-brief.json");
    expect(result).toMatchObject({ state: "hit", filesScanned: 1 });
    expect(result.findings).toHaveLength(1);
  });

  it("fails closed: no files and over-long lines are indeterminate, and win over a hit", { timeout: 5_000 }, () => {
    expect(checkWontClaimDrift([], strategy)).toMatchObject({ state: "indeterminate", indeterminateReasons: ["no files scanned"] });
    const long = `${"x".repeat(MAX_LINE_CHARS + 1)} wont-claim:ignore`;
    const result = checkWontClaimDrift([
      { path: "long.md", content: `<!-- ${long} -->` }, { path: "hit.md", content: "guaranteed results" },
    ], strategy);
    expect(result.state).toBe("indeterminate");
    expect(result.findings).toHaveLength(1);
    expect(result.ignored).toEqual([]);
    expect(result.indeterminateReasons[0]).toContain("long.md:1");
  });

  it("reports line numbers across CRLF and multiple files", { timeout: 5_000 }, () => {
    const result = checkWontClaimDrift([
      { path: "a.md", content: "ok\r\nrisk-free\r\n" }, { path: "b.md", content: "x\ny\nGuaranteed results" },
    ], strategy);
    expect(result.findings.map(f => `${f.file}:${f.line}`)).toEqual(["a.md:2", "b.md:3"]);
  });
});
