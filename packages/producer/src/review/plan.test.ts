import { describe, expect, it } from "vitest";
import { GATE_LEXICON } from "./gate-lexicon.js";
import { allowPass, classify, globRegExp, makeVerdict, parseVerdictLog, planReview, type Classification, type DiffFile, type PlanInput, type VerdictRecord } from "./plan.js";

const H = (n: number) => String(n).repeat(40).slice(0, 40);
const file = (path: string, added: string[] = [], removed: string[] = [], status = "M"): DiffFile => ({ path, status, added, removed });
const verdict = (role: string, head: string, clear: boolean, severity?: string): VerdictRecord =>
  makeVerdict({ unit: "U", role, head, clear, blind: role !== "closure-delta", ...(clear ? {} : { reason: "a finding", severity: severity ?? "P2" }) });

/** A gate diff whose only change to a check is a comment and a message string: pass/fail logic unchanged. */
const GATE_SAME_LOGIC: Classification = classify([
  file("scripts/check-demo.mjs", ["// the check now says why", "  console.log(`demo: ${count} item(s) checked`);"], ["  console.log(`demo: ${count} checked`);"]),
  file("packages/demo/README.md", ["More words."]),
]);
/** A gate diff that changes when a check fails. */
const GATE_NEW_LOGIC: Classification = classify([file("scripts/check-demo.mjs", ["  process.exitCode = findings.length > 1 ? 1 : 0;"], ["  process.exitCode = findings.length ? 1 : 0;"])]);

const input = (classification: Classification, verdicts: VerdictRecord[], head = H(1), extra: Partial<PlanInput> = {}): PlanInput => ({
  unit: "U", head, classification, mechanical: "PASS", verdicts, carries: () => ({ carry: true, reason: "carried" }), ...extra,
});

describe("the gate lexicon", () => {
  it("globs match whole segments and any depth", () => {
    expect(globRegExp("scripts/check-*").test("scripts/check-x.mjs")).toBe(true);
    expect(globRegExp("scripts/check-*").test("scripts/lib/check-x.mjs")).toBe(false);
    expect(globRegExp("**/README.md").test("README.md")).toBe(true);
    expect(globRegExp("**/README.md").test("packages/a/README.md")).toBe(true);
    expect(globRegExp("packages/*/src/index.ts").test("packages/a/src/index.ts")).toBe(true);
  });

  it("a diff whose only gate surface is a public contract, digest, export list or README is non-gate", () => {
    const only = classify([
      file("scripts/rules/registry.schema.json", ["  \"verdict\": { \"enum\": [\"PASS\"] }"]),
      file("packages/controller/src/review/index.ts", ["export { demo } from \"./demo.js\";", "export type {", "  Demo,", "} from \"./types.js\";"]),
      file("scripts/rules/README.md", ["Text."]),
      file("scripts/lib/schema.digest", ["abc"]),
      file("docs/contracts/package-evidence.json", ["  \"verdict\": \"PASS\""]),
      file("packages/demo/src/demo.ts", ["export const demo = 1;"]),
    ]);
    expect(only.class).toBe("non-gate");
    expect(only.contractOnly.map(surface => surface.kind).sort()).toEqual(["README", "digest", "export list", "public contract"]);
    expect(classify([file("package.json", ["    \"check:demo\": \"node scripts/check-demo.mjs\","])]).class).toBe("gate");
    expect(classify([file("package.json", ["  \"description\": \"x\","])]).class).toBe("non-gate");
    // An index.ts with logic in it is no export list.
    expect(classify([file("packages/controller/src/review/index.ts", ["export const LIMIT = 2;"])]).class).toBe("gate");
    expect(GATE_LEXICON.schema).toBe("clossys.gate-lexicon/1");
  });

  it("finds a pass/fail change in code, not in comments, tests or a new message", () => {
    expect(GATE_SAME_LOGIC.class).toBe("gate");
    expect(GATE_SAME_LOGIC.passFail.changed).toBe(false);
    expect(GATE_NEW_LOGIC.passFail).toEqual({ changed: true, where: "scripts/check-demo.mjs: process.exitCode = findings.length > 1 ? 1 : 0;" });
    expect(classify([file("scripts/check-demo.test.mjs", ["  assert.equal(run.status, 1);"])]).passFail.changed).toBe(false);
    expect(classify([file("scripts/check-new.mjs", ["console.log(1);"], [], "A")]).passFail.changed).toBe(true);
  });
});

describe("clossys review plan", () => {
  it("plan gives one blind for a gate diff that leaves pass/fail logic unchanged", () => {
    const first = planReview(input(GATE_SAME_LOGIC, []));
    expect([first.class, first.blinds, first.next, first.status]).toEqual(["gate", 1, "blind", "NEXT"]);
    const after = planReview(input(GATE_SAME_LOGIC, [verdict("blind", H(1), true)]));
    expect([after.next, after.status]).toEqual(["none", "CLEARED"]);
    expect(allowPass(after, "second-blind").allowed).toBe(false);
  });

  it("plan adds a second blind when pass/fail logic changes", () => {
    const first = planReview(input(GATE_NEW_LOGIC, []));
    expect([first.blinds, first.next]).toEqual([2, "blind"]);
    const second = planReview(input(GATE_NEW_LOGIC, [verdict("blind", H(1), true)]));
    expect([second.next, second.status]).toEqual(["second-blind", "NEXT"]);
    expect(planReview(input(GATE_NEW_LOGIC, [verdict("blind", H(1), true), verdict("second-blind", H(1), true)])).status).toBe("CLEARED");
    // A P0 or P1 from the first blind also owes a second blind, after the fix's closure delta.
    const high = [verdict("blind", H(1), false, "P1"), verdict("closure-delta", H(2), true)];
    expect(planReview(input(GATE_SAME_LOGIC, high, H(2))).next).toBe("second-blind");
    expect(planReview(input(GATE_SAME_LOGIC, [verdict("blind", H(1), false, "P2"), verdict("closure-delta", H(2), true)], H(2))).status).toBe("CLEARED");
  });

  it("plan refuses a final after a CLEAR blind", () => {
    const cleared = planReview(input(GATE_SAME_LOGIC, [verdict("blind", H(1), true)]));
    expect(allowPass(cleared, "final")).toEqual({ allowed: false, reason: "no final after a CLEAR blind" });
    const owed = planReview(input(GATE_NEW_LOGIC, [verdict("blind", H(1), true)]));
    expect(allowPass(owed, "final")).toEqual({ allowed: false, reason: "no final after a CLEAR blind" });
    expect(allowPass(owed, "second-blind").allowed).toBe(true);
    expect(allowPass(planReview(input(GATE_SAME_LOGIC, [])), "final").allowed).toBe(false);
    expect(() => makeVerdict({ unit: "U", role: "final", head: H(1), clear: true, blind: true })).toThrow(/not in the review budget/);
  });

  it("plan refuses a third fix round", () => {
    const one = [verdict("blind", H(1), false)];
    expect(planReview(input(GATE_SAME_LOGIC, one, H(1))).status).toBe("WAITING");
    expect(planReview(input(GATE_SAME_LOGIC, one, H(2))).next).toBe("closure-delta");
    const two = [...one, verdict("closure-delta", H(2), false)];
    const round2 = planReview(input(GATE_SAME_LOGIC, two, H(3)));
    expect([round2.next, round2.fixRounds]).toEqual(["closure-delta", 2]);
    const three = [...two, verdict("closure-delta", H(3), false)];
    const refused = planReview(input(GATE_SAME_LOGIC, three, H(4)));
    expect([refused.status, refused.next]).toEqual(["REFUSED", "none"]);
    expect(refused.reason).toMatch(/third fix round is refused/);
    expect(allowPass(refused, "closure-delta").allowed).toBe(false);
    // A clearance voided by an own-path change opens a fix round too, inside the same cap.
    const voided = planReview(input(GATE_SAME_LOGIC, [...two, verdict("closure-delta", H(3), true)], H(4), { carries: () => ({ carry: false, reason: "own-path blob change: a" }) }));
    expect(voided.status).toBe("REFUSED");
  });

  it("puts mechanical first and needs no judgement pass for a non-gate diff", () => {
    const nonGate = classify([file("packages/demo/src/demo.ts", ["export const demo = 2;"])]);
    expect(planReview(input(nonGate, [], H(1), { mechanical: null })).next).toBe("mechanical");
    expect(planReview(input(GATE_SAME_LOGIC, [], H(1), { mechanical: "FAIL" })).next).toBe("mechanical");
    expect(planReview(input(nonGate, [])).status).toBe("CLEARED");
    expect(allowPass(planReview(input(nonGate, [])), "blind").allowed).toBe(false);
  });

  it("records a verdict as CLEAR <sha> or NOT CLEAR <sha>: <reason>, with the role and the blind attestation", () => {
    expect(verdict("blind", H(1), true).line).toBe(`CLEAR ${H(1)}`);
    const not = verdict("closure-delta", H(2), false, "P1");
    expect([not.line, not.role, not.blind, not.severity]).toEqual([`NOT CLEAR ${H(2)}: a finding`, "closure-delta", false, "P1"]);
    expect(() => makeVerdict({ unit: "U", role: "blind", head: H(1), clear: true, blind: false })).toThrow(/blind attestation/);
    expect(() => makeVerdict({ unit: "U", role: "blind", head: H(1), clear: false, blind: true, reason: "x" })).toThrow(/severity/);
    const log = [verdict("blind", H(1), false, "P1"), not].map(record => JSON.stringify(record)).join("\n");
    expect(parseVerdictLog(log)).toEqual([verdict("blind", H(1), false, "P1"), not]);
    expect(() => parseVerdictLog(JSON.stringify({ ...verdict("blind", H(1), true), blind: false }))).toThrow(/blind attestation/);
    expect(() => parseVerdictLog(JSON.stringify({ ...verdict("blind", H(1), true), line: `CLEAR ${H(2)}` }))).toThrow(/its line is not/);
  });
});
