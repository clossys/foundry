import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flatConsumer } from "../cli/__fixtures__/flat-consumer.js";
import { runCli } from "../cli/main.js";
import { readPin } from "../records/slots.js";
import { writeCandidate, writeRecite } from "../records/slot-write.js";
import { staleCitations } from "../records/stale-citations.js";
import { contextOf, openItems } from "../pipeline/chain.js";
import { STEPS } from "../pipeline/steps/index.js";
import { meaningHash } from "./recite.js";

const candidatesStep = STEPS.find(step => step.id === "writer.candidates")!;

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

  it("refuses a moved ref whose Direction changed: a reason string proves nothing", async () => {
    const { root, consumer } = await bumped(bytes => bytes.replace("## Direction\n- Model:", "## Direction\n- Model: Re-stated."));
    const before = readFileSync(join(consumer, "agents", "writer", SLOT, "pin.json"), "utf8");
    const refused = await runCli(["migrate", "recite", `writer/${SLOT}`, "--by", "agent:writer", "--root", root], root);
    expect(refused.exitCode).toBe(1);
    expect(refused.message).toContain("Direction changed");
    expect(readFileSync(join(consumer, "agents", "writer", SLOT, "pin.json"), "utf8")).toBe(before);
    const reasoned = await runCli(["migrate", "recite", `writer/${SLOT}`, "--by", "agent:writer", "--reason", "owner words: ledger 1", "--root", root], root);
    expect(reasoned.exitCode).toBe(2);
    expect(readFileSync(join(consumer, "agents", "writer", SLOT, "pin.json"), "utf8")).toBe(before);
  }, 120_000);

  it("--cascade (the runner's recite step) recites an unchanged Direction with its hash, and opens writer.candidates only for a changed one", async () => {
    const same = await bumped(unchanged);
    const before = readPin(same.consumer, "writer", SLOT)!;
    const ran = await runCli(["migrate", "recite", "--cascade", "--root", same.root], same.root);
    expect(ran.exitCode, ran.message).toBe(0);
    expect(ran.message).toContain(`recited writer/${SLOT}`);
    const pin = readPin(same.consumer, "writer", SLOT)!;
    const director = readPin(same.consumer, "director", CELL)!;
    const directorBytes = readFileSync(join(candidates(same.consumer, "director", CELL), director.candidate), "utf8");
    expect(pin).toMatchObject({ candidate: before.candidate, decidedBy: before.decidedBy, basis: before.basis, at: before.at });
    expect(pin.recited).toMatchObject({ by: "agent:producer", cites: expect.objectContaining({ [`director:${CELL}`]: same.to }), proof: expect.objectContaining({ [`director:${CELL}`]: meaningHash("director", directorBytes) }) });
    expect(pin.recited!.reason).toBeUndefined();
    expect(openItems(candidatesStep, contextOf(same.root, STEPS))).not.toContain(`writer/${SLOT}`);
    expect(staleCitations(same.consumer).map(row => `${row.agent}/${row.slot}`)).not.toContain(`writer/${SLOT}`);

    const changed = await bumped(bytes => bytes.replace("## Direction\n- Model:", "## Direction\n- Model: Re-stated."));
    const held = readFileSync(join(changed.consumer, "agents", "writer", SLOT, "pin.json"), "utf8");
    const cascade = await runCli(["migrate", "recite", "--cascade", "--root", changed.root], changed.root);
    expect(cascade.exitCode, cascade.message).toBe(0);
    expect(cascade.message).toMatch(new RegExp(`changed writer/${SLOT.replace(".", "\\.")}: meaning changed for director:${CELL.replaceAll(".", "\\.")}@\\d+ -> @\\d+ \\(Direction changed\\)`));
    expect(readFileSync(join(changed.consumer, "agents", "writer", SLOT, "pin.json"), "utf8")).toBe(held);
    expect(openItems(candidatesStep, contextOf(changed.root, STEPS))).toContain(`writer/${SLOT}`);
    // Once the Writer drafts a newer candidate the slot waits on its pick, not its candidates.
    const stem = before.candidate.replace(/-v\d+\.md$/, "");
    writeCandidate(changed.consumer, "writer", SLOT, stem, readFileSync(join(candidates(changed.consumer, "writer", SLOT), before.candidate), "utf8"));
    const context = contextOf(changed.root, STEPS);
    expect(openItems(candidatesStep, context)).not.toContain(`writer/${SLOT}`);
    expect(openItems(STEPS.find(step => step.id === "pick.writer")!, { ...context, seats: { ...context.seats, "pick.writer": { ...context.seats["pick.writer"]!, llm: "claude-opus-5-5" } } } as typeof context)).toContain(`writer/${SLOT}`);
  }, 240_000);

  it("--cascade measures a re-pin from the version last recited, not the version the record's text names", async () => {
    // The Writer text cites an older version; the Director then moved to @to with a different Direction, and the record was
    // recited at @to (its proof is @to's meaning). A later re-pin is compared with @to, never with @from.
    const { root, consumer, to } = await bumped(bytes => bytes.replace("## Direction\n- Model:", "## Direction\n- Model: Re-stated."));
    const key = `director:${CELL}`;
    const pinned = readPin(consumer, "director", CELL)!;
    const atTo = readFileSync(join(candidates(consumer, "director", CELL), pinned.candidate), "utf8");
    writeRecite(consumer, "writer", SLOT, { recited: { by: "agent:writer", at: new Date().toISOString(), cites: { [key]: to }, proof: { [key]: meaningHash("director", atTo) } } });
    const repin = async (edit: (bytes: string) => string) => {
      const written = writeCandidate(consumer, "director", CELL, pinned.candidate.replace(/-v\d+\.md$/, ""), edit(atTo));
      const pin = await runCli(["pin", `director/${CELL}`, written.name, "--by", "owner:fixture", "--basis", "picked", "--root", root], root);
      expect(pin.exitCode, pin.message).toBe(0);
      return Number(/-v(\d+)\.md$/.exec(written.name)![1]);
    };
    const text = readFileSync(join(candidates(consumer, "writer", SLOT), readPin(consumer, "writer", SLOT)!.candidate), "utf8");
    expect(text).toContain(`${key}@`);
    expect(text).not.toContain(`${key}@${to}`);

    const same = await repin(unchanged);
    const ran = await runCli(["migrate", "recite", "--cascade", "--root", root], root);
    expect(ran.exitCode, ran.message).toBe(0);
    expect(ran.message).toContain(`recited writer/${SLOT}`);
    expect(ran.message).not.toContain(`changed writer/${SLOT}`);
    expect(readPin(consumer, "writer", SLOT)!.recited?.cites[key]).toBe(same);
    expect(staleCitations(consumer).map(row => `${row.agent}/${row.slot}`)).not.toContain(`writer/${SLOT}`);

    const held = readFileSync(join(consumer, "agents", "writer", SLOT, "pin.json"), "utf8");
    await repin(bytes => bytes.replace("## Direction\n- Model:", "## Direction\n- Model: Re-stated again."));
    const moved = await runCli(["migrate", "recite", "--cascade", "--root", root], root);
    expect(moved.exitCode, moved.message).toBe(0);
    expect(moved.message).toContain(`changed writer/${SLOT}: meaning changed for ${key}@${same} -> @`);
    expect(readFileSync(join(consumer, "agents", "writer", SLOT, "pin.json"), "utf8")).toBe(held);
    expect(staleCitations(consumer).map(row => `${row.agent}/${row.slot}`)).toContain(`writer/${SLOT}`);
  }, 240_000);

  it("--cascade proves an unversioned slot.json input against the pin in force when the citer was pinned (git history)", async () => {
    const VOICE = "identity.verbal.voice";
    const root = flatConsumer(["director", "designer"]);
    const consumer = join(root, "clossys");
    const git = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.email=t@example.invalid", "-c", "user.name=t", ...args], { encoding: "utf8" });
    const citer = "sections.chat";
    // The citer as pinned after the Director cell's pin and never recited: only git history says what it cited.
    const citerPin = join(consumer, "agents", "designer", citer, "pin.json");
    const { recited: _recited, ...pinned } = JSON.parse(readFileSync(citerPin, "utf8"));
    const inputs = (JSON.parse(readFileSync(join(consumer, "agents", "designer", citer, "slot.json"), "utf8")) as { inputs: string[] }).inputs;
    const latest = Math.max(...inputs.flatMap(input => ["director", "designer"].map(agent => join(consumer, "agents", agent, input, "pin.json")).filter(file => existsSync(file))).map(file => JSON.parse(readFileSync(file, "utf8")) as { at: string }).map(pin => Date.parse(pin!.at)));
    writeFileSync(citerPin, `${JSON.stringify({ ...pinned, at: new Date(latest + 60_000).toISOString() }, null, 2)}\n`);
    git("init", "-q"); git("add", "-A"); git("commit", "-qm", "fixture");
    const name = readPin(consumer, "director", VOICE)!.candidate;
    const repick = async (edit: (bytes: string) => string) => {
      const written = writeCandidate(consumer, "director", VOICE, name.replace(/-v\d+\.md$/, ""), edit(readFileSync(join(candidates(consumer, "director", VOICE), name), "utf8")));
      const pin = await runCli(["pin", `director/${VOICE}`, written.name, "--by", "owner:fixture", "--basis", "picked", "--root", root], root);
      expect(pin.exitCode, pin.message).toBe(0);
    };
    await repick(unchanged);
    const ran = await runCli(["migrate", "recite", "--cascade", "--agent", "designer", "--root", root], root);
    expect(ran.exitCode, ran.message).toBe(0);
    expect(readPin(consumer, "designer", citer)!.recited?.proof?.[`director:${VOICE}`], ran.message.split("\n").filter(line => line.includes(citer) || line.startsWith("migrate")).join("\n")).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(staleCitations(consumer).filter(row => row.agent === "designer")).toEqual([]);
    git("add", "-A"); git("commit", "-qm", "recited");
    await repick(bytes => bytes.replace(/(## Direction\n- [^\n]*)/, "$1 Re-stated."));
    const moved = await runCli(["migrate", "recite", "--cascade", "--agent", "designer", "--root", root], root);
    expect(moved.exitCode, moved.message).toBe(0);
    expect(moved.message).toContain(`changed designer/${citer}: meaning changed for director:${VOICE}`);
    expect(staleCitations(consumer).map(row => `${row.agent}/${row.slot}`)).toContain(`designer/${citer}`);
  }, 240_000);

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
