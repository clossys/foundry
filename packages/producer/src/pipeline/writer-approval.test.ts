import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
// Load the CLI first, as every caller does: the interview reads the pipeline handlers.
import "../cli/main.js";
import { ownerEntry } from "../cli/__fixtures__/owner-entry.js";
import { QUEUE_ANSWER } from "./chain.js";
import { gapsOf, interviewOf } from "./interview.js";
import { runPipeline } from "./runner.js";
import { writerKeysUnapproved } from "./status.js";

/**
 * The owner approves Writer keys on the queue (BR-PIPELINE2 round 3): `clossys approve` is retired, and a Writer key a
 * newer candidate proposes that no pin holds is an owner coverage gap on pin.writer. The Writer's owner questions answer
 * it with `clossys pin writer/<slot>#<record> <candidate> --basis picked --by <queue-answer>`, the answered
 * queue.approve entry; the record is the one the candidate's name carries, as the retired approve derived it, since a
 * Writer copy slot pins per record. The offered call is run here; the pin side (a pin naming a missing or unanswered
 * queue.approve entry is refused) is in cli/one-format.test.ts.
 */
const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const SLOT = "frames.site-header.copy";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** A copy of the fixture consumer whose pinned Writer slot holds a newer candidate proposing one more key. */
function withNewKey(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "writer-approval-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  const candidates = join(root, "clossys", "agents", "writer", SLOT, "candidates");
  const v1 = readFileSync(join(candidates, "copy-v1.md"), "utf8");
  writeFileSync(join(candidates, "copy-v2.md"), `${v1.replace("copy-v1.md", "copy-v2.md").trimEnd()}\n\n### navigation.home\n<!-- {"id":"navigation.home","bindings":[]} -->\nHome\n`);
  return root;
}

describe("unapproved Writer keys are an owner queue gap answered by a pin", { timeout: 120_000 }, () => {
  it("raises open.pin.writer for a pinned slot whose newer candidate proposes a key, once per slot", () => {
    const root = withNewKey();
    expect(writerKeysUnapproved(root).get(SLOT)).toEqual(["navigation.home"]);
    const writer = gapsOf(root, { agent: "writer" }).gaps.filter(gap => gap.code === "open.pin.writer");
    expect(writer.filter(gap => gap.item === `writer/${SLOT}`)).toEqual([expect.objectContaining({ kind: "coverage", step: "pin.writer", decider: "owner", message: expect.stringContaining("navigation.home") })]);
    const items = writer.map(gap => gap.item);
    expect(new Set(items).size).toBe(items.length);
  });

  it("asks the owner with a pin of the newer candidate's record that cites the queue answer, never clossys approve", () => {
    const root = withNewKey();
    const questions = interviewOf(root, { agent: "writer" }).rounds.flat();
    const calls = questions.flatMap(question => question.options.flatMap(option => option.calls));
    expect(calls).toContainEqual(["clossys", "pin", `writer/${SLOT}#copy`, "copy-v2.md", "--basis", "picked", "--by", QUEUE_ANSWER]);
    // A candidate pin of a per-record slot always names the record (a slot-level --not-needed answer names none).
    expect(calls.filter(call => call[1] === "pin" && call[2] === `writer/${SLOT}` && call.includes("--basis"))).toEqual([]);
    expect(calls.filter(call => call[1] === "approve")).toEqual([]);
    expect(questions.map(question => question.freeText?.verb).filter(verb => verb === "clossys approve")).toEqual([]);
  });

  it("runs the offered call: refused as printed, and with the owner's answered queue.approve entry it pins and approves the keys", async () => {
    // The slot's submitted, passing candidate with no pin: every key it holds waits for the owner's approval.
    const root = realpathSync(mkdtempSync(join(tmpdir(), "writer-approval-")));
    roots.push(root);
    const unpinned = join(FIXTURE, "clossys", "agents", "writer", SLOT, "pin.json");
    cpSync(FIXTURE, root, { recursive: true, filter: src => src !== unpinned });
    expect(writerKeysUnapproved(root).get(SLOT)).toEqual(["navigation.close", "navigation.label", "navigation.open", "skip.label"]);
    const offered = () => interviewOf(root, { agent: "writer" }).rounds.flat().flatMap(question => question.options.flatMap(option => option.calls))
      .filter(call => call[1] === "pin" && call[2]!.startsWith(`writer/${SLOT}`) && call.includes("--basis") && call.includes(QUEUE_ANSWER));
    const call = offered()[0]!;
    expect(call.slice(2, 4)).toEqual([`writer/${SLOT}#copy`, "copy-v1.md"]);
    const at = ["--root", root];
    const placeholder = await runPipeline([...call.slice(1), ...at], root);
    expect(placeholder.exitCode).toBe(1);
    expect(placeholder.message).toBe(`pin refused: --by ${QUEUE_ANSWER} names no queue answer; an owner pin is --by owner:queue.<kind>#<id>, else planner[:<ref>] or agent:<agent>`);
    const by = ownerEntry(join(root, "clossys"), { queue: "approve", id: "20261122T0000Z-writer-approval", about: `writer/${SLOT}`, answer: { candidate: "copy-v1.md" }, at: "2026-11-22T00:00:00Z" });
    const answered = await runPipeline([...call.slice(1).map(word => word === QUEUE_ANSWER ? by : word), ...at], root);
    expect(answered.exitCode, answered.message).toBe(0);
    const pin = JSON.parse(readFileSync(join(root, "clossys", "agents", "writer", SLOT, "pin.json"), "utf8")) as { records: Record<string, { candidate: string; decidedBy: string; basis: string }> };
    expect(pin.records.copy).toMatchObject({ candidate: "copy-v1.md", decidedBy: by, basis: "picked" });
    expect(writerKeysUnapproved(root).has(SLOT)).toBe(false);
    expect(offered()).toEqual([]);
  });

  it("raises nothing for the slot while its pin holds every key", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "writer-approval-")));
    roots.push(root);
    cpSync(FIXTURE, root, { recursive: true });
    expect(writerKeysUnapproved(root).has(SLOT)).toBe(false);
    expect(gapsOf(root, { agent: "writer" }).gaps.filter(gap => gap.code === "open.pin.writer" && gap.item === `writer/${SLOT}`)).toEqual([]);
  });
});
