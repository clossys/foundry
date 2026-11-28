import { describe, expect, it } from "vitest";
import {
  markSuperseded, nextVerdictLine, parseStepVerdict, unitNext,
  type RecordedStep, type StepRecord, type UnitCheck, type UnitFacts,
} from "./unit-next.js";

const TIP = "a".repeat(40), OLD_TIP = "b".repeat(40), HEAD = "c".repeat(40), NEW_HEAD = "d".repeat(40);
const facts = (over: Partial<UnitFacts> = {}): UnitFacts => ({
  unit: "CP9-X", head: HEAD, tip: TIP, tipInHead: true, headInTip: false, installed: true, carryPending: false, launched: true, ...over,
});
const rec = (step: RecordedStep, text: string): StepRecord => ({ verdict: parseStepVerdict(step, text) });
const fastJson = (head: string, base: string, verdict = "FAST PASS") => JSON.stringify({ schema: "clossys.fast-check/1", verdict, head, base });
const mechJson = (head: string, base: string, verdict = "PASS") => JSON.stringify({ schema: "clossys.review/1", verdict, head, base });
const execDone = (head = HEAD) => rec("exec", `# receipt\n\nDONE: ${head}\nmodel: fixture`);

describe("unit next: step order", () => {
  it("next orders rebase, fast check, mech, review, fold", () => {
    const seen: (string | null)[] = [];
    const records: Partial<Record<RecordedStep, StepRecord>> = {};
    seen.push(unitNext(facts({ launched: false }), records).next);
    records.exec = execDone();
    seen.push(unitNext(facts({ tipInHead: false }), records).next);
    seen.push(unitNext(facts(), records).next);
    records.fast = rec("fast", fastJson(HEAD, TIP));
    seen.push(unitNext(facts(), records).next);
    records.mech = rec("mech", mechJson(HEAD, TIP));
    seen.push(unitNext(facts(), records).next);
    records.review = rec("review", `findings: none\nREVIEW: PASS ${HEAD}`);
    const ready = unitNext(facts(), records);
    seen.push(ready.next);
    expect(seen).toEqual(["exec", "rebase", "fast", "mech", "review", "fold"]);
    expect(ready.state).toBe("ready-to-fold");
    expect(ready.refused).toEqual([]);
    expect(unitNext(facts({ headInTip: true }), records).state).toBe("folded");
    expect(unitNext(facts({ headInTip: true }), records).next).toBeNull();
    // Asking for a step out of that order is refused and named.
    const early = unitNext(facts(), { exec: execDone() }, [], undefined, "review");
    expect(early.refused.map(item => item.precondition)).toEqual(["out-of-order"]);
  });

  it("next refuses mech when the base is not the integration tip", () => {
    // fast passed at this head on the old tip; the tip then moved, so the head no longer contains it.
    const records = { exec: execDone(), fast: rec("fast", fastJson(HEAD, OLD_TIP)) };
    const result = unitNext(facts({ tipInHead: false }), records, [], undefined, "mech");
    expect(result.next).toBe("rebase");
    expect(result.refused.map(item => item.precondition)).toEqual(["base-not-tip"]);
    expect(result.refused[0]!.rule).toBe("R-UNIT-STEP-ORDER");
    expect(nextVerdictLine(result, HEAD, "mech")).toBe(`NEXT: CP9-X rebase-due rebase ${HEAD} mech REFUSED base-not-tip`);
    // A mech record run against another base than the tip never holds, even on a rebased head.
    const stale = unitNext(facts(), { exec: execDone(), fast: rec("fast", fastJson(HEAD, TIP)), mech: rec("mech", mechJson(HEAD, OLD_TIP)) });
    expect(stale.next).toBe("mech");
    expect(stale.reason).toMatch(/not the integration tip/);
  });

  it("next refuses a step on a head changed since the last verdict", () => {
    const records = { exec: execDone(), fast: rec("fast", fastJson(HEAD, TIP)) };
    const result = unitNext(facts({ head: NEW_HEAD }), records, [], undefined, "mech");
    expect(result.next).toBe("fast");
    expect(result.reason).toMatch(/superseded/);
    expect(result.refused.map(item => item.precondition)).toEqual(["head-changed"]);
    expect(result.holding).toEqual([]);
  });

  it("next refuses any step past exec on an uninstalled tree or with a carry pending", () => {
    const records = { exec: execDone(), fast: rec("fast", fastJson(HEAD, TIP)) };
    expect(unitNext(facts({ installed: false }), records).refused.map(item => item.precondition)).toEqual(["installed"]);
    expect(unitNext(facts({ carryPending: true }), records).refused.map(item => item.precondition)).toEqual(["carry-pending"]);
    expect(unitNext(facts({ installed: false, tipInHead: false }), records).refused).toEqual([]);
  });

  it("a short sha in a verdict line names the full head", () => {
    const records = { exec: execDone(), fast: rec("fast", `check --fast: 1 changed file(s)\nFAST PASS ${HEAD.slice(0, 12)}`) };
    expect(unitNext(facts(), records).next).toBe("mech");
  });

  it("a failed verdict at the head sends the unit back to exec", () => {
    const result = unitNext(facts(), { exec: execDone(), fast: rec("fast", fastJson(HEAD, TIP, "FAST FAIL")) });
    expect(result.state).toBe("fast-failed");
    expect(result.next).toBe("exec");
  });
});

describe("unit next: verdict lines", () => {
  it("a step with no verdict line counts as failed", () => {
    expect(parseStepVerdict("review", "looked fine to me")).toBeNull();
    expect(parseStepVerdict("exec", "# receipt\nfiles touched: a.ts")).toBeNull();
    expect(parseStepVerdict("mech", `MECHANICAL: PASS ${HEAD} ${TIP}`)).toBeNull();
    const noReceipt = unitNext(facts(), { exec: rec("exec", "# receipt, unfinished") });
    expect(noReceipt.state).toBe("exec-failed");
    expect(noReceipt.next).toBe("exec");
    expect(noReceipt.reason).toMatch(/no verdict line/);
    const noReview = unitNext(facts(), { exec: execDone(), fast: rec("fast", fastJson(HEAD, TIP)), mech: rec("mech", mechJson(HEAD, TIP)), review: rec("review", "approve") });
    expect(noReview.next).toBe("review");
    expect(noReview.reason).toMatch(/no verdict line \(counted as failed\)/);
    expect(unitNext(facts(), { exec: rec("exec", "BLOCKED: preflight npm ci") }).state).toBe("exec-failed");
  });
});

describe("unit next: WIP cap", () => {
  it("next refuses a new unit past the WIP cap until a fold", () => {
    const fresh = facts({ unit: "CP9-NEW", launched: false, head: null });
    const full = unitNext(fresh, {}, [], { cap: 4, pastExec: 4 });
    expect(full.next).toBe("exec");
    expect(full.refused.map(item => item.precondition)).toEqual(["wip-cap"]);
    expect(full.refused[0]!.rule).toBe("R-UNIT-WIP");
    expect(unitNext(fresh, {}, [], { cap: 4, pastExec: 3 }).refused).toEqual([]);
    // A unit already launched is not a new pull.
    expect(unitNext(facts({ head: null }), {}, [], { cap: 4, pastExec: 4 }).refused).toEqual([]);
    // Past exec and not folded counts against the cap; folded does not.
    expect(unitNext(facts(), { exec: execDone() }).pastExec).toBe(true);
    expect(unitNext(facts({ headInTip: true }), { exec: execDone() }).pastExec).toBe(false);
  });
});

describe("unit next: supersede", () => {
  it("a head change marks queued checks superseded", () => {
    const checks: UnitCheck[] = [
      { id: "fast-1", step: "fast", head: HEAD, status: "queued" },
      { id: "mech-1", step: "mech", head: HEAD, status: "running" },
      { id: "fast-0", step: "fast", head: OLD_TIP, status: "done" },
    ];
    const before = unitNext(facts(), { exec: execDone() }, checks);
    expect(before.live.map(check => check.id)).toEqual(["fast-1", "mech-1"]);
    expect(before.superseded).toEqual([]);
    const after = unitNext(facts({ head: NEW_HEAD }), { exec: execDone() }, checks);
    expect(after.live).toEqual([]);
    expect(after.superseded.map(check => [check.id, check.status])).toEqual([["fast-1", "superseded"], ["mech-1", "superseded"]]);
    expect(markSuperseded(checks, NEW_HEAD).map(check => check.status)).toEqual(["superseded", "superseded", "done"]);
    // A check queued at the new head is live.
    const queued = unitNext(facts({ head: NEW_HEAD }), { exec: execDone() }, [...markSuperseded(checks, NEW_HEAD), { id: "fast-2", step: "fast", head: NEW_HEAD, status: "queued" }]);
    expect(queued.live.map(check => check.id)).toEqual(["fast-2"]);
  });
});
