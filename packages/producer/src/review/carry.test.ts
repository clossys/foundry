import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { runReviewCli } from "../cli/review.js";
import { carryClearance } from "./carry.js";
import { scratch } from "./exec.js";
import { allowPass, classify, diffFiles, makeVerdict, planReview, type Plan, type VerdictRecord } from "./plan.js";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const env = { ...process.env, GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();

type Step =
  | { op: "commit"; branch: string; files: Record<string, string | null>; mark?: string }
  | { op: "branch"; name: string; from: string }
  | { op: "merge"; branch: string; from: string; files?: Record<string, string>; mark?: string };

/** Builds a repository from scripted steps; returns it and the sha of each mark. */
function build(steps: readonly Step[]): { repo: string; marks: Record<string, string> } {
  const repo = scratch("review-carry-");
  roots.push(repo);
  sh(repo, "init", "-q", "-b", "main");
  const marks: Record<string, string> = {};
  const write = (files: Record<string, string | null>) => {
    for (const [path, text] of Object.entries(files)) {
      if (text === null) rmSync(join(repo, path), { force: true });
      else { mkdirSync(dirname(join(repo, path)), { recursive: true }); writeFileSync(join(repo, path), text); }
    }
  };
  for (const step of steps) {
    if (step.op === "branch") { sh(repo, "branch", step.name, step.from); continue; }
    if (sh(repo, "symbolic-ref", "--short", "HEAD") !== step.branch) sh(repo, "checkout", "-q", step.branch);
    if (step.op === "commit") { write(step.files); sh(repo, "add", "-A"); sh(repo, "commit", "-q", "-m", `commit on ${step.branch}`); }
    else {
      sh(repo, "merge", "-q", "--no-ff", "--no-commit", step.from);
      if (step.files) { write(step.files); sh(repo, "add", "-A"); }
      sh(repo, "commit", "-q", "-m", `merge ${step.from} into ${step.branch}`);
    }
    if (step.mark) marks[step.mark] = sh(repo, "rev-parse", "HEAD");
  }
  return { repo, marks };
}

const BASE: Step[] = [
  { op: "commit", branch: "main", files: { "own.txt": "a\n", "shared.txt": "1\n2\n3\n4\n5\n6\n", "other.txt": "x\n" } },
  { op: "branch", name: "unit", from: "main" },
  { op: "commit", branch: "unit", files: { "own.txt": "a unit change\n", "unit-new.txt": "new\n" }, mark: "cleared" },
];

describe("clossys review carry", () => {
  it("carries over a clean default-branch merge", () => {
    const { repo, marks } = build([...BASE, { op: "commit", branch: "main", files: { "other.txt": "y\n" } }, { op: "merge", branch: "unit", from: "main", mark: "new" }]);
    const result = carryClearance(repo, marks.cleared!, marks.new!, "main");
    expect([result.verdict, result.ownPaths]).toEqual(["CARRY", ["own.txt", "unit-new.txt"]]);
    expect(carryClearance(repo, marks.cleared!, marks.cleared!, "main").verdict).toBe("CARRY");
  });

  it("carry voids on an own-path blob change", () => {
    // The default branch also changed an own path; the merge is clean, but the cleared blob is not the blob at the new head.
    const merged = build([...BASE, { op: "commit", branch: "main", files: { "unit-new.txt": "new\n", "own.txt": "a unit change\n", "other.txt": "y\n" } }, { op: "commit", branch: "main", files: { "unit-new.txt": "new, from main\n" } }]);
    sh(merged.repo, "checkout", "-q", "unit");
    sh(merged.repo, "merge", "-q", "--no-ff", "-X", "theirs", "-m", "merge main", "main");
    const viaMerge = carryClearance(merged.repo, merged.marks.cleared!, sh(merged.repo, "rev-parse", "HEAD"), "main");
    expect([viaMerge.verdict, viaMerge.ownChanged]).toEqual(["VOID", ["unit-new.txt"]]);
    expect(viaMerge.reason).toBe("own-path blob change: unit-new.txt");
    // A merge commit that edits an own path by hand voids it the same way.
    const byHand = build([...BASE, { op: "commit", branch: "main", files: { "other.txt": "y\n" } }, { op: "merge", branch: "unit", from: "main", files: { "own.txt": "edited in the merge\n" }, mark: "new" }]);
    expect(carryClearance(byHand.repo, byHand.marks.cleared!, byHand.marks.new!, "main").line).toMatch(/^VOID [0-9a-f]{40}: own-path blob change: own\.txt$/);
  });

  it("voids an own commit after clearance, a head that drops the cleared head, and a hand-made merge", () => {
    const own = build([...BASE, { op: "commit", branch: "unit", files: { "notes.txt": "n\n" }, mark: "new" }]);
    expect(carryClearance(own.repo, own.marks.cleared!, own.marks.new!, "main").reason).toMatch(/^own commit [0-9a-f]{12} after the clearance/);
    const away = build([...BASE, { op: "branch", name: "other", from: "main" }, { op: "commit", branch: "other", files: { "x.txt": "x\n" }, mark: "new" }]);
    expect(carryClearance(away.repo, away.marks.cleared!, away.marks.new!, "main").reason).toBe("the new head does not contain the cleared head");
    const hand = build([...BASE, { op: "commit", branch: "main", files: { "other.txt": "y\n" } }, { op: "merge", branch: "unit", from: "main", files: { "other.txt": "z\n" }, mark: "new" }]);
    expect(carryClearance(hand.repo, hand.marks.cleared!, hand.marks.new!, "main").reason).toMatch(/^not a mechanical carry: other\.txt differs/);
  });

  it("prints CARRY or VOID through the verb, exit 0 or 1", async () => {
    const { repo, marks } = build([...BASE, { op: "commit", branch: "main", files: { "other.txt": "y\n" } }, { op: "merge", branch: "unit", from: "main", mark: "new" }]);
    const carried = await runReviewCli(["carry", marks.cleared!, marks.new!, "--onto", "main", "--root", repo], repo);
    expect([carried.exitCode, carried.message]).toEqual([0, `CARRY ${marks.new}: default-branch carry of 1 path(s); no own path changed`]);
    const voided = await runReviewCli(["carry", marks.cleared!, "main", "--onto", "main", "--root", repo], repo);
    expect(voided.exitCode).toBe(1);
  });
});

interface ParityCase {
  readonly id: string;
  readonly provenance: string;
  readonly case: "carry" | "plan";
  readonly steps: Step[];
  readonly carry?: { cleared: string; new: string; onto: string };
  readonly plan?: { unit: string; base: string; onto: string; sequence: { at: string; expect: Partial<Plan>; refuse?: string[]; then?: { role: string; verdict: "CLEAR" | "NOT CLEAR"; severity?: string; reason?: string } }[] };
  readonly recorded: { verdict?: "CARRY" | "VOID"; reason?: string; passes?: string[]; final?: string };
}

const DIR = new URL("./__fixtures__/plan-parity/", import.meta.url);
const cases = readdirSync(fileURLToPath(DIR)).filter(name => name.endsWith(".json")).sort()
  .map(name => JSON.parse(readFileSync(new URL(name, DIR), "utf8")) as ParityCase);

describe("parity with the recorded carry and wave cases", () => {
  it("carry matches the recorded carry and wave cases", () => {
    expect(cases.map(entry => entry.id)).toEqual(["carry-held", "carry-voided-own-path", "gate-pass-sequence"]);
    for (const entry of cases) {
      const { repo, marks } = build(entry.steps);
      if (entry.case === "carry") {
        const result = carryClearance(repo, marks[entry.carry!.cleared]!, marks[entry.carry!.new]!, entry.carry!.onto);
        expect(result.verdict, entry.id).toBe(entry.recorded.verdict);
        expect(result.reason, entry.id).toMatch(new RegExp(entry.recorded.reason!));
        continue;
      }
      const spec = entry.plan!;
      const verdicts: VerdictRecord[] = [];
      const passes: string[] = [];
      let last: Plan | undefined;
      for (const step of spec.sequence) {
        const head = marks[step.at]!;
        const classification = classify(diffFiles(repo, marks[spec.base]!, head));
        last = planReview({ unit: spec.unit, head, classification, mechanical: "PASS", verdicts, carries: from => { const result = carryClearance(repo, from, head, spec.onto); return { carry: result.verdict === "CARRY", reason: result.reason }; } });
        expect(last, `${entry.id} at ${step.at}`).toMatchObject(step.expect);
        for (const pass of step.refuse ?? []) expect(allowPass(last, pass).allowed, `${entry.id}: ${pass} at ${step.at}`).toBe(false);
        if (step.then) {
          expect(allowPass(last, step.then.role).allowed, `${entry.id}: ${step.then.role}`).toBe(true);
          passes.push(step.then.role);
          verdicts.push(makeVerdict({ unit: spec.unit, role: step.then.role, head, clear: step.then.verdict === "CLEAR", blind: step.then.role !== "closure-delta", ...(step.then.reason ? { reason: step.then.reason } : {}), ...(step.then.severity ? { severity: step.then.severity } : {}) }));
        }
      }
      expect(passes, entry.id).toEqual(entry.recorded.passes);
      expect(last?.status, entry.id).toBe(entry.recorded.final);
    }
  });
});

describe("clossys review plan and verdict through the verb", () => {
  const evidence = (head: string, hasNextPage = false) => ({
    pullRequest: { id: "PR_1", headRefOid: head, baseRefOid: "b".repeat(40) },
    checks: { nodes: [], pageInfo: { hasNextPage, hasPreviousPage: false } },
    reviews: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
    reviewThreads: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
  });

  it("plans from the mechanical record, the verdict log and exact-head evidence, and refuses what the budget does not allow", async () => {
    const { repo, marks } = build([
      { op: "commit", branch: "main", files: { "scripts/check-demo.mjs": "process.exitCode = 0;\n" }, mark: "base" },
      { op: "branch", name: "unit", from: "main" },
      { op: "commit", branch: "unit", files: { "scripts/check-demo.mjs": "// a clearer message\nprocess.exitCode = 0;\n" }, mark: "head" },
    ]);
    const head = marks.head!;
    const out = (name: string, value: unknown) => { const file = join(repo, ".out", name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(value)}\n`); return file; };
    const mechanical = out("review.json", { schema: "clossys.review/1", head, verdict: "PASS", line: `MECHANICAL: PASS ${head} ${"c".repeat(40)}` });
    const log = join(repo, ".out", "verdicts.jsonl");
    const plan = (...extra: string[]) => runReviewCli(["plan", "unit", "--base", "main", "--onto", "main", "--root", repo, "--mechanical", mechanical, "--verdicts", log, ...extra], repo);

    const noMechanical = await runReviewCli(["plan", "unit", "--base", "main", "--root", repo], repo);
    expect(noMechanical.message).toMatch(new RegExp(`NEXT: mechanical ${head}$`));
    const first = await plan("--evidence", out("evidence.json", evidence(head)));
    expect([first.exitCode, first.message.split("\n").at(-1)]).toEqual([0, `NEXT: blind ${head}`]);
    expect(first.message).toMatch(/pass\/fail logic: unchanged/);
    const stale = await plan("--evidence", out("stale.json", evidence(marks.base!)));
    expect([stale.exitCode, stale.message]).toEqual([1, `REFUSED ${head}: the review evidence is for ${marks.base}, not the exact head ${head}`]);
    expect((await plan("--evidence", out("partial.json", evidence(head, true)))).message).toMatch(/pagination-incomplete/);

    const unattested = await runReviewCli(["verdict", "unit", "--role", "blind", "--head", head, "--clear", "--log", log, "--root", repo], repo);
    expect([unattested.exitCode, unattested.message]).toEqual([1, "REFUSED: a blind verdict needs the blind attestation: no other review file was read for this unit"]);
    const recorded = await runReviewCli(["verdict", "unit", "--role", "blind", "--head", head, "--clear", "--blind", "--log", log, "--root", repo], repo);
    expect([recorded.exitCode, recorded.message]).toEqual([0, `blind: CLEAR ${head}`]);
    expect(JSON.parse(readFileSync(log, "utf8"))).toMatchObject({ role: "blind", blind: true, line: `CLEAR ${head}` });

    const cleared = await plan("--ask", "final");
    expect(cleared.exitCode).toBe(1);
    expect(cleared.message.split("\n").slice(-2)).toEqual([`CLEARED ${head}`, "REFUSED final: no final after a CLEAR blind"]);
    expect((await runReviewCli(["verdict", "unit", "--role", "final", "--head", head, "--clear", "--blind", "--log", log, "--root", repo], repo)).exitCode).toBe(1);
  });
});
