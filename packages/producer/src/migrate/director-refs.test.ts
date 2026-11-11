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

const directorDir = (consumer: string) => join(consumer, "agents", "director", CELL, "candidates");
/** The Director cell's pinned candidate in a fixture: its name, version and bytes. */
function pinnedDirector(consumer: string) {
  const name = readPin(consumer, "director", CELL)!.candidate;
  return { name, version: Number(/-v(\d+)\.md$/.exec(name)![1]), bytes: readFileSync(join(directorDir(consumer), name), "utf8") };
}
/** Write the cell's next version (bytes from `edit`) and pick it, as a Director re-draft would. */
async function nextDirector(root: string, edit: (bytes: string) => string) {
  const consumer = join(root, "clossys");
  const current = pinnedDirector(consumer);
  const written = writeCandidate(consumer, "director", CELL, current.name.replace(/-v\d+\.md$/, ""), edit(current.bytes));
  const pick = await runCli(["pick", `director/${CELL}`, written.name, "--by", "agent:director", "--root", root], root);
  expect(pick.exitCode, pick.message).toBe(0);
  return { from: current.version, to: current.version + 1 };
}
/** A copy of the repository consumer with the Director cell picked at a new version whose Direction is unchanged. */
async function bumpedConsumer() {
  const root = flatConsumer(["director", "writer"]);
  const consumer = join(root, "clossys");
  const versions = await nextDirector(root, bytes => bytes.replace(/^note: "/m, 'note: "Re-cited fixture. '));
  return { root, consumer, ...versions };
}
const writerDir = (consumer: string, slot: string) => join(consumer, "agents", "writer", slot, "candidates");
const pinnedBytes = (consumer: string, slot: string) => readFileSync(join(writerDir(consumer, slot), readPin(consumer, "writer", slot)!.candidate), "utf8");

describe("clossys migrate director-refs", () => {
  it("--check exits 0 when no Writer citation is older than its Director pin, and 1 when one is", async () => {
    const root = flatConsumer(["director", "writer"]);
    const clean = await runCli(["migrate", "director-refs", "--check", "--root", root], root);
    expect(clean.exitCode, clean.message).toBe(0);
    const { root: bumped, consumer, from, to } = await bumpedConsumer();
    const before = readdirSync(writerDir(consumer, SLOT)).sort();
    const pending = await runCli(["migrate", "director-refs", "--check", "--root", bumped], bumped);
    expect(pending.exitCode).toBe(1);
    expect(pending.message).toContain(`writer/${SLOT}: ${readPin(consumer, "writer", SLOT)!.candidate} cites ${CELL} @${from} -> @${to}`);
    expect(readdirSync(writerDir(consumer, SLOT)).sort()).toEqual(before);
  }, 120_000);

  it("re-cites at the pinned version: only the refs change, the copy is identical, and the agent pick lands", async () => {
    const { root, consumer, from, to } = await bumpedConsumer();
    const original = pinnedBytes(consumer, SLOT);
    const before = readPin(consumer, "writer", SLOT)!.candidate;
    const result = await runCli(["migrate", "director-refs", "--by", "agent:writer", "--root", root], root);
    expect(result.exitCode, result.message).toBe(0);
    const pin = readPin(consumer, "writer", SLOT)!;
    expect(pin).toMatchObject({ decidedBy: "agent:writer", basis: "agent" });
    expect(pin.candidate).not.toBe(before);
    const recited = pinnedBytes(consumer, SLOT);
    expect(recited).not.toBe(original);
    expect(recited).not.toContain(`director:${CELL}@${from}`);
    expect(recited.replaceAll(`director:${CELL}@${to}`, `director:${CELL}@${from}`)).toBe(original);
    const check = await runCli(["migrate", "director-refs", "--check", "--root", root], root);
    expect(check.exitCode, check.message).toBe(0);
    const write = await runCli(["write", "--check", "--root", root, "--json"], root);
    expect(write.message).not.toContain(`director-link-stale (${SLOT})`);
  }, 120_000);

  it("refuses a slot whose cited Direction changed, and writes nothing for it", async () => {
    const root = flatConsumer(["director", "writer"]);
    const consumer = join(root, "clossys");
    const original = pinnedDirector(consumer).bytes;
    const changed = original.replace("## Direction\n- Model:", "## Direction\n- Model: Re-stated.");
    expect(directionSection(changed)).not.toBe(directionSection(original));
    const before = readPin(consumer, "writer", SLOT)!.candidate;
    const { from, to } = await nextDirector(root, () => changed);
    const plan = await planDirectorRefs(consumer);
    expect(plan.bumps.map(bump => bump.slot)).not.toContain(SLOT);
    expect(plan.refusals).toContainEqual(expect.objectContaining({ slot: SLOT, cell: CELL, from, to, reason: expect.stringContaining("Direction changed") }));
    const files = readdirSync(writerDir(consumer, SLOT)).sort();
    const result = await runCli(["migrate", "director-refs", "--root", root], root);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain(`refused writer/${SLOT}`);
    expect(readdirSync(writerDir(consumer, SLOT)).sort()).toEqual(files);
    expect(readPin(consumer, "writer", SLOT)!.candidate).toBe(before);
  }, 120_000);
});
