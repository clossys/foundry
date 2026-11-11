// Fake-gates audit row 9: `check --slots --readiness` printed 118 blocked designer slots and left the exit unchanged.
// Under `--strict` each blocked slot is a finding and the check exits 1; `clossys check` alone must exit 0 to pass
// check-cli-verbs.
import { describe, expect, it } from "vitest";
import { readinessFindings, readinessSummary } from "./check.js";
import { VERBS, verbFindings } from "../../scripts/check-cli-verbs.mjs";
import { repoConsumer, runVerb } from "./__fixtures__/flat-consumer.js";
import { dirname } from "node:path";

const coverage = (blocked: { slot: string; readiness: { ready: boolean; blockedBy: { slot: string; reason: string }[] } }[]) =>
  ({ coverage: [{ agent: "designer", slots: 2, withCandidate: 2, pinned: 1, inputsUndeclared: 0, blocked }] }) as never;

describe("strict readiness", () => {
  it("every blocked slot is one finding naming what blocks it", () => {
    const findings = readinessFindings(coverage([{ slot: "sections.hero", readiness: { ready: false, blockedBy: [{ slot: "themes.spacing", reason: "notNeeded" }] } }]));
    expect(findings).toEqual([{ rule: "readiness-blocked", agent: "designer", slot: "sections.hero", blockedBy: [{ slot: "themes.spacing", reason: "notNeeded" }], message: "designer:sections.hero is not ready: blocked by themes.spacing (notNeeded)" }]);
    expect(readinessSummary(findings)).toMatch(/1 blocked slot/);
  });
  it("a store with no blocked slot has no finding", () => {
    expect(readinessFindings(coverage([]))).toEqual([]);
  });
  it("on the committed store, --readiness --strict exits 1 for each blocked slot; without --strict the exit is unchanged", () => {
    const root = dirname(repoConsumer);
    const plain = runVerb(["check", "--readiness", "--root", root], root);
    const strict = runVerb(["check", "--readiness", "--strict", "--root", root], root);
    const blocked = (plain.value?.slots?.coverage ?? []).reduce((sum: number, row: { blocked: unknown[] }) => sum + row.blocked.length, 0);
    expect(strict.value?.checks?.readiness?.blocked).toBe(blocked);
    expect(plain.value?.checks).toBeUndefined();
    // Strict readiness raises the exit to at least 1 when a slot is blocked; a worse plain exit (2) stands.
    expect(strict.status).toBe(Math.max(plain.status ?? 2, blocked ? 1 : 0));
    if (blocked) expect(strict.status).toBeGreaterThan(0);
  }, 120_000);
});

describe("check-cli-verbs", () => {
  it("every read-only verb, clossys check included, is allowed exit 0 only", () => {
    for (const [argv, allowed] of VERBS as [string[], number[]][]) expect([argv.join(" "), allowed]).toEqual([argv.join(" "), [0]]);
  });
  it("a verb exiting 1 with findings is a red verb; two differing runs are nondeterministic", () => {
    const one = { status: 1, stdout: "{}", stderr: "Slot integrity found 3 findings" };
    expect(verbFindings(["check"], [0], one, one)).toEqual(["clossys check [exit] exited 1 on the store (allowed 0): Slot integrity found 3 findings"]);
    const ok = { status: 0, stdout: "{}", stderr: "" };
    expect(verbFindings(["check"], [0], ok, ok)).toEqual([]);
    expect(verbFindings(["check"], [0], ok, { ...ok, stdout: "{ }" })[0]).toMatch(/\[nondeterministic\]/);
  });
});
