/**
 * R05.2 CHOOSE (foundry-build-0048), run for real on temp copies of `test-fixtures/consumer` (copied as is; the fixture
 * stays byte-identical):
 * - Director's dogfood finding: `clossys pin` refuses a Director brief placed by hand and one submitted that fails its
 *   slot's contract and standard, through the one certifier the pin gate uses (pin-gate.ts certify);
 * - an owner confirmation never blesses an agent pick written by hand, or one whose candidate fails its contract or
 *   was placed by hand: the confirm verb's constitution guard refuses it (already so at base; pinned here);
 * - Publisher's dogfood finding: a pin.json written by hand (no ledger event at its bytes, the U38 binding) is a
 *   `clossys check` failure, and a pin written through `clossys pin` is not.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 120_000 });
import { ownerEntry } from "../cli/__fixtures__/owner-entry.js";
import { pinUpstream } from "../cli/__fixtures__/upstream.js";
import { runCli } from "../cli/main.js";
import { runPinCli } from "../cli/pin.js";
import { runSlotResolve } from "../check/slot-resolve.js";
import { answerRequest, raiseWork } from "../records/request.js";
import { writeCandidate } from "../records/slot-write.js";
import { jsonBytes } from "../records/slot-model/index.js";

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const AT = "2026-11-19T12:00:00Z";
const LATER = "2026-11-19T13:00:00Z";
const COPY_SLOT = "sections.hero.copy";
const BRIEF_SLOT = "identity.naming.name";
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const copy = (heading: string, action: string) => `---
slot: "${COPY_SLOT}"
locales: ["en"]
reason: "realises director:advantage.proposition.promise for the hero"
source: {"kind":"derived","ref":["director:identity.verbal.voice","director:advantage.proposition.promise","director:identity.naming.name"]}
provenance: {"voice":"director:identity.verbal.voice"}
---

## en
### header.heading
<!-- {"id":"header.heading","bindings":[]} -->
${heading}
### actions.primary.label
<!-- {"id":"actions.primary.label","bindings":[]} -->
${action}
`;
const GOOD = copy("Ship your site this week", "Get started");
const BAD = copy("The seamless, magical, best-in-class solution that effortlessly transforms absolutely everything you do", "Click here right now to start your totally free trial today");
/** A schema-valid Director brief that fails its slot's contract and standard: no derived source, a placeholder direction. */
const BAD_BRIEF = `---\nslot: "${BRIEF_SLOT}"\nsource: {"kind":"original","ref":[]}\nfeeds: []\nfunctions: []\n---\n## Direction\n- Name: TBD\n\n## Because\n- tbd\n\n## Watch\n- tbd\n`;

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "choose-gate-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  const consumer = join(root, "clossys");
  const provenance = (agent: string) => ({ by: `agent:${agent}`, model: "claude-opus-5-5", tier: "high" as const });
  return {
    root, consumer,
    dir: (agent: string, slot: string) => join(consumer, "agents", agent, slot),
    submit: (agent: "writer" | "director", slot: string, name: string, text: string) => writeCandidate(consumer, agent, slot, name, text, { at: AT, provenance: provenance(agent) }),
  };
}

/** The slot-resolve findings `clossys check` reports for one slot. */
async function slotFindings(consumer: string, agent: string, slot: string) {
  const report = await runSlotResolve(consumer);
  return report.rows.find(row => row.agent === agent && row.slot === slot)?.findings ?? [];
}

describe("R05.2 CHOOSE: clossys pin on a Director brief (Director's dogfood finding)", () => {
  it("refuses a brief placed by hand and a submitted brief that fails its contract and standard; no pin is written", async () => {
    const w = world();
    const dir = w.dir("director", BRIEF_SLOT);
    const bad = w.submit("director", BRIEF_SLOT, "name", BAD_BRIEF);
    // A copy of the submitted bytes under a new name: placed by hand, so it has no submit record.
    writeFileSync(join(dir, "candidates", "name-v9.md"), readFileSync(join(dir, "candidates", bad.name)));
    const pin = (candidate: string) => runPinCli([`director/${BRIEF_SLOT}`, candidate, "--by", "planner", "--at", AT, "--root", w.root], w.root);
    const placed = await pin("name-v9.md");
    expect(placed.exitCode, placed.message).toBe(1);
    expect(placed.message).toMatch(/name-v9\.md has no submit record .*placed by hand is never pinned/);
    const failing = await pin(bad.name);
    expect(failing.exitCode, failing.message).toBe(1);
    expect(failing.message).toMatch(new RegExp(`${bad.name.replace(".", "\\.")} has no passing verdict: \\[`));
    expect(existsSync(join(dir, "pin.json"))).toBe(false);
  });
});

describe("R05.2 CHOOSE: an owner confirmation never launders a hand-written pick (the confirm verb's guard)", () => {
  /** An agent pick written by hand as a Writer pin-map record (basis agent), then the owner's typed answer to confirm it. */
  async function confirmHandPick(text: string, submitted: boolean) {
    const w = world();
    pinUpstream(w.consumer, "writer", COPY_SLOT, AT);
    const dir = w.dir("writer", COPY_SLOT);
    const candidate = submitted ? w.submit("writer", COPY_SLOT, "copy", text) : (() => {
      const real = w.submit("writer", COPY_SLOT, "copy", GOOD);
      writeFileSync(join(dir, "candidates", "copy-v9.md"), readFileSync(join(dir, "candidates", real.name)));
      return { name: "copy-v9.md", sha256: real.sha256 };
    })();
    const record = { candidate: candidate.name, sha256: candidate.sha256, decidedBy: "agent:writer", basis: "agent", at: AT };
    writeFileSync(join(dir, "pin.json"), jsonBytes({
      schema: "clossys.pin-map/1", id: `writer/${COPY_SLOT}/pin`, agent: "writer", kind: "pin", status: "pinned",
      createdBy: { actor: "code", cli: "clossys pin", version: "1.0.0" }, createdAt: AT, updatedAt: AT, refs: [], records: { copy: record },
    }));
    const before = readFileSync(join(dir, "pin.json"), "utf8");
    const entry = raiseWork(w.consumer, { kind: "change", target: `writer/${COPY_SLOT}`, from: "owner", want: "repin", why: "confirm the hero copy", source: "cli", by: "owner", at: AT }).request;
    const option = entry.options?.find(each => each.then.args[2] === "--confirm");
    const answered = option ? await answerRequest(w.consumer, entry.id, { option: option.id, at: LATER, via: "chat", quote: "Confirm it." }) : undefined;
    const confirms = (JSON.parse(readFileSync(join(dir, "ledger.json"), "utf8")).events as { op: string }[]).filter(event => event.op === "confirm");
    return { w, dir, before, option, answered, confirms, after: readFileSync(join(dir, "pin.json"), "utf8") };
  }

  it("refuses to confirm an agent pick written by hand (no ledger event), and the slot stays a check failure", async () => {
    const run = await confirmHandPick(GOOD, true);
    expect(run.option, "the repin change offers the confirmation").toBeDefined();
    expect(run.answered?.ok, run.answered?.message).toBe(false);
    expect(run.answered?.message).toMatch(/confirm refused: pin refused by the constitution guard: R02\.3 record copy: the slot ledger has no pin, pick or verdict event for this pin/);
    expect(run.confirms).toEqual([]);
    expect(run.after).toBe(run.before);
    // The unconfirmed hand pick pins nothing: `clossys check` still fails the slot.
    expect(await slotFindings(run.w.consumer, "writer", COPY_SLOT)).toContainEqual({ code: "no-pin", message: "No candidate is pinned." });
  });

  it("refuses to confirm a hand-written agent pick of an uncertified candidate, naming the failing verdict", async () => {
    const run = await confirmHandPick(BAD, true);
    expect(run.answered?.ok, run.answered?.message).toBe(false);
    expect(run.answered?.message).toMatch(/confirm refused: .*R05\.1 \[limit,requirement\] en header\.heading is 103 characters/);
    expect(run.confirms).toEqual([]);
    expect(run.after).toBe(run.before);
  });

  it("refuses to confirm a hand-written agent pick of a hand-placed candidate (no submit record)", async () => {
    const run = await confirmHandPick(GOOD, false);
    expect(run.answered?.ok, run.answered?.message).toBe(false);
    expect(run.answered?.message).toMatch(/confirm refused: .*R14\.1 candidate copy-v9\.md has no submit event/);
    expect(run.after).toBe(run.before);
    expect(run.confirms).toEqual([]);
  });
});

describe("R05.2 CHOOSE: clossys check finds a pin written by hand (Publisher's dogfood finding, the U38 binding)", () => {
  it("passes a pin written by clossys pin, and fails one written by hand or edited after its ledger event", async () => {
    const w = world();
    // pinUpstream writes its upstream pins as data, by hand: each is the check's finding.
    const upstream = pinUpstream(w.consumer, "writer", COPY_SLOT, AT);
    expect(upstream.length).toBeGreaterThan(0);
    const good = w.submit("writer", COPY_SLOT, "copy", GOOD);
    const pinned = await runPinCli([`writer/${COPY_SLOT}#copy`, good.name, "--by", ownerEntry(w.consumer, { id: "20261119T1200Z-hero-copy", about: `writer/${COPY_SLOT}`, answer: { candidate: good.name }, at: AT }), "--at", AT, "--root", w.root], w.root);
    expect(pinned.exitCode, pinned.message).toBe(0);
    const report = await runSlotResolve(w.consumer);
    const unledgered = report.findings.filter(finding => finding.rule === "pin-unledgered");
    expect(unledgered.find(finding => finding.path === `writer:${COPY_SLOT}`)).toBeUndefined();
    for (const ref of upstream) {
      const [agent, slot] = ref.split("/");
      expect(unledgered, ref).toContainEqual(expect.objectContaining({ path: `${agent}:${slot}`, message: expect.stringMatching(/^pin\.json has no ledger event that wrote it: a pin is written only through clossys pin/) }));
    }
    expect(report.exitCode).toBe(1);
    // The same pin, touched by hand after clossys pin wrote it (one byte, same JSON): its bytes no longer match the pin event's record.
    const file = join(w.dir("writer", COPY_SLOT), "pin.json");
    writeFileSync(file, `${readFileSync(file, "utf8")}\n`);
    expect(await slotFindings(w.consumer, "writer", COPY_SLOT)).toContainEqual({ code: "pin-unledgered", message: expect.stringMatching(/^pin\.json bytes \([0-9a-f]{12}\) differ from its last ledger event \([0-9a-f]{12}\)/) });
    // `clossys check` itself: the finding is printed and fails the run.
    const check = await runCli(["check", "--root", w.root], w.root);
    expect(check.exitCode).toBe(1);
    expect(check.message).toContain(`writer:${COPY_SLOT} [pin-unledgered] pin.json bytes`);
  });

  it("finds a pin.json written by hand into a slot that never had a pin event", async () => {
    const w = world();
    const dir = w.dir("director", BRIEF_SLOT);
    const bad = w.submit("director", BRIEF_SLOT, "name", BAD_BRIEF);
    writeFileSync(join(dir, "pin.json"), jsonBytes({
      schema: "clossys.pin/2", id: `director/${BRIEF_SLOT}/pin`, agent: "director", kind: "pin", status: "pinned",
      createdBy: { actor: "code", cli: "clossys pin", version: "1.0.0" }, createdAt: AT, updatedAt: AT, refs: [],
      candidate: bad.name, sha256: bad.sha256, decidedBy: "planner:hand", basis: "planner", at: AT,
    }));
    expect(await slotFindings(w.consumer, "director", BRIEF_SLOT)).toContainEqual({ code: "pin-unledgered", message: expect.stringMatching(/^pin\.json has no ledger event that wrote it/) });
  });
});
