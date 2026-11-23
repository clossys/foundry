/**
 * CHAT-DIR (foundry-build-0048, gaps 8 to 13): `clossys ia director --adopt` places the Director's whole catalog (every
 * leaf once, none pruned), so `clossys director check status` reads the root (findings, not an unreadable root); `clossys init` runs that adopt
 * when the root is missing and leaves it alone after;
 * the archetype question opens the Director interview with no candidate yet; an owner's archetype answer carries
 * `--via` and `--quote`; and `next --stage/--submit --skill` takes the logical skill id or the installed file.
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { readStrategyRoot } from "@clossys/director";
import { afterEach, describe, expect, it } from "vitest";
import { interviewOf } from "../pipeline/interview.js";
import { skillFile } from "../pipeline/chain.js";
import { STEPS } from "../pipeline/steps/index.js";
import { directorIa } from "../records/slot-model/foundry-ia.js";
import { directorStoreReader } from "../records/slots.js";
import { runCli } from "./main.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

type IaJson = { nodes: { children: { slots: string[] }[] }[] };
const iaFile = (root: string) => join(root, "clossys", "agents", "director", "ia.json");
const placed = (root: string): string[] => (JSON.parse(readFileSync(iaFile(root), "utf8")) as IaJson).nodes.flatMap(node => node.children.flatMap(child => child.slots));

async function configured(): Promise<string> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "chat-dir-")));
  dirs.push(root);
  expect((await runCli(["config", "--init", "--root", root], root)).exitCode).toBe(0);
  return root;
}
/** A configured consumer with the Director adopted on its own (no agent loops placed in its IA). */
async function adopted(): Promise<string> {
  const root = await configured();
  const adopt = await runCli(["ia", "director", "--adopt", "--root", root], root);
  expect(adopt.exitCode, adopt.message).toBe(0);
  return root;
}
const catalogPlaced = (root: string) => placed(root).filter(id => directorIa().slots.has(id));

describe("CHAT-DIR: the Director interview opens in a fresh consumer", { timeout: 240_000 }, () => {
  it("ia director --adopt places every catalog leaf exactly once; director check status reads the root; the re-run keeps it", async () => {
    const root = await adopted();
    // The root reads: status reports the strategy's findings (exit 1 while hard findings remain, director/src/cli/checks.ts),
    // never the unreadable root (exit 2, "Grouping must place every catalog leaf exactly once").
    const status = await runCli(["director", "check", "status", "--root", join(root, "clossys", "agents", "director")], root);
    expect(status.exitCode, status.message).toBe(1);
    expect(readStrategyRoot(join(root, "clossys", "agents", "director"), directorStoreReader).issues).toEqual([]);
    const leaves = placed(root);
    expect(new Set(leaves).size).toBe(leaves.length);
    expect([...leaves].sort()).toEqual([...directorIa().slots.keys()].sort());
    // The adopt re-run keeps the whole catalog (no pruning for the Director).
    const bytes = readFileSync(iaFile(root), "utf8");
    const again = await runCli(["ia", "director", "--adopt", "--root", root], root);
    expect(again.exitCode, again.message).toBe(0);
    expect(readFileSync(iaFile(root), "utf8")).toBe(bytes);
  });

  it("init adopts the Director when its root is missing, and a second init leaves it as it is", async () => {
    const root = await configured();
    const first = await runCli(["init", "--root", root], root);
    expect(first.exitCode, first.message).toBe(0);
    expect((first.output as { director?: string }).director).toBe("adopted");
    expect([...catalogPlaced(root)].sort()).toEqual([...directorIa().slots.keys()].sort());
    const bytes = readFileSync(iaFile(root), "utf8");
    const second = await runCli(["init", "--root", root], root);
    expect(second.exitCode, second.message).toBe(0);
    expect((second.output as { director?: string }).director).toBe("present");
    expect(readFileSync(iaFile(root), "utf8")).toBe(bytes);
  });

  it("raises the archetype with no candidate, first and recommended first; --by owner needs --via and --quote", async () => {
    const root = await adopted();
    const questions = interviewOf(root, { agent: "director" }).rounds.flat().filter(question => question.step !== "seats");
    expect(questions[0]?.id).toBe("director.archetype");
    const option = questions[0]!.options[0]!;
    expect(option.recommended).toBe(true);
    const call = option.calls[0]!;
    expect(call.slice(-6)).toEqual(["--by", "owner", "--via", "chat", "--quote", option.label]);
    const name = call[4]!;
    const archetype = (...more: string[]) => runCli(["director", "check", "archetype", name, "--by", "owner", ...more, "--root", join(root, "clossys", "agents", "director")], root);
    expect((await archetype()).exitCode).toBe(2);
    expect((await archetype("--via", "chat")).exitCode).toBe(2);
    const recorded = await archetype("--via", "chat", "--quote", option.label);
    expect(recorded.exitCode, recorded.message).toBe(0);
    const record = readFileSync(join(root, "clossys", "evidence", "director", "director-archetype.md"), "utf8");
    expect(record).toContain(`via chat: "${option.label}"`);
    const after = interviewOf(root, { agent: "director" }).rounds.flat();
    expect(after.some(question => question.id === "director.archetype")).toBe(false);
  });

  it("next --stage takes the logical skill id or the installed file it names, and refuses another file", async () => {
    const root = await adopted();
    const step = STEPS.find(each => each.id === "director.candidates")!;
    const installed = skillFile(step)!;
    const cell = [...directorIa().slots.keys()][0]!;
    const stage = (skill: string) => runCli(["next", `director/${cell}`, "--stage", "brief", "--model", "fixture-model", "--tier", "high", "--skill", skill, "--root", root], root);
    const refusal = "is not director.candidates's skill";
    const other = skillFile(STEPS.find(each => each.id === "designer.candidates")!)!;
    const wrong = await stage(other);
    expect(wrong.exitCode).toBe(1);
    expect(wrong.message).toContain(refusal);
    for (const given of [relative(root, installed), installed, step.command.skill!]) {
      const result = await stage(given);
      expect(result.message ?? "", given).not.toContain(refusal);
    }
  });
});
