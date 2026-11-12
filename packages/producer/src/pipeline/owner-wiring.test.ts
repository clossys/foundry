import { describe, expect, it } from "vitest";
import { flatConsumer } from "../cli/__fixtures__/flat-consumer.js";
import { runCli } from "../cli/main.js";
import { listSlots } from "../records/slots.js";
import { interviewOf, type Interview, type InterviewAgent } from "./interview.js";
import { ownerWiringIssues } from "./owner-wiring.js";

/** The writer's real interview with its first question's first option rewritten by `change`. */
const rewritten = (change: (calls: readonly (readonly string[])[]) => string[][]) => (root: string, options: { agent: InterviewAgent }): Pick<Interview, "rounds"> => {
  const view = interviewOf(root, options);
  const [first, ...rest] = view.rounds[0] ?? [];
  if (!first) return view;
  return { rounds: [[{ ...first, options: first.options.map((option, index) => index ? option : { ...option, calls: change(option.calls) }) }, ...rest], ...view.rounds.slice(1)] };
};
/** Only the first question, so each case runs a handful of calls. */
const firstOnly = (view: (root: string, options: { agent: InterviewAgent }) => Pick<Interview, "rounds">) => (root: string, options: { agent: InterviewAgent }) => ({ rounds: view(root, options).rounds.slice(0, 1).map(round => round.slice(0, 1)) });

describe("owner.wiring (clossys pipeline check)", () => {
  const root = flatConsumer(["director", "designer", "writer"]);

  it("runs the writer's policy question on a scratch copy: every option exits 0, changes its records and the gaps", async () => {
    const view = interviewOf(root, { agent: "writer" });
    const policy = view.rounds.flat().find(question => question.id === "writer.policy");
    expect(policy, JSON.stringify(view.rounds.flat().map(question => question.id))).toBeDefined();
    expect(policy!.items.length).toBeGreaterThan(1);
    expect(policy!.options.length).toBeGreaterThanOrEqual(2);
    expect(policy!.options.length).toBeLessThanOrEqual(4);
    const result = await ownerWiringIssues(root, { run: runCli, agents: ["writer"], interviewOf: firstOnly(interviewOf) });
    expect(result.issues).toEqual([]);
    expect(result.options).toBe(policy!.options.length);
    // The workspace itself is untouched: the same questions are still asked.
    expect(interviewOf(root, { agent: "writer" }).rounds.flat().map(question => question.id)).toEqual(view.rounds.flat().map(question => question.id));
  }, 300_000);

  it("fails a dead argv: an option that only prints a brief records nothing", async () => {
    const dead = rewritten(calls => [["clossys", "options", calls[0]![2]!, "--more"]]);
    const result = await ownerWiringIssues(root, { run: runCli, agents: ["writer"], interviewOf: firstOnly(dead) });
    expect(result.issues.map(issue => issue.message).join("\n")).toMatch(/writer\.policy a: clossys options writer\/\S+ --more exited 0 but changed no record/);
  }, 300_000);

  it("fails an argv that exits non-zero", async () => {
    const broken = rewritten(calls => [["clossys", "pin", calls[0]![2]!, "no-such-v1.md", "--basis", "picked"]]);
    const result = await ownerWiringIssues(root, { run: runCli, agents: ["writer"], interviewOf: firstOnly(broken) });
    expect(result.issues.map(issue => issue.message).join("\n")).toMatch(/writer\.policy a: clossys pin \S+ no-such-v1\.md --basis picked exited [12]/);
  }, 300_000);

  it("fails an answer the gaps do not see: it re-records a slot no gap is about", async () => {
    const settled = listSlots(`${root}/clossys`, "writer").find(entry => entry.pin?.basis === "bulk")!;
    const unseen = rewritten(() => [["clossys", "pin", `writer/${settled.id}`, settled.pin!.candidate, "--basis", "picked"]]);
    const result = await ownerWiringIssues(root, { run: runCli, agents: ["writer"], interviewOf: firstOnly(unseen) });
    expect(result.issues.map(issue => issue.message).join("\n")).toContain("writer writer.policy a: the answer ran, but clossys gaps --agent writer reports the same gaps");
  }, 300_000);
});
