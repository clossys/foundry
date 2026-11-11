import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flatConsumer } from "../cli/__fixtures__/flat-consumer.js";
import { runCli } from "../cli/main.js";
import { readPin } from "../records/slots.js";
import { writeCandidate } from "../records/slot-write.js";
import { directionSection, planDirectorRefs } from "./director-refs.js";

const CELL = "identity.naming.architecture";
const SLOT = "strings.navigation";

/** A copy of the repository consumer with the Director cell picked at its v2 (Direction unchanged from v1). */
async function bumpedConsumer() {
  const root = flatConsumer(["director", "writer"]);
  const consumer = join(root, "clossys");
  const pick = await runCli(["pick", `director/${CELL}`, "studio-agent-naming-v2", "--by", "agent:director", "--root", root], root);
  expect(pick.exitCode, pick.message).toBe(0);
  return { root, consumer };
}
const writerDir = (consumer: string, slot: string) => join(consumer, "agents", "writer", slot, "candidates");
const pinnedBytes = (consumer: string, slot: string) => readFileSync(join(writerDir(consumer, slot), readPin(consumer, "writer", slot)!.candidate), "utf8");

describe("clossys migrate director-refs", () => {
  it("--check exits 0 when no Writer citation is older than its Director pin, and 1 when one is", async () => {
    const root = flatConsumer(["director", "writer"]);
    const clean = await runCli(["migrate", "director-refs", "--check", "--root", root], root);
    expect(clean.exitCode, clean.message).toBe(0);
    const { root: bumped, consumer } = await bumpedConsumer();
    const before = readdirSync(writerDir(consumer, SLOT)).sort();
    const pending = await runCli(["migrate", "director-refs", "--check", "--root", bumped], bumped);
    expect(pending.exitCode).toBe(1);
    expect(pending.message).toContain(`writer/${SLOT}: studio-v1.md cites ${CELL} @1 -> @2`);
    expect(readdirSync(writerDir(consumer, SLOT)).sort()).toEqual(before);
  }, 120_000);

  it("re-cites at the pinned version: only the refs change, the copy is identical, and the agent pick lands", async () => {
    const { root, consumer } = await bumpedConsumer();
    const original = pinnedBytes(consumer, SLOT);
    const result = await runCli(["migrate", "director-refs", "--by", "agent:writer", "--root", root], root);
    expect(result.exitCode, result.message).toBe(0);
    const pin = readPin(consumer, "writer", SLOT)!;
    expect(pin).toMatchObject({ candidate: "studio-v2.md", decidedBy: "agent:writer", basis: "agent" });
    const recited = pinnedBytes(consumer, SLOT);
    expect(recited).not.toBe(original);
    expect(recited).not.toContain(`director:${CELL}@1`);
    expect(recited.replaceAll(`director:${CELL}@2`, `director:${CELL}@1`)).toBe(original);
    const check = await runCli(["migrate", "director-refs", "--check", "--root", root], root);
    expect(check.exitCode, check.message).toBe(0);
    const write = await runCli(["write", "--check", "--root", root, "--json"], root);
    expect(write.message).not.toContain(`director-link-stale (${SLOT})`);
  }, 120_000);

  it("refuses a slot whose cited Direction changed, and writes nothing for it", async () => {
    const root = flatConsumer(["director", "writer"]);
    const consumer = join(root, "clossys");
    const v1 = readFileSync(join(consumer, "agents", "director", CELL, "candidates", "studio-agent-naming-v1.md"), "utf8");
    const changed = v1.replace("## Direction\n- Model:", "## Direction\n- Model: Re-stated.");
    expect(directionSection(changed)).not.toBe(directionSection(v1));
    writeCandidate(consumer, "director", CELL, "studio-agent-naming", changed);
    const v3 = readdirSync(join(consumer, "agents", "director", CELL, "candidates")).find(name => name === "studio-agent-naming-v3.md");
    expect(v3).toBeDefined();
    expect((await runCli(["pick", `director/${CELL}`, "studio-agent-naming-v3", "--by", "agent:director", "--root", root], root)).exitCode).toBe(0);
    const plan = await planDirectorRefs(consumer);
    expect(plan.bumps.map(bump => bump.slot)).not.toContain(SLOT);
    expect(plan.refusals).toContainEqual(expect.objectContaining({ slot: SLOT, cell: CELL, from: 1, to: 3, reason: expect.stringContaining("Direction changed") }));
    const before = readdirSync(writerDir(consumer, SLOT)).sort();
    const result = await runCli(["migrate", "director-refs", "--root", root], root);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain(`refused writer/${SLOT}`);
    expect(readdirSync(writerDir(consumer, SLOT)).sort()).toEqual(before);
    expect(readPin(consumer, "writer", SLOT)!.candidate).toBe("studio-v1.md");
  }, 120_000);
});
