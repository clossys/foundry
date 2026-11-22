import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
// Load the CLI first, as every caller does: the interview reads the pipeline handlers.
import "../cli/main.js";
import { QUEUE_ANSWER } from "./chain.js";
import { gapsOf, interviewOf } from "./interview.js";
import { writerKeysUnapproved } from "./status.js";

/**
 * The owner approves Writer keys on the queue (BR-PIPELINE2 round 3): `clossys approve` is retired, and a Writer key a
 * newer candidate proposes that no pin holds is an owner coverage gap on pin.writer. The Writer's owner questions answer
 * it with `clossys pin writer/<slot> <candidate> --basis picked --by <queue-answer>`, the answered queue.approve entry.
 * The pin side (a pin naming a missing or unanswered queue.approve entry is refused) is in cli/one-format.test.ts.
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

  it("asks the owner with a pin of the newer candidate that cites the queue answer, never clossys approve", () => {
    const root = withNewKey();
    const questions = interviewOf(root, { agent: "writer" }).rounds.flat();
    const calls = questions.flatMap(question => question.options.flatMap(option => option.calls));
    expect(calls).toContainEqual(["clossys", "pin", `writer/${SLOT}`, "copy-v2.md", "--basis", "picked", "--by", QUEUE_ANSWER]);
    expect(calls.filter(call => call[1] === "approve")).toEqual([]);
    expect(questions.map(question => question.freeText?.verb).filter(verb => verb === "clossys approve")).toEqual([]);
  });

  it("raises nothing for the slot while its pin holds every key", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "writer-approval-")));
    roots.push(root);
    cpSync(FIXTURE, root, { recursive: true });
    expect(writerKeysUnapproved(root).has(SLOT)).toBe(false);
    expect(gapsOf(root, { agent: "writer" }).gaps.filter(gap => gap.code === "open.pin.writer" && gap.item === `writer/${SLOT}`)).toEqual([]);
  });
});
