import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readStrategyBrief, STRATEGY_BRIEF_FILE, validateStrategyBrief, type StrategyBrief } from "./strategy-brief.js";

// Every value below is fictional.

const validBrief: StrategyBrief = {
  wontClaim: [
    {
      id: "guaranteed-outcomes",
      statement: "We never promise a guaranteed outcome for a customer.",
      why: "No result can be guaranteed.",
      matchPhrases: ["guaranteed results", "risk-free"],
    },
    { id: "best-in-class", statement: "We never call the product the best in its class." },
  ],
};

function withChange(mutate: (record: { wontClaim: Array<Record<string, unknown>> }) => void): unknown {
  const copy = JSON.parse(JSON.stringify(validBrief)) as { wontClaim: Array<Record<string, unknown>> };
  mutate(copy);
  return copy;
}

function issuesOf(value: unknown): Array<{ path: string; message: string }> {
  const result = validateStrategyBrief(value);
  if (result.ok) throw new Error("expected validation to fail");
  return result.issues;
}

describe("validateStrategyBrief", () => {
  it("validates the record", { timeout: 5_000 }, () => {
    expect(validateStrategyBrief(validBrief)).toEqual({ ok: true, value: validBrief });

    expect(issuesOf(withChange((r) => { (r as Record<string, unknown>).extra = 1; }))).toEqual([
      { path: "extra", message: expect.stringContaining("unknown key") },
    ]);
    expect(issuesOf(withChange((r) => { (r.wontClaim[0] as Record<string, unknown>).extra = 1; }))[0]?.path).toBe("wontClaim[0].extra");
    expect(issuesOf(withChange((r) => { r.wontClaim[1]!.id = "guaranteed-outcomes"; }))[0]?.path).toBe("wontClaim[1].id");
    expect(issuesOf(withChange((r) => { r.wontClaim[1]!.statement = "too short"; }))[0]?.path).toBe("wontClaim[1].statement");
    expect(issuesOf(withChange((r) => { r.wontClaim[0]!.matchPhrases = ["fine", "   "]; }))[0]?.path).toBe("wontClaim[0].matchPhrases[1]");
    expect(issuesOf(withChange((r) => { r.wontClaim[0]!.matchPhrases = ["Risk-Free", "risk-free"]; }))[0]?.path).toBe(
      "wontClaim[0].matchPhrases[1]",
    );
  });

  it("accepts an empty list and an entry with no phrases", { timeout: 5_000 }, () => {
    expect(validateStrategyBrief({ wontClaim: [] })).toEqual({ ok: true, value: { wontClaim: [] } });
    expect(validateStrategyBrief({ wontClaim: [{ id: "a-b", statement: "Ten chars or more." }] }).ok).toBe(true);
  });

  it("refuses a non-object root, a missing list, and a non-kebab-case id", { timeout: 5_000 }, () => {
    expect(issuesOf([])[0]?.path).toBe("(root)");
    expect(issuesOf({})[0]?.path).toBe("wontClaim");
    for (const id of ["Has-Caps", "has_underscore", "-lead", "trail-", "double--dash", ""]) {
      expect(issuesOf(withChange((r) => { r.wontClaim[0]!.id = id; }))[0]?.path).toBe("wontClaim[0].id");
    }
  });

  it("refuses a blank why and a non-array matchPhrases", { timeout: 5_000 }, () => {
    expect(issuesOf(withChange((r) => { r.wontClaim[0]!.why = ""; }))[0]?.path).toBe("wontClaim[0].why");
    expect(issuesOf(withChange((r) => { r.wontClaim[0]!.matchPhrases = "risk-free"; }))[0]?.path).toBe("wontClaim[0].matchPhrases");
  });
});

describe("readStrategyBrief", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "strategy-brief-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports ok, missing and invalid apart", { timeout: 5_000 }, () => {
    expect(readStrategyBrief(dir).status).toBe("missing");
    writeFileSync(join(dir, STRATEGY_BRIEF_FILE), JSON.stringify(validBrief));
    expect(readStrategyBrief(dir)).toEqual({ status: "ok", brief: validBrief });
    writeFileSync(join(dir, STRATEGY_BRIEF_FILE), "{ not json");
    expect(readStrategyBrief(dir).status).toBe("invalid");
    writeFileSync(join(dir, STRATEGY_BRIEF_FILE), JSON.stringify({ wontClaim: [{ id: "Bad" }] }));
    expect(readStrategyBrief(dir).status).toBe("invalid");
  });
});
