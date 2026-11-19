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
import { afterAll, describe, expect, it } from "vitest";
import { danglingReason } from "../check/refs-dangling.js";
import { ownerEntry } from "../cli/__fixtures__/owner-entry.js";
import { runPinCli } from "../cli/pin.js";
import { writeCandidate } from "../records/slot-write.js";
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
  const HERO = "sections.hero";
  const backdrop = { component: "grid-glow", params: { cell: 32, pulse: true } };
  /** The hero's own code candidate (original, MIT), with `meta.backdrop` riding on it when given. */
  const heroCode = (descriptor?: unknown) => ({
    $schema: "https://ui.shadcn.com/schema/registry-item.json",
    name: "hero",
    type: "registry:block",
    files: [{ path: "hero.tsx", type: "registry:block", content: "export function Hero() { return <section><h1>Hero</h1></section>; }\n" }],
    meta: { slot: HERO, source: { kind: "original", ref: [], license: "MIT" }, ...(descriptor === undefined ? {} : { backdrop: descriptor }) },
  });
  /** A temp consumer whose hero contract (synced from the package: interactive.components and the interactive.backdrop row) gains a render fixture. */
  function heroWorld() {
    const w = world();
    const file = join(w.consumer, "agents", "designer", HERO, "slot.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    expect(doc.contract.interactive).toEqual({ components: ["particle-field", "gradient-mesh", "grid-glow"] });
    expect(doc.contract.requirements).toContainEqual({ check: "interactive.backdrop", params: { contract: "$contract" } });
    // The synced hero contract carries no render sample; the world adds one (typed by an empty contract.props) so certify renders the code.
    doc.contract.props = [];
    doc.contract.fixture = { schema: "clossys.element-preview/1", fixtures: { file: "hero.tsx", export: "Hero", props: {} } };
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    const submit = (item: unknown) => writeCandidate(w.consumer, "designer", HERO, "hero", item, { at: AT, provenance: { by: "agent:designer", model: "claude-opus-5-5", tier: "high" } });
    return {
      ...w, submit,
      gate: (name: string) => pinGate(w.root, w.consumer, "designer", HERO, name, AT),
      pin: (candidate: string) => runPinCli([`designer/${HERO}`, candidate, "--by", w.answer(`designer/${HERO}`, candidate), "--at", AT, "--root", w.root], w.root),
    };
  }

  it("pins the hero code candidate, and Publisher install mounts the hero code with the descriptor at its backdrop prop", async () => {
    const w = heroWorld();
    const good = w.submit(heroCode(backdrop));
    expect(w.gate(good.name).refusals).toEqual([]);
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
      ["bad params", { component: "particle-field", params: { density: 999 } }, /outside 8\.\.160/],
      ["a URL colour", { component: "grid-glow", params: { glow: "https://example.com/x.js" } }, /not one of the token colours/],
      ["an unknown component", { component: "three-scene", params: {} }, /not one of the Foundry components/],
      ["not an object", "grid-glow", /not an object \{component, params\}/],
    ] as const) expect(() => w.submit(heroCode(descriptor)), label).toThrow(message);
    // Placed by hand (no submit), an invalid descriptor is refused at the pin as well.
    mkdirSync(join(w.consumer, "agents", "designer", HERO, "candidates"), { recursive: true });
    writeFileSync(join(w.consumer, "agents", "designer", HERO, "candidates", "hero-v1.json"), `${JSON.stringify(heroCode({ component: "grid-glow", params: { cell: 4 } }), null, 2)}\n`);
    const result = await w.pin("hero-v1.json");
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/grid-glow param cell is 4, outside 16\.\.96/);
    expect(existsSync(join(w.consumer, "agents", "designer", HERO, "pin.json"))).toBe(false);
  });

  it("refuses an interactive backdrop in preview props at submit and at pin: a CTA rendering Hero, and a hero's out-of-range descriptor", async () => {
    const w = heroWorld();
    const CTA = "sections.call-to-action";
    const interactive = { kind: "interactive", backdrop: { component: "particle-field", params: { density: 160, links: true } } };
    // The CTA's code renders Hero; it has no meta.backdrop and carries the descriptor in its preview props.
    const cta = { ...heroCode(), name: "cta", meta: { slot: CTA, source: { kind: "original", ref: [], license: "MIT" }, preview: { fixtures: { file: "hero.tsx", export: "Hero", props: { backdrop: interactive } } } } };
    const hero = { ...heroCode(backdrop), meta: { ...heroCode(backdrop).meta, preview: { fixtures: { file: "hero.tsx", export: "Hero", props: { backdrop: { kind: "interactive", backdrop: { component: "grid-glow", params: { cell: 4 } } } } } } } };
    const PREVIEW = /meta\.preview\.fixtures\.props\.backdrop is an interactive backdrop in preview props; it rides only as meta\.backdrop on the sections\.hero code candidate/;
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
