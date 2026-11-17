/**
 * The CHOOSE gate of `clossys pin` (foundry-build-0048 U3), run for real on a temp copy of
 * `test-fixtures/consumer` (copied as is; the fixture stays byte-identical): a candidate that came in
 * through the candidates write (a ledger submit at its bytes) and passes certification is pinned and
 * the pin cites the ranked scorecard; a hand-placed, edited or uncertified candidate is refused.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { danglingReason } from "../check/refs-dangling.js";
import { runPinCli } from "../cli/pin.js";
import { writeCandidate } from "../records/slot-write.js";
import { verifyCheck } from "../loop/runner.js";
import { pinGate, SCORECARD_REF_TO, SCORECARD_SCHEMA } from "./pin-gate.js";

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const SLOT = "sections.hero.copy";
const AT = "2026-11-17T12:00:00Z";
const QUEUE_ID = "20261117T1200Z-hero-copy";
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const copy = (heading: string, action: string) => `---
slot: "${SLOT}"
locales: ["en"]
reason: "realises director:advantage.proposition.promise for the hero"
source: {"kind":"derived","ref":["director:identity.verbal.voice","director:advantage.proposition.promise","director:identity.naming.name"]}
---

## en
### header.heading
<!-- {"id":"header.heading","bindings":[]} -->
${heading}
### actions.primary.label
<!-- {"id":"actions.primary.label","bindings":[]} -->
${action}
`;
/** The candidate with its family tag (`vary: {"tone": <value>}` in its frontmatter). */
const toned = (text: string, tone: string) => text.replace(/^---\n/, `---\nvary: {"tone":"${tone}"}\n`);
const GOOD = copy("Ship your site this week", "Get started");
const BAD = copy("The seamless, magical, best-in-class solution that effortlessly transforms absolutely everything you do", "Click here right now to start your totally free trial today");

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pin-gate-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  const consumer = join(root, "clossys");
  const dir = join(consumer, "agents", "writer", SLOT);
  return {
    root, consumer, dir,
    submit: (text: string) => writeCandidate(consumer, "writer", SLOT, "copy", text, { at: AT, provenance: { by: "agent:writer", model: "claude-opus-5-5", tier: "high" } }),
    queueEntry(): void {
      const file = join(consumer, "agents", "producer", "queue.pick", "entries", `${QUEUE_ID}.json`);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, JSON.stringify({ id: QUEUE_ID, kind: "queue-entry" }));
    },
    pin: (candidate: string) => runPinCli([`writer/${SLOT}#copy`, candidate, "--by", `owner:queue.pick#${QUEUE_ID}`, "--at", AT, "--root", root], root, false),
  };
}

describe("the CHOOSE gate: clossys pin on a slot/2 slot", () => {
  it("pins a submitted, certified candidate with the skill's owner form and cites the ranked scorecard", async () => {
    const w = world();
    const good = w.submit(GOOD);
    const bad = w.submit(BAD);
    w.queueEntry();
    const result = await w.pin(good.name);
    expect(result.message).toMatch(/pinned copy-v1\.md/);
    expect(result.exitCode).toBe(0);
    const pin = JSON.parse(readFileSync(join(w.dir, "pin.json"), "utf8"));
    const scorecardFile = join(w.root, ".clossys", "checks", "writer", SLOT, "scorecard.json");
    const bytes = readFileSync(scorecardFile, "utf8");
    expect(pin).toMatchObject({ schema: "clossys.pin-map/1", createdBy: { actor: "code", cli: "clossys pin" } });
    expect(pin.records.copy).toMatchObject({ candidate: good.name, sha256: good.sha256, basis: "picked", decidedBy: `owner:queue.pick#${QUEUE_ID}` });
    expect(pin.refs).toEqual(expect.arrayContaining([
      { to: "producer/queue.pick", record: QUEUE_ID, rel: "answers" },
      { to: SCORECARD_REF_TO, rel: "cites", record: `writer/${SLOT}`, sha256: createHash("sha256").update(bytes).digest("hex") },
    ]));
    // The scorecard ref resolves (refs.dangling), and dangles once the scorecard is gone.
    const ref = { to: SCORECARD_REF_TO, rel: "cites" as const, record: `writer/${SLOT}` };
    expect(danglingReason(w.root, ref)).toBeUndefined();
    rmSync(scorecardFile);
    expect(danglingReason(w.root, ref)).toMatch(/no such check record/);
    writeFileSync(scorecardFile, bytes);
    // The cite carries the scorecard's sha256: a later write over the scorecard (a re-pin) leaves this pin's cite dangling.
    const cited = pin.refs.find((item: { to: string }) => item.to === SCORECARD_REF_TO);
    expect(danglingReason(w.root, cited)).toBeUndefined();
    writeFileSync(scorecardFile, bytes.replace(`"pick": "${good.name}"`, `"pick": "${bad.name}"`));
    expect(danglingReason(w.root, cited)).toMatch(/the check record's sha256 is [0-9a-f]{12}, not the cited [0-9a-f]{12}/);
    writeFileSync(scorecardFile, bytes);
    const scorecard = JSON.parse(bytes);
    expect(scorecard).toMatchObject({ schema: SCORECARD_SCHEMA, slot: `writer/${SLOT}`, pick: good.name });
    expect(scorecard.candidates.map((row: { candidate: string; rank: number; certified: boolean; submitted: boolean }) => [row.rank, row.candidate, row.certified, row.submitted]))
      .toEqual([[1, good.name, true, true], [2, bad.name, false, true]]);
  });

  it("refuses a submitted candidate with no passing verdict, naming the reason", async () => {
    const w = world();
    w.submit(GOOD);
    const bad = w.submit(BAD);
    w.queueEntry();
    const result = await w.pin(bad.name);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/copy-v2\.md has no passing verdict: \[limit\] en header\.heading is \d+ characters, past the copy contract's maxLength/);
    expect(existsSync(join(w.dir, "pin.json"))).toBe(false);
  });

  it("refuses a candidate placed by hand (no submit record) and one edited after its submit", async () => {
    const w = world();
    const good = w.submit(GOOD);
    writeFileSync(join(w.dir, "candidates", "copy-v2.md"), GOOD);
    w.queueEntry();
    const placed = await w.pin("copy-v2.md");
    expect(placed.exitCode).toBe(1);
    expect(placed.message).toMatch(/copy-v2\.md has no submit record .*placed by hand is never pinned/);
    writeFileSync(join(w.dir, "candidates", good.name), GOOD.replace("this week", "today"));
    const edited = await w.pin(good.name);
    expect(edited.exitCode).toBe(1);
    expect(edited.message).toMatch(/copy-v1\.md changed since its submit/);
    expect(existsSync(join(w.dir, "pin.json"))).toBe(false);
  });

  it("judges every candidate without writing: the gate itself is read-only", () => {
    const w = world();
    const good = w.submit(GOOD);
    const gate = pinGate(w.root, w.consumer, "writer", SLOT, good.name, AT);
    expect(gate.refusals).toEqual([]);
    expect(existsSync(join(w.root, ".clossys", "checks", "writer", SLOT, "scorecard.json"))).toBe(false);
  });
});

describe("loop.create's exit, candidates.certified (computed by clossys run, never taken from a step's exit)", () => {
  const ctx = (root: string) => ({ root, state: { subject: { agent: "writer", slotId: SLOT }, startedAt: AT, vars: {} } as never });
  it("fails while the slot holds fewer certified tones than its family owes, naming why, and passes once all three are", () => {
    const w = world();
    // The exit judges with check:slot-options' own function (judgeSlotOptions), over the submitted, certified candidates only.
    const none = verifyCheck(ctx(w.root), "candidates.certified");
    expect(none).toEqual({ ok: false, why: `candidates.certified: writer/${SLOT}: [options-short] holds 0 distinct option(s) on tone, needs 3; run clossys options writer/${SLOT} --more; 0 submitted, certified candidate(s)` });
    w.submit(BAD);
    const bad = verifyCheck(ctx(w.root), "candidates.certified");
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.why).toMatch(/\[options-short\] holds 0 distinct .*not passing: copy-v1\.md \(\[limit\] en header\.heading is \d+ characters/);
    // A hand-placed copy of the good text is no submit.
    writeFileSync(join(w.dir, "candidates", "copy-v2.md"), toned(GOOD, "plain"));
    const placed = verifyCheck(ctx(w.root), "candidates.certified");
    expect(!placed.ok && placed.why).toMatch(/copy-v2\.md \(no matching submit record\)/);
    rmSync(join(w.dir, "candidates", "copy-v2.md"));
    // One certified tone, then a second candidate on the same tone: still one distinct value of three.
    w.submit(toned(GOOD, "plain"));
    expect(verifyCheck(ctx(w.root), "candidates.certified")).toMatchObject({ ok: false, why: expect.stringContaining("[options-short] holds 1 distinct option(s) on tone, needs 3") });
    // A second candidate on the same tone is check:slot-options' vary-duplicate finding, so the exit fails on it too.
    const twin = w.submit(toned(copy("Ship your site in days", "Get started"), "plain"));
    expect(verifyCheck(ctx(w.root), "candidates.certified")).toMatchObject({ ok: false, why: expect.stringMatching(new RegExp(`\\[options-vary-duplicate\\] ${twin.name.replace(".", "\\.")} and copy-v2\\.md both offer tone plain`)) });
    rmSync(join(w.dir, "candidates", twin.name));
    w.submit(toned(copy("Launch the site you meant to build", "Start building"), "bold"));
    w.submit(toned(copy("Your site, ready when you are", "Come on in"), "warm"));
    expect(verifyCheck(ctx(w.root), "candidates.certified")).toEqual({ ok: true });
  });
});
