/**
 * `clossys slot <ref> --json` (clossys.slot-view/1, system.md 12.3; parity step 2 of 14.4).
 *
 * Parity runs on a temporary copy of the int2 fixture consumer (test-fixtures/consumer) with
 * synthetic candidates and pins added to one slot per agent that has slots there. Synthetic test
 * data only; never a consumer's copy.
 */
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { slotDetail } from "../server/slot-detail.js";
import { writeFixtureNames } from "../server/__fixtures__/writer-names.js";
import { serializeFrontmatter, type SlotAgent } from "../records/slot-model/index.js";
import { runSlotCli } from "../cli/slot.js";
import { runCli } from "../cli/main.js";
import { validateAgainst, type JsonSchema } from "../records/schema.js";
import { formatRef, parseRef, RefError } from "./ref.js";
import { slotView, SlotViewError, type SlotView } from "./slot.js";

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer", import.meta.url));
const TALLYHOUSE = fileURLToPath(new URL("../../test-fixtures/tallyhouse", import.meta.url));
const SCHEMA = JSON.parse(readFileSync(fileURLToPath(new URL("../../schemas/slot-view.json", import.meta.url)), "utf8")) as JsonSchema;
const roots: string[] = [];
const sha = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
const noPackage = { packageRoot: () => undefined };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(dir);
  return dir;
}
function copyFixture(): string {
  const root = tempDir("slot-view-");
  cpSync(FIXTURE, root, { recursive: true });
  // slot-detail labels need pinned Writer names. This fixture's writer IA already places
  // strings.names, so keep its IA bytes and take only the names candidate and pin.
  const writerIa = join(root, "clossys/agents/writer/ia.json");
  const ia = readFileSync(writerIa);
  writeFixtureNames(root);
  writeFileSync(writerIa, ia);
  return root;
}
const slotDir = (root: string, agent: string, id: string) => join(root, "clossys/agents", agent, id);
function addCandidate(root: string, agent: string, id: string, name: string, bytes: string): string {
  const dir = join(slotDir(root, agent, id), "candidates");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), bytes);
  return sha(bytes);
}
function addPin(root: string, agent: string, id: string, candidate: string, digest: string, basis = "picked") {
  // Attribution and date are synthetic test metadata, not an approval record.
  writeFileSync(join(slotDir(root, agent, id), "pin.json"), JSON.stringify({ candidate, sha256: digest, decidedBy: "owner:synthetic-test-only", basis, at: "2026-01-01T00:00:00Z" }));
}
const mdCandidate = (id: string, text: string) => serializeFrontmatter({ slot: id, source: { kind: "original", ref: [] } }, `## Answer\n\n${text}\n`);
const jsonCandidate = (name: string, text: string) => `${JSON.stringify({ name, type: "registry:ui", meta: { source: { kind: "original", ref: [] } }, files: [], note: text }, null, 2)}\n`;

/** One slot per agent that has slots in the int2 fixture (publisher has none: only ia.json). */
const CASES: { agent: SlotAgent; id: string; first: string; second: string; make: (name: string, text: string) => string }[] = [
  { agent: "director", id: "advantage.proposition.promise", first: "promise-v1.md", second: "promise-v2.md", make: (_name, text) => mdCandidate("advantage.proposition.promise", text) },
  { agent: "designer", id: "components.button", first: "button-v1.json", second: "button-v2.json", make: name => jsonCandidate(name.replace(/-v\d+\.json$/, ""), "synthetic") },
  { agent: "writer", id: "lexicon.mood", first: "mood-v1.md", second: "mood-v2.md", make: (_name, text) => mdCandidate("lexicon.mood", text) },
];

/** clossys.slot-view/1 (system.md 12.3): valid against schemas/slot-view.json, with every key present. */
function expectSlotViewShape(view: SlotView) {
  expect(validateAgainst(SCHEMA, view)).toEqual([]);
  expect(Object.keys(view).sort()).toEqual(["candidates", "consumedBy", "ledger", "pin", "queue", "ref", "schema", "slot"]);
  expect(view.schema).toBe("clossys.slot-view/1");
  expect(Object.keys(view.slot).sort()).toEqual(["agent", "brief", "briefSha256", "contract", "ia", "id", "kind", "status", "tightenCount"]);
  expect(Object.keys(view.slot.ia).sort()).toEqual(["l0", "l1", "l2"]);
  expect(Object.keys(view.slot.brief).sort()).toEqual(["acceptance", "inputs", "mustDo", "purpose"]);
  expect(view.slot.briefSha256).toMatch(/^[0-9a-f]{64}$/);
  for (const candidate of view.candidates) {
    expect(Object.keys(candidate).filter(key => key !== "record").sort()).toEqual(["briefCurrent", "check", "createdAt", "createdBy", "name", "rationale", "renders", "sha256"]);
    expect(["pass", "fail", "error", "none"]).toContain(candidate.check.status);
  }
  for (const pin of view.pin) {
    expect(Object.keys(pin).filter(key => key !== "record").sort()).toEqual(["at", "basis", "candidate", "decidedBy", "sha256", "state"]);
    expect(["pinned", "confirm", "sample"]).toContain(pin.state);
  }
}

describe("ref strings (system.md 5)", () => {
  it("parses every form and round-trips", () => {
    for (const ref of ["designer/sections.hero", "writer/sections.hero.copy#home.hero", "director/identity.naming.name:Casing",
      "producer/loop.refine/package:refine-v1.json", "writer/sections.hero.copy/home.hero-v3.json#home.hero"]) expect(formatRef(parseRef(ref))).toBe(ref);
    expect(parseRef("producer/loop.refine/package:refine-v1.json")).toEqual({ agent: "producer", slot: "loop.refine", candidate: "refine-v1.json", packageDefault: true });
    expect(parseRef("director/identity.naming.name:Casing")).toEqual({ agent: "director", slot: "identity.naming.name", key: "Casing" });
  });
  it("refuses malformed refs", () => {
    for (const ref of ["designer", "nobody/sections.hero", "designer/Hero", "designer/sections", "designer/sections.hero/hero.json", "designer/a.b/c/d"]) {
      expect(() => parseRef(ref)).toThrow(RefError);
    }
  });
});

describe("clossys slot read model", () => {
  it("matches slot-detail on the int2 fixture: candidates, pin and used-by, one slot per agent", () => {
    const root = copyFixture();
    for (const { agent, id, first, second, make } of CASES) {
      const firstSha = addCandidate(root, agent, id, first, make(first, "First synthetic answer."));
      addCandidate(root, agent, id, second, make(second, "Second synthetic answer."));
      addPin(root, agent, id, first, firstSha);
    }
    for (const { agent, id, first } of CASES) {
      const detail = slotDetail(root, agent, id)!;
      const view = slotView(root, `${agent}/${id}`, noPackage);
      expectSlotViewShape(view);
      expect(view.candidates.map(row => [row.name, row.sha256])).toEqual(detail.candidates.map(row => [row.name, row.sha256]));
      expect(view.pin.map(row => [row.candidate, row.sha256, row.decidedBy, row.basis, row.at])).toEqual([[detail.pin!.candidate, detail.pin!.sha256, detail.pin!.decidedBy, detail.pin!.basis, detail.pin!.at]]);
      expect(view.pin[0]!.candidate).toBe(detail.candidates.find(row => row.pinned)!.name);
      expect(view.pin[0]!.candidate).toBe(first);
      expect(view.pin[0]!.state).toBe("pinned");
      expect(view.consumedBy).toEqual(detail.usedBy.map(row => `${row.agent}/${row.id}`));
      expect({ id: view.slot.id, kind: view.slot.kind, contract: view.slot.contract }).toEqual({ id: detail.id, kind: detail.kind, contract: detail.contract });
    }
    // components.icon is used by components.button and others: the used-by set is not trivially empty.
    const icon = slotView(root, "designer/components.icon", noPackage);
    expect(icon.consumedBy).toContain("designer/components.button");
    expect(icon.consumedBy).toEqual(slotDetail(root, "designer", "components.icon")!.usedBy.map(row => `${row.agent}/${row.id}`));
  }, 30_000); // copies the fixture and reads every agent's IA; slow on a loaded machine

  it("an empty fixture slot is honest: no candidates, no pin, same as slot-detail", () => {
    const root = copyFixture();
    const view = slotView(root, "writer/lexicon.mood", noPackage);
    expectSlotViewShape(view);
    expect(view.candidates).toEqual([]);
    expect(view.pin).toEqual([]);
    expect(slotDetail(root, "writer", "lexicon.mood")!.candidates).toEqual([]);
    expect(view.slot.ia).toEqual({ l0: "lexicon", l1: "lexicon/voice", l2: "lexicon/voice/voice-person-and-mood" });
    expect(view.slot.brief.inputs).toEqual([{ to: "director/identity.verbal.voice", rel: "input" }]);
    expect(view.queue).toEqual([]);
    expect(view.ledger).toEqual([]);
  });

  it("pins the pinned candidate, never another one, and states confirm for a non-owner basis", () => {
    const root = copyFixture();
    const v1 = addCandidate(root, "designer", "components.button", "button-v1.json", jsonCandidate("button", "one"));
    const v2 = addCandidate(root, "designer", "components.button", "button-v2.json", jsonCandidate("button", "two"));
    addPin(root, "designer", "components.button", "button-v1.json", v1, "planner");
    const view = slotView(root, "designer/components.button", noPackage);
    expect(view.pin).toHaveLength(1);
    expect(view.pin[0]).toMatchObject({ candidate: "button-v1.json", sha256: v1, state: "confirm" });
    expect(view.pin[0]!.sha256).not.toBe(v2);
    expect(view.candidates.find(row => row.name === view.pin[0]!.candidate)!.sha256).toBe(view.pin[0]!.sha256);
  });

  it("lists the package default when no consumer candidate exists, as the sample pin", () => {
    const root = copyFixture();
    const pkg = tempDir("slot-view-pkg-");
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@clossys/designer", version: "0.0.0-test" }));
    mkdirSync(join(pkg, "src/catalog/defaults/components.button"), { recursive: true });
    const bytes = jsonCandidate("button", "package sample");
    writeFileSync(join(pkg, "src/catalog/defaults/components.button/button-v1.json"), bytes);
    const options = { packageRoot: (agent: string) => agent === "designer" ? pkg : undefined };
    const view = slotView(root, "designer/components.button", options);
    expectSlotViewShape(view);
    expect(view.candidates.map(row => row.name)).toEqual(["button-v1.json"]);
    expect(view.candidates[0]).toMatchObject({ sha256: sha(bytes), createdBy: { actor: "package", package: "@clossys/designer", version: "0.0.0-test" } });
    expect(view.pin).toEqual([expect.objectContaining({ candidate: "button-v1.json", sha256: sha(bytes), basis: "package-default", state: "sample" })]);
    // The ref form for the package default resolves to it.
    expect(slotView(root, "designer/components.button/package:button-v1.json", options).candidates.map(row => row.name)).toEqual(["button-v1.json"]);
    // A valid consumer pin wins over the package default.
    const own = addCandidate(root, "designer", "components.button", "button-v2.json", jsonCandidate("button", "own"));
    addPin(root, "designer", "components.button", "button-v2.json", own);
    const pinned = slotView(root, "designer/components.button", options);
    expect(pinned.candidates.map(row => row.name)).toEqual(["button-v1.json", "button-v2.json"]);
    expect(pinned.pin).toEqual([expect.objectContaining({ candidate: "button-v2.json", state: "pinned" })]);
  });

  it("refuses a dangling ref: unknown slot, missing candidate, missing package default", () => {
    const root = copyFixture();
    addCandidate(root, "designer", "components.button", "button-v1.json", jsonCandidate("button", "one"));
    expect(() => slotView(root, "designer/components.not-a-slot", noPackage)).toThrow(SlotViewError);
    expect(() => slotView(root, "designer/components.button/button-v9.json", noPackage)).toThrow(SlotViewError);
    expect(() => slotView(root, "designer/components.button/package:button-v1.json", noPackage)).toThrow(SlotViewError);
    expect(slotView(root, "designer/components.button/button-v1.json", noPackage).candidates.map(row => row.name)).toEqual(["button-v1.json"]);
  });

  it("a pin whose bytes drifted is not shown as the pin", () => {
    const root = copyFixture();
    addCandidate(root, "designer", "components.button", "button-v1.json", jsonCandidate("button", "one"));
    addPin(root, "designer", "components.button", "button-v1.json", "0".repeat(64));
    expect(slotView(root, "designer/components.button", noPackage).pin).toEqual([]);
  });

  it("reads open queue entries and ledger entries that name the slot", () => {
    const root = copyFixture();
    const producer = join(root, "clossys/agents/producer");
    mkdirSync(join(producer, "queue.approve/entries"), { recursive: true });
    mkdirSync(join(producer, "ledger.refine/entries"), { recursive: true });
    const subject = { to: "designer/components.button", rel: "raisedBy" };
    writeFileSync(join(producer, "queue.approve/entries/20260101T0000Z-button.json"), JSON.stringify({ status: "open", subject }));
    writeFileSync(join(producer, "queue.approve/entries/20260101T0100Z-done.json"), JSON.stringify({ status: "answered", subject }));
    writeFileSync(join(producer, "queue.approve/entries/20260101T0200Z-other.json"), JSON.stringify({ status: "open", subject: { to: "designer/components.icon" } }));
    writeFileSync(join(producer, "ledger.refine/entries/20260101T0000Z-refine-button.json"), JSON.stringify({ status: "done", steps: [{ wrote: [{ file: "clossys/agents/designer/components.button/candidates/button-v2.json" }] }] }));
    const view = slotView(root, "designer/components.button", noPackage);
    expect(view.queue).toEqual(["20260101T0000Z-button"]);
    expect(view.ledger).toEqual(["20260101T0000Z-refine-button"]);
  });

  it("the verb prints the view and exits 1 on a dangling ref, 2 on a malformed one", async () => {
    const root = copyFixture();
    const ok = await runSlotCli(["designer/components.button", "--json"], root);
    expect(ok.exitCode).toBe(0);
    expectSlotViewShape(ok.output as SlotView);
    expect((await runSlotCli(["designer/components.missing", "--json"], root)).exitCode).toBe(1);
    expect((await runCli(["slot", "designer/Bad", "--json"], root)).exitCode).toBe(2);
    const routed = await runCli(["slot", "designer/components.button", "--json"], root);
    expect(routed.exitCode).toBe(0);
    expect((routed.output as SlotView).ref).toBe("designer/components.button");
  });
});

describe("Tallyhouse golden (target clossys.slot/2 records)", () => {
  const packages = { packageRoot: (agent: string) => join(TALLYHOUSE, "packages", agent) };
  const REFS = ["writer/sections.hero.copy#home.hero", "designer/sections.hero", "director/identity.naming.name"];
  const PINS = ["writer/sections.hero.copy/pin.json", "designer/sections.hero/pin.json", "director/identity.naming.name/pin.json"];
  /** A copy whose pins carry the real sha256 of their candidates (the fixture's digests are illustrative). */
  function sealedCopy(): string {
    const root = tempDir("slot-view-tally-");
    cpSync(TALLYHOUSE, root, { recursive: true });
    for (const rel of PINS) {
      const file = join(root, "clossys/agents", rel);
      const doc = JSON.parse(readFileSync(file, "utf8"));
      const rows = doc.records ? Object.values(doc.records) as { candidate: string; sha256: string }[] : [doc];
      for (const row of rows) row.sha256 = sha(readFileSync(join(file, "..", "candidates", row.candidate), "utf8"));
      writeFileSync(file, JSON.stringify(doc));
    }
    return root;
  }
  const golden = (view: SlotView) => ({
    ref: view.ref, kind: view.slot.kind, status: view.slot.status, ia: view.slot.ia, tightenCount: view.slot.tightenCount,
    candidates: view.candidates.map(row => [row.name, row.record ?? null, row.createdBy.actor, row.createdAt, row.check.status, row.rationale.length]),
    pin: view.pin.map(row => [row.record ?? null, row.candidate, row.decidedBy, row.basis, row.at, row.state]),
    consumedBy: view.consumedBy, queue: view.queue, ledger: view.ledger,
  });

  it("three slots, one per agent kind, match the golden and validate", () => {
    const views = REFS.map(ref => slotView(sealedCopy(), ref, packages));
    for (const view of views) expectSlotViewShape(view);
    expect(views.map(golden)).toEqual([
      { ref: "writer/sections.hero.copy#home.hero", kind: "copy", status: "live", ia: { l0: "copy", l1: "copy/section-copy", l2: "copy/section-copy/story" }, tightenCount: 1,
        candidates: [["home.hero-v3.json", "home.hero", "agent", "2026-11-18T09:48:20Z", "pass", 5]],
        pin: [["home.hero", "home.hero-v3.json", "agent:writer", "agent", "2026-11-18T10:04:12Z", "pinned"]],
        consumedBy: ["publisher/page.home"], queue: [], ledger: ["20261118T0915Z-refine-home-hero"] },
      { ref: "designer/sections.hero", kind: "element/section", status: "live", ia: { l0: "interface", l1: "interface/sections", l2: "interface/sections/story" }, tightenCount: 0,
        candidates: [["hero-v2.json", null, "agent", "2026-11-16T12:40:00Z", "pass", 2]],
        pin: [[null, "hero-v2.json", "agent:designer", "agent", "2026-11-16T13:02:40Z", "confirm"]],
        consumedBy: ["publisher/layout.marketing-home", "publisher/page.home", "writer/sections.hero.copy"], queue: [], ledger: [] },
      { ref: "director/identity.naming.name", kind: "brief", status: "live", ia: { l0: "strategy", l1: "strategy/identity", l2: "strategy/identity/naming" }, tightenCount: 1,
        candidates: [["name-v1.md", null, "agent", "2026-11-16T09:24:10Z", "pass", 2]],
        pin: [[null, "name-v1.md", "owner:queue.pick#20261116T0930Z-name", "picked", "2026-11-16T09:31:02Z", "pinned"]],
        consumedBy: ["designer/assets.lockup", "writer/lexicon.capitalization", "writer/narratives.legal-document", "writer/sections.hero.copy"], queue: [], ledger: [] },
    ]);
  });

  it("the fixture as shipped: pins whose digest does not match their bytes resolve nothing (system.md 8)", () => {
    for (const ref of REFS) expect(slotView(TALLYHOUSE, ref, packages).pin).toEqual([]);
  });

  it("a Tallyhouse package default is the sample pin of a slot with no consumer candidate", () => {
    const root = tempDir("slot-view-tally-empty-");
    mkdirSync(join(root, "clossys/agents/publisher/chrome.site-header"), { recursive: true });
    writeFileSync(join(root, "clossys/agents/publisher/chrome.site-header/slot.json"), JSON.stringify({ schema: "clossys.slot/2", kind: "chrome", status: "starter",
      ia: { l0: "chrome", l1: "chrome/site", l2: "chrome/site/header" }, brief: { purpose: "Synthetic test slot.", mustDo: [], inputs: [], acceptance: [] }, refs: [] }));
    const view = slotView(root, "publisher/chrome.site-header", packages);
    expectSlotViewShape(view);
    const bytes = readFileSync(join(TALLYHOUSE, "packages/publisher/defaults/chrome.site-header/header-v1.json"), "utf8");
    expect(view.candidates.map(row => [row.name, row.sha256])).toEqual([["header-v1.json", sha(bytes)]]);
    expect(view.pin).toEqual([expect.objectContaining({ candidate: "header-v1.json", sha256: sha(bytes), basis: "package-default", state: "sample" })]);
  });
});
