import { describe, expect, it } from "vitest";
import type { StrategyBrief } from "./strategy-brief.js";
import { checkWontClaimDrift } from "./wont-claim-drift.js";
import { MAX_LINE_CHARS } from "./brand-facts-drift.js";

// Every value below is fictional.

const brief: StrategyBrief = {
  wontClaim: [
    {
      id: "guaranteed-outcomes",
      statement: "We never promise a guaranteed outcome for a customer.",
      matchPhrases: ["Guaranteed results", "risk-free"],
    },
    { id: "best-in-class", statement: "We never call the product the best in its class." },
  ],
};

function check(content: string, b: StrategyBrief = brief, path = "page.md") {
  return checkWontClaimDrift([{ path, content }], b);
}

describe("checkWontClaimDrift", () => {
  it("literal whole-phrase match", { timeout: 5_000 }, () => {
    const hit = check("Enjoy guaranteed results today.");
    expect(hit.state).toBe("hit");
    expect(hit.findings).toHaveLength(1);
    expect(hit.findings[0]).toMatchObject({ id: "guaranteed-outcomes", file: "page.md", line: 1 });

    // Whole phrase only: a longer word does not match.
    expect(check("We offer unguaranteed results.").state).toBe("clean");
    expect(check("We offer guaranteed resultsets.").state).toBe("clean");

    // A phrase is literal: regex syntax in it never over-matches.
    const dotStar: StrategyBrief = { wontClaim: [{ id: "dot-star", statement: "Never use this wildcard phrase.", matchPhrases: ["guaranteed.*results"] }] };
    expect(check("guaranteed big results", dotStar).state).toBe("clean");
    expect(check("guaranteed.*results", dotStar).state).toBe("hit");
    const paren: StrategyBrief = { wontClaim: [{ id: "paren", statement: "Never use this bracket phrase.", matchPhrases: ["(free)"] }] };
    expect(check("a (free) trial", paren).state).toBe("hit");
    expect(check("a free trial", paren).state).toBe("clean");
  });

  it("matches across a run of spaces and reports each id once per line", { timeout: 5_000 }, () => {
    const result = check("Risk-free,   and   RISK-FREE again; guaranteed  results");
    expect(result.findings.map((f) => f.id)).toEqual(["guaranteed-outcomes"]);
    expect(result.findings).toHaveLength(1);
  });

  it("ignore and unchecked entries", { timeout: 5_000 }, () => {
    const ignored = check("<!-- wont-claim:ignore --> guaranteed results here\n// wont-claim:ignore risk-free\n# wont-claim:ignore risk-free");
    expect(ignored.findings).toEqual([]);
    expect(ignored.ignored.map((i) => i.line)).toEqual([1, 2, 3]);
    expect(ignored.state).toBe("clean");

    // The marker must sit inside a comment opener.
    expect(check("guaranteed results wont-claim:ignore").state).toBe("hit");

    // An entry with no phrases is listed, and never changes the state.
    const clean = check("Nothing to see here.");
    expect(clean.state).toBe("clean");
    expect(clean.unchecked).toEqual(["best-in-class"]);
    const noPhrases: StrategyBrief = { wontClaim: [{ id: "only-prose", statement: "A claim with nothing to match.", matchPhrases: [] }] };
    expect(check("best in its class, guaranteed results", noPhrases)).toMatchObject({ state: "clean", unchecked: ["only-prose"], findings: [] });
  });

  it("never reads strategy-brief.json as a finding source", { timeout: 5_000 }, () => {
    const record = JSON.stringify(brief);
    const only = checkWontClaimDrift([{ path: "clossys/strategist/strategy-brief.json", content: record }], brief);
    expect(only.findings).toEqual([]);
    // Nothing else was scanned, so the run cannot vouch for anything.
    expect(only.state).toBe("indeterminate");
    expect(only.filesScanned).toBe(0);

    const both = checkWontClaimDrift(
      [
        { path: "strategy-brief.json", content: record },
        { path: "other/strategy-brief.json", content: record },
        { path: "page.md", content: "fine" },
      ],
      brief,
    );
    expect(both).toMatchObject({ state: "clean", filesScanned: 1 });
  });

  it("fails closed: no files and over-long lines are indeterminate, and win over a hit", { timeout: 5_000 }, () => {
    expect(checkWontClaimDrift([], brief)).toMatchObject({ state: "indeterminate", indeterminateReasons: ["no files scanned"] });

    const long = `${"x".repeat(MAX_LINE_CHARS + 1)} wont-claim:ignore`;
    const result = checkWontClaimDrift(
      [
        { path: "long.md", content: `<!-- ${long} -->` },
        { path: "hit.md", content: "guaranteed results" },
      ],
      brief,
    );
    expect(result.state).toBe("indeterminate");
    expect(result.findings).toHaveLength(1);
    expect(result.ignored).toEqual([]);
    expect(result.indeterminateReasons[0]).toContain("long.md:1");
  });

  it("reports line numbers across CRLF and multiple files", { timeout: 5_000 }, () => {
    const result = checkWontClaimDrift(
      [
        { path: "a.md", content: "ok\r\nrisk-free\r\n" },
        { path: "b.md", content: "x\ny\nGuaranteed results" },
      ],
      brief,
    );
    expect(result.findings.map((f) => `${f.file}:${f.line}`)).toEqual(["a.md:2", "b.md:3"]);
  });
});
