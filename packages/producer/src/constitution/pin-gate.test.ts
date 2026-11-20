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
import { resolvePage } from "@clossys/publisher/install";
import { afterAll, describe, expect, it, vi } from "vitest";

// Every decision here runs the constitution guard over the whole fixture consumer (U13 r4: no guard=false), so a
// test takes seconds, not the config's 5 s default budget.
vi.setConfig({ testTimeout: 60_000 });
import { danglingReason } from "../check/refs-dangling.js";
import { ownerEntry } from "../cli/__fixtures__/owner-entry.js";
import { pinUpstream } from "../cli/__fixtures__/upstream.js";
import { runPinCli } from "../cli/pin.js";
import { skillPath } from "../records/ledger.js";
import { appendSlotDocEvent, writeCandidate } from "../records/slot-write.js";
import { buildCandidateHeader, serializeCandidate } from "../records/candidate.js";
import { pinBlocker } from "../records/slots.js";
import { verifyCheck } from "../loop/runner.js";
import { pinGate, SCORECARD_REF_TO, SCORECARD_SCHEMA } from "./pin-gate.js";
import { designerPins } from "../publish/install.js";
import { specimenRoots } from "../publish/publish.js";
import { libraryRecordSource } from "../specimen/library-source.js";

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
  // The pin guard runs (U13 r4, B1): R02.2 needs the copy's upstream pinned, R20.2 the Director slot it cites.
  pinUpstream(consumer, "writer", SLOT, AT);
  return {
    root, consumer, dir,
    submit: (text: string) => writeCandidate(consumer, "writer", SLOT, "copy", text, { at: AT, provenance: { by: "agent:writer", model: "claude-opus-5-5", tier: "high" } }),
    /** The owner's typed queue.pick answer naming this candidate of this slot (U13 r4, B2): what an owner pin cites. */
    answer: (about: string, candidate: string) => ownerEntry(consumer, { id: QUEUE_ID, about, answer: { candidate }, at: AT }),
    pin: (candidate: string) => runPinCli([`writer/${SLOT}#copy`, candidate, "--by", ownerEntry(consumer, { id: QUEUE_ID, about: `writer/${SLOT}`, answer: { candidate }, at: AT }), "--at", AT, "--root", root], root),
  };
}

describe("the CHOOSE gate: clossys pin on a slot/2 slot", () => {
  it("pins a submitted, certified candidate with the skill's owner form and cites the ranked scorecard", async () => {
    const w = world();
    const good = w.submit(GOOD);
    const bad = w.submit(BAD);
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
    const result = await w.pin(bad.name);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/copy-v2\.md has no passing verdict: \[limit\] en header\.heading is \d+ characters, past the copy contract's maxLength/);
    expect(existsSync(join(w.dir, "pin.json"))).toBe(false);
  });

  it("refuses a candidate placed by hand (no submit record) and one edited after its submit", async () => {
    const w = world();
    const good = w.submit(GOOD);
    writeFileSync(join(w.dir, "candidates", "copy-v2.md"), GOOD);
    const placed = await w.pin("copy-v2.md");
    expect(placed.exitCode).toBe(1);
    expect(placed.message).toMatch(/copy-v2\.md has no submit record .*placed by hand is never pinned/);
    writeFileSync(join(w.dir, "candidates", good.name), GOOD.replace("this week", "today"));
    const edited = await w.pin(good.name);
    expect(edited.exitCode).toBe(1);
    expect(edited.message).toMatch(/copy-v1\.md changed since its submit/);
    expect(existsSync(join(w.dir, "pin.json"))).toBe(false);
  });

  // U37: the slot/2 readers (`clossys direct`, `clossys status`) require a clossys.candidate/1 header; the gate takes one.
  /** `text` (int2 copy) as a clossys.candidate/1 file: its front matter `source` moved into the header, the rest kept. */
  const headered = (name: string, text: string, change: (header: Record<string, unknown>) => void = () => {}) => {
    const [, front, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)!;
    const fields = Object.fromEntries(front!.split("\n").map(line => [line.slice(0, line.indexOf(":")), JSON.parse(line.slice(line.indexOf(":") + 1))]));
    const { source, ...rest } = fields;
    const header = buildCandidateHeader({ agent: "writer", slotId: SLOT, name, createdBy: { actor: "agent", agent: "writer", skill: "packages/writer/skills/writer/SKILL.md", skillSha256: "0".repeat(64), model: "claude-opus-5-5", tier: "high" }, createdAt: AT, source }) as unknown as Record<string, unknown>;
    change(header);
    return serializeCandidate(name, header as never, body!, rest);
  };
  /** Place `bytes` as the next candidate with a submit event at its bytes, shaped as the candidates write's own. */
  const submitBytes = (w: ReturnType<typeof world>, name: string, bytes: string) => {
    writeFileSync(join(w.dir, "candidates", name), bytes);
    const file = join(w.dir, "ledger.json");
    const ledger = JSON.parse(readFileSync(file, "utf8"));
    const last = [...ledger.events].reverse().find((event: { op: string }) => event.op === "submit");
    ledger.events.push({ ...last, name, sha256: createHash("sha256").update(bytes).digest("hex") });
    writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
  };

  it("pins a clossys.candidate/1 candidate: the header judged by its schema, the body by the copy rules, and the slot/2 reader takes the pin", async () => {
    const w = world();
    w.submit(BAD);
    submitBytes(w, "copy-v2.md", headered("copy-v2.md", GOOD));
    const result = await w.pin("copy-v2.md");
    expect(result.message).toMatch(/pinned copy-v2\.md/);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(w.dir, "pin.json"), "utf8")).records.copy).toMatchObject({ candidate: "copy-v2.md" });
    expect(pinBlocker(w.consumer, "writer", SLOT)).toBeUndefined();
  });

  it("judges a headered candidate's body by every copy rule: the header relaxes none", async () => {
    const w = world();
    w.submit(GOOD);
    submitBytes(w, "copy-v2.md", headered("copy-v2.md", BAD));
    const result = await w.pin("copy-v2.md");
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/copy-v2\.md has no passing verdict: \[limit\] en header\.heading is \d+ characters, past the copy contract's maxLength/);
  });

  it("refuses a malformed clossys.candidate/1 header, naming the header", async () => {
    const w = world();
    w.submit(BAD);
    submitBytes(w, "copy-v2.md", headered("copy-v2.md", GOOD, header => { header.createdAt = "yesterday"; header.slot = `writer/sections.other.copy`; }));
    const result = await w.pin("copy-v2.md");
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/copy-v2\.md has no passing verdict: \[invalid\] clossys header: /);
    expect(existsSync(join(w.dir, "pin.json"))).toBe(false);
  });

  it("writeCandidate's header option writes a Writer copy candidate as a clossys.candidate/1 file the gate pins and the reader takes", async () => {
    const w = world();
    w.submit(BAD);
    const createdBy = { actor: "agent" as const, agent: "writer" as const, skill: "packages/writer/skills/writer/SKILL.md", skillSha256: "0".repeat(64), model: "claude-opus-5-5", tier: "high" as const };
    const good = writeCandidate(w.consumer, "writer", SLOT, "copy", GOOD, { at: AT, provenance: { by: "agent:writer", model: "claude-opus-5-5", tier: "high" }, header: { createdBy } });
    const bytes = readFileSync(join(w.dir, "candidates", good.name), "utf8");
    expect(bytes).toMatch(/^---\nclossys: \{"schema":"clossys\.candidate\/1"/);
    expect(bytes).not.toMatch(/^source: /m);
    expect(bytes.endsWith(GOOD.slice(GOOD.indexOf("\n---\n") + 5))).toBe(true);
    // A body the copy rules refuse is refused before anything is written, header or not.
    expect(() => writeCandidate(w.consumer, "writer", SLOT, "copy", GOOD.replace(/^source: .*\n/m, ""), { at: AT, header: { createdBy } })).toThrow(/candidate refused/);
    const result = await w.pin(good.name);
    expect(result.exitCode).toBe(0);
    expect(pinBlocker(w.consumer, "writer", SLOT)).toBeUndefined();
  });

  it("refuses a second source beside the clossys header's (front matter source), naming the header", async () => {
    const w = world();
    w.submit(BAD);
    const once = headered("copy-v2.md", GOOD);
    const twice = once.replace(/\n---\n/, `\nsource: {"kind":"original","ref":[]}\n---\n`);
    expect(twice).not.toBe(once);
    submitBytes(w, "copy-v2.md", twice);
    const result = await w.pin("copy-v2.md");
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/copy-v2\.md has no passing verdict: \[invalid\] clossys header: source is the clossys header's; the candidate carries a second one/);
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

describe("the CHOOSE gate on a hero code candidate carrying an interactive backdrop (foundry-build-0048 A4)", () => {
  /**
   * The source heroCode's candidate carries under the real guard (U13 r4): it customizes the trusted tailark-oss hero
   * block (the provenance rule: a section's code adopts or customizes a reference-manifest item; original is for
   * consumer-asset slots only).
   */
  const HERO_SOURCE = { kind: "derived", ref: ["tailark-oss/mist-hero-section-1@8139698"], hash: "sha256:315ecac252ac891e44ae37f2c2d946312c78f3998fd7ed5d7279ab0f1582ce52", license: "MIT" };

  const HERO = "sections.hero";
  const backdrop = { component: "flickering-grid", params: { squareSize: 8, flickerChance: 0.2 } };
  /** The hero's own code candidate (original, MIT), with `meta.backdrop` riding on it when given. */
  const heroCode = (descriptor?: unknown) => ({
    $schema: "https://ui.shadcn.com/schema/registry-item.json",
    name: "hero",
    type: "registry:block",
    files: [{ path: "hero.tsx", type: "registry:block", content: "export function Hero() { return <section><h1>Hero</h1></section>; }\n" }],
    meta: { slot: HERO, source: HERO_SOURCE, ...(descriptor === undefined ? {} : { backdrop: descriptor }) },
  });
  /** A temp consumer whose hero contract (synced from the package: a backdrop-placed slot and the interactive.backdrop row) gains a render fixture. */
  function heroWorld() {
    const w = world();
    const file = join(w.consumer, "agents", "designer", HERO, "slot.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    expect(doc.contract.interactive).toBeUndefined();
    expect(doc.contract.slots).toContainEqual({ name: "backdrop", type: "media", required: false, placement: "backdrop" });
    expect(doc.contract.requirements).toContainEqual({ check: "interactive.backdrop", params: { contract: "$contract" } });
    // The synced hero contract carries no render sample; the world adds one (typed by an empty contract.props) so certify renders the code.
    doc.contract.props = [];
    doc.contract.fixture = { schema: "clossys.element-preview/1", fixtures: { file: "hero.tsx", export: "Hero", props: {} } };
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    // The world's contract edit is a recorded slot.json state (R14.1), and the hero's upstream is pinned (R02.2).
    appendSlotDocEvent(w.consumer, "designer", HERO, { by: "planner", at: AT, verb: "ia", skill: skillPath("producer", "ia"), fields: { kind: "ia", note: "fixture render sample" } });
    pinUpstream(w.consumer, "designer", HERO, AT);
    const submit = (item: unknown) => writeCandidate(w.consumer, "designer", HERO, "hero", item, { at: AT, provenance: { by: "agent:designer", model: "claude-opus-5-5", tier: "high" } });
    return {
      ...w, submit,
      gate: (name: string) => pinGate(w.root, w.consumer, "designer", HERO, name, AT),
      /** The owner's typed queue.pick answer naming this hero candidate (U13 r4, B2), which pin() cites. */
      queueEntry: (candidate = "hero-v1.json"): string => w.answer(`designer/${HERO}`, candidate),
      pin: (candidate: string) => runPinCli([`designer/${HERO}`, candidate, "--by", `owner:queue.pick#${QUEUE_ID}`, "--at", AT, "--root", w.root], w.root),
    };
  }

  it("pins the hero code candidate, and Publisher install mounts the hero code with the descriptor at its backdrop prop", async () => {
    const w = heroWorld();
    const good = w.submit(heroCode(backdrop));
    expect(w.gate(good.name).refusals).toEqual([]);
    w.queueEntry();
    const result = await w.pin(good.name);
    expect(result.message).toMatch(/pinned hero-v1\.json/);
    expect(result.exitCode).toBe(0);
    const pins = designerPins(w.root);
    expect(pins[HERO]).toBeDefined();
    const source = libraryRecordSource({ roots: specimenRoots(w.root), slotStates: false });
    const { slots, findings } = await resolvePage({ id: "home", frame: HERO, sections: [] }, { [HERO]: pins[HERO]! }, source);
    expect(findings).toEqual([]);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ slot: HERO, mounted: true, entry: { export: "Hero" } });
    expect(slots[0]!.props.backdrop).toEqual({ kind: "interactive", backdrop });
  }, 60_000);

  it("refuses an invalid descriptor at submit, and the pin of a candidate that slipped in by hand", async () => {
    const w = heroWorld();
    for (const [label, descriptor, message] of [
      ["bad params", { component: "particles", params: { quantity: 999 } }, /particles param quantity is 999, outside 8\.\.200/],
      ["a URL colour", { component: "flickering-grid", params: { color: "https://example.com/x.js" } }, /not one of the token colours/],
      ["an unknown component", { component: "three-scene", params: {} }, /not one of the adopted backdrop components particles, flickering-grid, grid-pattern, gradient-mesh/],
      ["a retired hand-built component", { component: "grid-glow", params: { cell: 32 } }, /"grid-glow", not one of the adopted backdrop components/],
      ["not an object", "flickering-grid", /not an object \{component, params\}/],
    ] as const) expect(() => w.submit(heroCode(descriptor)), label).toThrow(message);
    // Placed by hand (no submit), an invalid descriptor is refused at the pin as well.
    mkdirSync(join(w.consumer, "agents", "designer", HERO, "candidates"), { recursive: true });
    writeFileSync(join(w.consumer, "agents", "designer", HERO, "candidates", "hero-v1.json"), `${JSON.stringify(heroCode({ component: "flickering-grid", params: { squareSize: 1 } }), null, 2)}\n`);
    w.queueEntry();
    const result = await w.pin("hero-v1.json");
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/flickering-grid param squareSize is 1, outside 2\.\.16/);
    expect(existsSync(join(w.consumer, "agents", "designer", HERO, "pin.json"))).toBe(false);
  });

  it("refuses meta.backdrop on a surface whose contract declares no backdrop slot, at submit and at pin (U23 surface opt-in)", async () => {
    const w = heroWorld();
    const CTA = "sections.call-to-action";
    const cta = { ...heroCode(backdrop), name: "cta", meta: { ...heroCode(backdrop).meta, slot: CTA } };
    const NONE = /meta\.backdrop rides only on the code candidate of a surface whose contract declares a backdrop-placed slot; the sections\.call-to-action contract declares none/;
    expect(() => writeCandidate(w.consumer, "designer", CTA, "cta", cta, { at: AT, provenance: { by: "agent:designer", model: "claude-opus-5-5", tier: "high" } })).toThrow(NONE);
    mkdirSync(join(w.consumer, "agents", "designer", CTA, "candidates"), { recursive: true });
    writeFileSync(join(w.consumer, "agents", "designer", CTA, "candidates", "cta-v1.json"), `${JSON.stringify(cta, null, 2)}\n`);
    // The owner's typed answer names the slot and candidate pinned (U13 owner-decision predicate), so the refusal is the backdrop rule's.
    w.answer(`designer/${CTA}`, "cta-v1.json");
    const result = await runPinCli([`designer/${CTA}`, "cta-v1.json", "--by", `owner:queue.pick#${QUEUE_ID}`, "--at", AT, "--root", w.root], w.root, false);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(NONE);
    expect(existsSync(join(w.consumer, "agents", "designer", CTA, "pin.json"))).toBe(false);
  });

  it("refuses an interactive backdrop in preview props at submit and at pin: a CTA rendering Hero, and a hero's out-of-range descriptor", async () => {
    const w = heroWorld();
    const CTA = "sections.call-to-action";
    const interactive = { kind: "interactive", backdrop: { component: "particles", params: { quantity: 160, staticity: 40 } } };
    // The CTA's code renders Hero; it has no meta.backdrop and carries the descriptor in its preview props.
    const cta = { ...heroCode(), name: "cta", meta: { slot: CTA, source: { kind: "original", ref: [], license: "MIT" }, preview: { fixtures: { file: "hero.tsx", export: "Hero", props: { backdrop: interactive } } } } };
    const hero = { ...heroCode(backdrop), meta: { ...heroCode(backdrop).meta, preview: { fixtures: { file: "hero.tsx", export: "Hero", props: { backdrop: { kind: "interactive", backdrop: { component: "flickering-grid", params: { squareSize: 1 } } } } } } } };
    const PREVIEW = /meta\.preview\.fixtures\.props\.backdrop is an interactive backdrop in preview props; it rides only as meta\.backdrop on the code candidate of a surface whose contract declares a backdrop-placed slot/;
    expect(() => writeCandidate(w.consumer, "designer", CTA, "cta", cta, { at: AT, provenance: { by: "agent:designer", model: "claude-opus-5-5", tier: "high" } })).toThrow(PREVIEW);
    expect(() => w.submit(hero)).toThrow(PREVIEW);
    // Placed by hand (no submit), both are refused at the pin, naming the preview prop.
    for (const [slot, name, item] of [[CTA, "cta-v1.json", cta], [HERO, "hero-v1.json", hero]] as const) {
      mkdirSync(join(w.consumer, "agents", "designer", slot, "candidates"), { recursive: true });
      writeFileSync(join(w.consumer, "agents", "designer", slot, "candidates", name), `${JSON.stringify(item, null, 2)}\n`);
      const result = await runPinCli([`designer/${slot}`, name, "--by", w.answer(`designer/${slot}`, name), "--at", AT, "--root", w.root], w.root);
      expect(result.exitCode, slot).toBe(1);
      expect(result.message, slot).toMatch(PREVIEW);
      expect(existsSync(join(w.consumer, "agents", "designer", slot, "pin.json")), slot).toBe(false);
    }
  });
});
