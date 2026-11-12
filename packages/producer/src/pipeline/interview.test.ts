import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGapsCli } from "../cli/gaps.js";
import { runCli } from "../cli/main.js";
import { runNextCli } from "../cli/next.js";
import { ladderIssues } from "./candidate-ladder.js";
import { CONFIRM_REF, gapsOf, interviewIssues, interviewOf, ROUND_SIZE } from "./interview.js";
import type { Gap, Question } from "./interview.js";
import { PACKAGE_ROOT } from "./options.js";
import { runPipeline } from "./runner.js";
import { readSeatPolicy, SEAT_POLICY_FILE } from "./seat-policy.js";
import { appendRecord, buildRecord } from "./trace.js";

/** The foundry consumer this package ships beside: a real slot model to copy (never the real records). */
const FOUNDRY = join(PACKAGE_ROOT, "..", "..", "clossys");
const dirs: string[] = [];
function workspace(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "interview-")));
  dirs.push(root);
  cpSync(FOUNDRY, join(root, "clossys"), { recursive: true, filter: source => !source.endsWith(SEAT_POLICY_FILE.split("/").at(-1)!) });
  writeFileSync(join(root, ".gitignore"), "node_modules/\n/.clossys/runs/\n");
  return root;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
/**
 * The copy with no Producer seat recorded: each seat slot's pin removed, as before the owner's Producer round 1
 * recorded the 18 seats (the real records now carry them; these cases ask how unassigned seats are asked).
 */
function unseated(root: string): string {
  const producer = join(root, "clossys", "agents", "producer");
  for (const slot of readdirSync(producer)) if (existsSync(join(producer, slot, "pin.json"))) rmSync(join(producer, slot, "pin.json"));
  return root;
}

const seatQuestions = (questions: readonly Question[]) => questions.filter(question => question.step === "seats");

// Each case reads the whole copied slot model (gaps take a second or two), so cases get a minute.
describe("interview (next --owner) and gaps", { timeout: 120_000 }, () => {
  it("asks the seat policy first while it is missing, and the 18 seats as a handful of grouped questions", () => {
    const root = unseated(workspace());
    expect(readSeatPolicy(root).state).toBe("missing");
    const interview = interviewOf(root, { agent: "producer" });
    expect(interview.rounds[0]![0]!.id).toBe("seat-policy");
    for (const round of interview.rounds) expect(round.length).toBeLessThanOrEqual(ROUND_SIZE);
    const all = interview.rounds.flat();
    const seats = seatQuestions(all).filter(question => question.id !== "seat-policy");
    const seatItems = seats.flatMap(question => question.items);
    expect(seatItems.length).toBeGreaterThanOrEqual(10);
    expect(seats.length).toBeLessThanOrEqual(4);
    for (const question of seats) expect(question.after).toContain("seat-policy");
    // A placeholder is named in fill, never guessed.
    const mid = seats.flatMap(question => question.options).find(option => option.calls.some(call => call.includes("<model:mid>")));
    if (mid) expect(mid.fill["<model:mid>"]).toBeTruthy();
    expect(interviewIssues(interview, gapsOf(root))).toEqual([]);
  });

  it("fills the seat answers from the recorded seat policy, and asks it no more", async () => {
    const root = unseated(workspace());
    const policy = await runPipeline(["seat", "--policy", "--model", "mid=fixture-mid", "--model", "high=fixture-high", "--root", root], root);
    expect(policy.exitCode, policy.message).toBe(0);
    expect(existsSync(join(root, SEAT_POLICY_FILE))).toBe(true);
    const all = interviewOf(root, { agent: "producer" }).rounds.flat();
    expect(all.some(question => question.id === "seat-policy")).toBe(false);
    const calls = seatQuestions(all).flatMap(question => question.options.flatMap(option => option.calls));
    expect(calls.some(call => call.includes("fixture-mid"))).toBe(true);
    expect(calls.some(call => call.some(word => word.includes("<model:")))).toBe(false);
    // A placeholder policy is refused: the seat policy never holds a guess.
    expect((await runPipeline(["seat", "--policy", "--model", "mid=<model:mid>", "--root", root], root)).exitCode).toBe(1);
  });

  it("every option of every agent's round carries exact clossys argv, and every request names its upstream addressee", () => {
    const root = workspace();
    for (const agent of ["producer", "director", "designer", "writer", "publisher"] as const) {
      const interview = interviewOf(root, { agent });
      const gaps = gapsOf(root, { agent });
      expect(interviewIssues(interview, gaps), agent).toEqual([]);
      for (const gap of gaps.gaps) expect(gap.agent === agent || gap.from === agent, `${agent} ${gap.code}`).toBe(true);
    }
  });

  it("the Designer's gaps list a request to the Director or say why there is none", () => {
    const root = workspace();
    const gaps = gapsOf(root, { agent: "designer" });
    const toDirector = gaps.gaps.filter(gap => gap.kind === "request" && gap.from === "designer" && gap.to === "director");
    if (!toDirector.length) expect(gaps.notes.some(note => note.startsWith("no designer request to the director"))).toBe(true);
    for (const gap of toDirector) expect(gap.need?.every(item => item.startsWith("designer/"))).toBe(true);
  });

  it("a cited Director cell left not-needed becomes a request to the Director in its round", async () => {
    const root = workspace();
    const before = gapsOf(root, { agent: "designer" });
    const cited = findCitedDirectorCell(root);
    if (!cited) return; // no Designer slot cites a Director cell in this fixture
    const marked = await runPipeline(["pin", `director/${cited}`, "--not-needed", "--reason", "fixture: the Designer asks again", "--root", root], root);
    expect(marked.exitCode, marked.message).toBe(0);
    const after = gapsOf(root, { agent: "designer" });
    const requests = after.gaps.filter(gap => gap.code === "request.input-not-needed" && gap.to === "director" && gap.item === `director/${cited}`);
    expect(before.gaps.some(gap => gap.code === "request.input-not-needed" && gap.item === `director/${cited}`)).toBe(false);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ from: "designer", to: "director", agent: "director" });
    const director = interviewOf(root, { agent: "director" }).rounds.flat();
    expect(director.some(question => question.items.includes(`director/${cited}`) && question.requestedBy.includes("designer"))).toBe(true);
  });

  it("mutation proofs: an option with no argv fails owner.argv, a request with no addressee fails request.addressee", () => {
    const root = workspace();
    const interview = interviewOf(root, { agent: "producer" });
    const gaps = gapsOf(root);
    expect(interviewIssues(interview, gaps)).toEqual([]);
    const [first, ...rest] = interview.rounds[0]!;
    const stripped = { ...first!, options: first!.options.map((option, index) => index ? option : { ...option, calls: [] }) };
    expect(interviewIssues({ rounds: [[stripped, ...rest]] }, gaps).map(issue => issue.rule)).toContain("owner.argv");
    const unfilled = { ...first!, options: first!.options.map(option => ({ ...option, calls: [["clossys", "seat", "<step>"]], fill: {} })) };
    expect(interviewIssues({ rounds: [[unfilled]] }, gaps).map(issue => issue.rule)).toContain("owner.argv");
    const request: Gap = { kind: "request", code: "request.input-unpinned", agent: "director", item: "director/x", step: "pin.director", decider: "owner", message: "fixture", from: "designer" };
    expect(interviewIssues({ rounds: [] }, { gaps: [request] }).map(issue => issue.rule)).toEqual(["request.addressee"]);
    expect(interviewIssues({ rounds: [] }, { gaps: [{ ...request, to: "director" }] })).toEqual([]);
  });

  it("a recorded created candidate with no reason no seed fit is a ladder gap", () => {
    const root = workspace();
    const output = "clossys/agents/writer/strings.statuses/candidates/statuses-v9.json";
    const record = (ladder: { rung: string; reason?: string }) => buildRecord({
      root, step: "writer.candidates", invocation: "next writer", argv: ["next", "writer/strings.statuses", "--submit", "x.json"],
      start: new Date(0), end: new Date(1), exit: 0, observation: { reads: new Map(), writes: new Set() },
      decision: { model: "fixture-model", tier: "mid", basis: "agent", ladder, skill: { path: "s.md", sha256: "0".repeat(64) }, output: { path: output, sha256: "1".repeat(64) } },
    });
    appendRecord(root, record({ rung: "create", reason: "no seed covers the statuses" }));
    expect(gapsOf(root, { agent: "writer" }).gaps.filter(gap => gap.code.startsWith("ladder."))).toEqual([]);
    appendRecord(root, record({ rung: "create" }));
    const ladder = gapsOf(root, { agent: "writer" }).gaps.filter(gap => gap.code.startsWith("ladder."));
    expect(ladder.map(gap => gap.code)).toEqual(["ladder.create-justification"]);
  });

  it("gaps --json and next --owner --agent print the same views and record nothing", async () => {
    const root = workspace();
    const gaps = await runGapsCli(["--agent", "designer", "--json", "--root", root], root);
    expect(gaps.exitCode).toBe(0);
    expect(gaps.output).toMatchObject({ schema: "clossys.gaps/1", agent: "designer" });
    const owner = await runNextCli(["--owner", "--agent", "producer", "--json", "--root", root], root);
    const output = owner.output as { schema: string; rounds: Question[][] };
    expect(output.schema).toBe("clossys.next-owner/2");
    for (const round of output.rounds) expect(round.length).toBeLessThanOrEqual(ROUND_SIZE);
    expect(existsSync(join(root, ".clossys", "runs"))).toBe(false);
  });
});

// DIR-INT: the Director's owner interview asks content (archetype, then "Pick <cell>"), not only meta requests.
/** The copied Director as it was before the owner's interview: no archetype recorded, no owner pick (temp copy only). */
/**
 * The copy with every Director agent pick awaiting the owner's confirmation (its `confirmed` dropped), so the
 * agent-picks question and the agent-held request order are asked whatever the real records confirmed since.
 */
function unconfirmed(root: string): string {
  const director = join(root, "clossys", "agents", "director");
  for (const cell of readdirSync(director)) {
    const path = join(director, cell, "pin.json");
    if (!existsSync(path)) continue;
    const pin = JSON.parse(readFileSync(path, "utf8")) as { basis: string; confirmed?: unknown };
    if (pin.basis === "agent" && pin.confirmed !== undefined) { delete pin.confirmed; writeFileSync(path, `${JSON.stringify(pin, null, 2)}\n`); }
  }
  return root;
}
function unrecorded(root: string): string {
  const director = join(root, "clossys", "agents", "director");
  rmSync(join(root, "clossys", "evidence", "director", "director-archetype.md"), { force: true });
  for (const cell of readdirSync(director)) {
    const pin = join(director, cell, "pin.json");
    if (existsSync(pin) && JSON.parse(readFileSync(pin, "utf8")).basis === "picked") rmSync(pin);
  }
  return root;
}

describe("Director content questions (next --owner --agent director)", { timeout: 120_000 }, () => {
  const contentOf = (questions: readonly Question[]) => questions.filter(question => question.id.startsWith("director:"));
  it("asks the archetype first, then each owner-held core cell as Pick <cell> with candidate pin options, recommended first", () => {
    const root = unrecorded(workspace());
    const interview = interviewOf(root, { agent: "director" });
    const all = interview.rounds.flat().filter(question => question.step !== "seats");
    expect(all[0]!.id).toBe("director.archetype");
    expect(all[0]!.options[0]!.calls[0]).toEqual(["clossys", "director", "check", "archetype", "default", "--by", "owner"]);
    const content = contentOf(all);
    expect(content.length).toBe(24);
    expect(all.slice(1, 1 + content.length).map(question => question.id)).toEqual(content.map(question => question.id));
    for (const question of content) {
      const item = question.items[0]!;
      expect(question.question).toMatch(/^Pick /);
      expect(question.after).toContain("director.archetype");
      expect(question.options.length).toBeGreaterThanOrEqual(2);
      const pins = question.options.filter(option => option.calls[0]?.[1] === "pin");
      expect(pins.length).toBeGreaterThanOrEqual(1);
      for (const option of pins) expect(option.calls[0]).toEqual(["clossys", "pin", item, expect.stringMatching(/-v\d+\.md$/), "--basis", "picked"]);
      expect(question.freeText?.calls?.map(call => call.slice(0, 2))).toEqual([["clossys", "evidence"], ["clossys", "options"]]);
    }
    // Dependency order: Delivery before Bet; a cited cell (need) before the cells that cite it (promise).
    const at = (cell: string) => content.findIndex(question => question.items[0] === `director/${cell}`);
    expect(at("capability.operation.delivery")).toBeLessThan(at("execution.priority.bet"));
    expect(at("context.customer.need")).toBeLessThan(at("advantage.proposition.promise"));
    for (const round of interview.rounds) expect(round.length).toBeLessThanOrEqual(ROUND_SIZE);
    expect(interviewIssues(interview, gapsOf(root, { agent: "director" }))).toEqual([]);
  });

  it("folds a request for an asked cell into its content question; agent picks are one confirm question", () => {
    const root = unconfirmed(unrecorded(workspace()));
    const all = interviewOf(root, { agent: "director" }).rounds.flat();
    const promise = all.find(question => question.id === "director:advantage.proposition.promise")!;
    expect(promise.requestedBy).toContain("designer");
    expect(promise.question).toMatch(/\(also unblocks \d+ designer slots?/);
    expect(all.some(question => question.id === "request:director/advantage.proposition.promise")).toBe(false);
    const content = new Set(contentOf(all).flatMap(question => question.items));
    for (const question of all.filter(each => each.id.startsWith("request:director/"))) expect(content.has(question.items[0]!)).toBe(false);
    const picks = all.filter(question => question.id === "director.agent-picks");
    expect(picks).toHaveLength(1);
    // Every option records: confirm all, or confirm one group (largest first); none only prints a brief.
    expect(picks[0]!.options.length).toBeGreaterThanOrEqual(2);
    expect(picks[0]!.options.length).toBeLessThanOrEqual(4);
    expect(picks[0]!.options[0]!.calls).toHaveLength(picks[0]!.items.length);
    for (const option of picks[0]!.options) expect(option.calls.every(call => call[1] === "pin" && call.includes("--confirm") && !call.includes("--basis"))).toBe(true);
    for (const item of picks[0]!.items) expect(content.has(item)).toBe(false);
  });

  // Owner Foundry Director round 8: "Agent pick + your confirm". Running the confirm option keeps each pick
  // basis agent (what Q7 counts on a non-core cell) and records the owner's confirmation; basis bulk never counts.
  it("the confirm option's argv keeps each agent pick basis agent and records the owner's confirmation", async () => {
    const root = workspace();
    const director = join(root, "clossys", "agents", "director");
    const core = new Set(interviewOf(root, { agent: "director" }).rounds.flat().filter(question => question.id.startsWith("director:")).flatMap(question => question.items));
    const pinOf = (cell: string) => JSON.parse(readFileSync(join(director, cell, "pin.json"), "utf8")) as { candidate: string; decidedBy: string; basis: string; confirmed?: { by: string; ref: string } };
    const cells = readdirSync(director).filter(cell => existsSync(join(director, cell, "pin.json")) && !core.has(`director/${cell}`) && pinOf(cell).basis !== "picked").slice(0, 2);
    expect(cells).toHaveLength(2);
    for (const cell of cells) expect((await runCli(["pick", `director/${cell}`, pinOf(cell).candidate, "--by", "agent:director", "--root", root], root)).exitCode).toBe(0);
    const question = interviewOf(root, { agent: "director" }).rounds.flat().find(each => each.id === "director.agent-picks")!;
    const confirm = question.options[0]!;
    expect(confirm.fill).toHaveProperty(CONFIRM_REF);
    for (const cell of cells) expect(confirm.calls).toContainEqual(["clossys", "pin", `director/${cell}`, pinOf(cell).candidate, "--confirm", "--ref", CONFIRM_REF]);
    const REF = "clossys/workspace#46 issuecomment-1";
    for (const call of confirm.calls) {
      const result = await runCli([...call.slice(1).map(word => word === CONFIRM_REF ? REF : word), "--root", root], root);
      expect(result.exitCode, result.message).toBe(0);
    }
    for (const cell of cells) expect(pinOf(cell)).toMatchObject({ decidedBy: "agent:director", basis: "agent", confirmed: { by: "owner", ref: REF } });
    // A confirmed pick is no longer asked.
    const after = interviewOf(root, { agent: "director" }).rounds.flat().find(each => each.id === "director.agent-picks");
    for (const cell of cells) expect(after?.items ?? []).not.toContain(`director/${cell}`);
  });

  it("an unclear request on an agent-held cell recommends the Director's re-draft, not owner evidence", () => {
    const root = unconfirmed(unrecorded(workspace()));
    const requests = interviewOf(root, { agent: "director" }).rounds.flat().filter(question => question.id.startsWith("request:director/"));
    const director = join(root, "clossys", "agents", "director");
    const held = new Set(readdirSync(director).filter(cell => existsSync(join(director, cell, "pin.json")) && JSON.parse(readFileSync(join(director, cell, "pin.json"), "utf8")).decidedBy === "agent:director").map(cell => `director/${cell}`));
    const unclear = requests.filter(question => held.has(question.items[0]!) && question.question.includes("unclear"));
    expect(unclear.length).toBeGreaterThan(0);
    for (const question of unclear) {
      const [first, second] = question.options;
      expect(first).toMatchObject({ recommended: true, calls: [["clossys", "options", question.items[0], "--redraft"]] });
      expect(first!.label).toMatch(/^The Director re-drafts/);
      expect(second!.calls[0]?.slice(0, 2)).toEqual(["clossys", "evidence"]);
    }
  });
});

describe("candidate selection ladder", () => {
  it("select and adapt name their seed; create says why no seed fit", () => {
    expect(ladderIssues("writer", { rung: "select", seed: "writer/strings.statuses/statuses-v1" })).toEqual([]);
    expect(ladderIssues("writer", { rung: "adapt" }).map(issue => issue.rule)).toEqual(["ladder-fields"]);
    expect(ladderIssues("writer", { rung: "create", reason: "no template covers it" })).toEqual([]);
    expect(ladderIssues("writer", { rung: "create" }).map(issue => issue.rule)).toEqual(["create-justification"]);
    expect(ladderIssues("writer", undefined).map(issue => issue.rule)).toEqual(["missing-ladder"]);
  });
  it("the Designer climbs the source ladder: L1 stock, L2 partner, L3 question, L4 Foundry with a reason", () => {
    expect(ladderIssues("designer", { rung: "L1", seed: "shadcn@aria/button" })).toEqual([]);
    expect(ladderIssues("designer", { rung: "L2", seed: "origin-ui/stepper" })).toEqual([]);
    expect(ladderIssues("designer", { rung: "L4" }).map(issue => issue.rule)).toEqual(["create-justification"]);
    expect(ladderIssues("designer", { rung: "select", seed: "x" }).map(issue => issue.rule)).toEqual(["ladder-fields"]);
  });
});

/** A Director cell some Designer slot's inputs cite. */
function findCitedDirectorCell(root: string): string | null {
  const designer = join(root, "clossys", "agents", "designer");
  for (const id of readdirSync(designer).sort()) {
    let slot: { inputs?: string[] };
    try { slot = JSON.parse(readFileSync(join(designer, id, "slot.json"), "utf8")) as { inputs?: string[] }; } catch { continue; }
    for (const input of slot.inputs ?? []) if (existsSync(join(root, "clossys", "agents", "director", input, "pin.json"))) return input;
  }
  return null;
}
