import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flatConsumer } from "../cli/__fixtures__/flat-consumer.js";
import { runCli } from "../cli/main.js";
import { readPin } from "../records/slots.js";
import { writeCandidate } from "../records/slot-write.js";

const CELL = "identity.naming.architecture";
const SLOT = "strings.navigation";
const candidates = (consumer: string, agent: string, slot: string) => join(consumer, "agents", agent, slot, "candidates");

/** The fixture with the Director cell picked at its next version (bytes from `edit`), as a Director re-draft would. */
async function bumped(edit: (bytes: string) => string) {
  const root = flatConsumer(["director", "writer"]);
  const consumer = join(root, "clossys");
  const name = readPin(consumer, "director", CELL)!.candidate;
  const from = Number(/-v(\d+)\.md$/.exec(name)![1]);
  const written = writeCandidate(consumer, "director", CELL, name.replace(/-v\d+\.md$/, ""), edit(readFileSync(join(candidates(consumer, "director", CELL), name), "utf8")));
  const pick = await runCli(["pick", `director/${CELL}`, written.name, "--by", "agent:director", "--root", root], root);
  expect(pick.exitCode, pick.message).toBe(0);
  return { root, consumer, from, to: from + 1 };
}
const unchanged = (bytes: string) => bytes.replace(/^note: "/m, 'note: "Re-cited fixture. ');
const writeCheck = async (root: string) => (await runCli(["write", "--check", "--root", root, "--json"], root)).message;

describe("clossys migrate recite", () => {
  it("moves the citation onto the pin in place: same candidate, basis and decider, no new version, write --check sees it", async () => {
    const { root, consumer, from, to } = await bumped(unchanged);
    const before = readPin(consumer, "writer", SLOT)!;
    const files = readdirSync(candidates(consumer, "writer", SLOT)).sort();
    expect(await writeCheck(root)).toContain(`director-link-stale (${SLOT})`);
    const result = await runCli(["migrate", "recite", `writer/${SLOT}`, "--by", "agent:writer", "--root", root], root);
    expect(result.exitCode, result.message).toBe(0);
    const pin = readPin(consumer, "writer", SLOT)!;
    expect(pin).toMatchObject({ candidate: before.candidate, sha256: before.sha256, decidedBy: before.decidedBy, basis: before.basis, at: before.at });
    expect(pin.recited).toMatchObject({ by: "agent:writer", cites: expect.objectContaining({ [`director:${CELL}`]: to }) });
    expect(to).toBeGreaterThan(from);
    expect(readdirSync(candidates(consumer, "writer", SLOT)).sort()).toEqual(files);
    expect(await writeCheck(root)).not.toContain(`director-link-stale (${SLOT})`);
    const again = await runCli(["migrate", "recite", `writer/${SLOT}`, "--by", "agent:writer", "--check", "--root", root], root);
    expect(again.exitCode, again.message).toBe(0);
    expect(again.message).toContain("1 current");
  }, 120_000);

  it("refuses a moved ref whose Direction changed unless --reason says the meaning holds", async () => {
    const { root, consumer } = await bumped(bytes => bytes.replace("## Direction\n- Model:", "## Direction\n- Model: Re-stated."));
    const before = readFileSync(join(consumer, "agents", "writer", SLOT, "pin.json"), "utf8");
    const refused = await runCli(["migrate", "recite", `writer/${SLOT}`, "--by", "agent:writer", "--root", root], root);
    expect(refused.exitCode).toBe(1);
    expect(refused.message).toContain("Direction changed");
    expect(readFileSync(join(consumer, "agents", "writer", SLOT, "pin.json"), "utf8")).toBe(before);
    const reasoned = await runCli(["migrate", "recite", `writer/${SLOT}`, "--by", "agent:writer", "--reason", "owner words: ledger 1", "--root", root], root);
    expect(reasoned.exitCode, reasoned.message).toBe(0);
    expect(readPin(consumer, "writer", SLOT)!.recited?.reason).toBe("owner words: ledger 1");
  }, 120_000);

  it("--restore puts back the owner pin a planner re-cite replaced, and keeps a re-pin that changed copy", async () => {
    const { root, consumer, from, to } = await bumped(unchanged);
    const git = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.email=t@example.invalid", "-c", "user.name=t", ...args], { encoding: "utf8" });
    const owner = readPin(consumer, "writer", SLOT)!;
    const pinOwner = await runCli(["pin", `writer/${SLOT}`, owner.candidate, "--by", "owner:fixture", "--basis", "picked", "--root", root], root);
    expect(pinOwner.exitCode, pinOwner.message).toBe(0);
    const ownerPin = readPin(consumer, "writer", SLOT)!;
    git("init", "-q"); git("add", "-A"); git("commit", "-qm", "owner pin");
    const bytes = readFileSync(join(candidates(consumer, "writer", SLOT), owner.candidate), "utf8");
    const cascade = (text: string, stem: string) => writeCandidate(consumer, "writer", SLOT, stem, text.replaceAll(`director:${CELL}@${from}`, `director:${CELL}@${to}`)).name;
    const stem = owner.candidate.replace(/-v\d+\.md$/, "");
    const recut = cascade(bytes, stem);
    const repin = await runCli(["pin", `writer/${SLOT}`, recut, "--by", "planner:CASCADE", "--root", root], root);
    expect(repin.exitCode, repin.message).toBe(0);
    const restored = await runCli(["migrate", "recite", `writer/${SLOT}`, "--by", "agent:writer", "--restore", "HEAD", "--root", root], root);
    expect(restored.exitCode, restored.message).toBe(0);
    const pin = readPin(consumer, "writer", SLOT)!;
    expect(pin).toMatchObject({ candidate: ownerPin.candidate, decidedBy: "owner:fixture", basis: "picked", at: ownerPin.at });
    expect(pin.recited?.cites[`director:${CELL}`]).toBe(to);
    expect(await writeCheck(root)).not.toContain(`director-link-stale (${SLOT})`);

    // A re-pin whose candidate is more than a re-cite (copy changed) is kept as it is.
    const edited = writeCandidate(consumer, "writer", SLOT, stem, readFileSync(join(candidates(consumer, "writer", SLOT), recut), "utf8").replace(/(<!-- \{.*\} -->\n)(.+)/, "$1$2 Changed.")).name;
    expect((await runCli(["pin", `writer/${SLOT}`, edited, "--by", "planner:CASCADE", "--root", root], root)).exitCode).toBe(0);
    const kept = await runCli(["migrate", "recite", `writer/${SLOT}`, "--by", "agent:writer", "--restore", "HEAD", "--root", root], root);
    expect(kept.exitCode).toBe(1);
    expect(kept.message).toContain("more than a re-cite");
    expect(readPin(consumer, "writer", SLOT)!.candidate).toBe(edited);
  }, 120_000);
});
