/**
 * foundry-build-0031: `clossys check` judges a recut consumer (clossys.slot/2). Synthetic: a tmp copy of
 * test-fixtures/consumer-legacy-tree recut in tmp, and a tmp copy of test-fixtures/consumer (committed recut), then
 * the slot resolve that `clossys check` runs.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../cli/main.js";
import { runReleaseCli } from "../cli/release.js";
import { PRODUCER_ROOT } from "../package-path.js";
import { clock, geographyBrief, releaseWorld, stubBuilder, type ReleaseWorld } from "../release/__fixtures__/world.js";
import { buildCandidateHeader, candidatePath, serializeCandidate } from "../records/candidate.js";
import { cliActor } from "../records/pin.js";
import { readSlotEntry, readiness } from "../records/slots.js";
import { applyRecut, planRecut, recutCandidateBytes } from "../migrate/recut.js";
import { checkSlotModel } from "../records/slot-check.js";
import { OLD_SLOT_FORMAT, candidateIssues, candidateView, readSlotValue } from "../records/slot-current.js";
import { serializeFrontmatter } from "../records/slot-model/frontmatter.js";
import type { SlotAgent } from "../records/slot-model/types.js";
import type { AgentId } from "../records/types.js";
import { runSlotResolve } from "./slot-resolve.js";

const AT = "2026-11-15T10:00:00Z";

const LEGACY_TREE = join(PRODUCER_ROOT, "test-fixtures", "consumer-legacy-tree", "clossys");
const PROMISE = join("agents", "director", "advantage.proposition.promise", "slot.json");
/** The recut consumer two ways: the old-tree fixture recut here, or the committed current fixture (already recut). */
const STORES = [["recut in tmp from the old-tree fixture", "legacy-tree"], ["the committed current fixture", "current"]] as const;
type Store = (typeof STORES)[number][1];

/** One recut consumer in a fresh tmp folder; the caller removes `dir`. */
function prepare(store: Store) {
  const dir = mkdtempSync(join(tmpdir(), "check-current-"));
  const consumer = join(dir, "clossys");
  cpSync(store === "current" ? join(PRODUCER_ROOT, "test-fixtures", "consumer", "clossys") : LEGACY_TREE, consumer, { recursive: true });
  const slot = join(consumer, PROMISE);
  // The old-format bytes of one slot: the old-tree fixture's, which the recut replaced.
  const before = readFileSync(join(LEGACY_TREE, PROMISE), "utf8");
  if (store === "legacy-tree") applyRecut(planRecut(dir, { at: AT }));
  return { dir, consumer, slot, before };
}

describe.each(STORES)("clossys check on a recut consumer (current slot format): %s", (_name, store) => {
  // CP1-CHECKS: both cases judge one copy made once for their store (the copy of the 1,800-file fixture, and the
  // recut, were most of each case's time). The old-format case puts its one slot.json back when it ends.
  let judged: ReturnType<typeof prepare> | undefined;
  beforeAll(() => { judged = prepare(store); });
  afterAll(() => { if (judged) rmSync(judged.dir, { recursive: true, force: true }); judged = undefined; });

  it("judges it: no schema-version rows, no unreadable inputs, no missing slot.json", async () => {
    const w = judged!;
    expect(JSON.parse(readFileSync(w.slot, "utf8")).schema).toBe("clossys.slot/2");
    const result = await runSlotResolve(w.consumer);
    const messages = result.findings.map(row => row.message);
    expect(result.exitCode).not.toBe(2);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(messages.filter(message => /could not be read/.test(message))).toEqual([]);
    expect(messages.filter(message => /schema must be|unknown key|slot\.json is missing/.test(message))).toEqual([]);
    expect(messages).not.toContain(OLD_SLOT_FORMAT);
  });

  it("names an old-format slot.json once, pointing at clossys migrate recut", async () => {
    const w = judged!;
    const current = readFileSync(w.slot, "utf8");
    writeFileSync(w.slot, w.before);
    try {
      const result = await runSlotResolve(w.consumer);
      const old = result.findings.filter(row => row.message === OLD_SLOT_FORMAT);
      expect(old).toHaveLength(1);
      expect(result.findings.filter(row => /advantage\.proposition\.promise/.test(row.path ?? "") && /schema must be/.test(row.message))).toEqual([]);
    } finally { writeFileSync(w.slot, current); }
  });
});

/**
 * Review r1 P1-1: a current-format candidate is judged by every rule of its kind, not by its header alone.
 * Each candidate is written as `clossys migrate recut` writes it (int2 bytes through recutCandidateBytes), into a
 * slot of the recut fixture; each defect is one the old (slot/1) rules found, and is still a finding.
 */
describe.each(STORES)("a current-format candidate keeps every rule of its kind: %s", (_name, store) => {
  const original = { kind: "original", ref: [] };
  const slots: Record<"brief" | "element" | "strings", [SlotAgent, string]> = {
    brief: ["director", "advantage.proposition.promise"],
    element: ["designer", "components.badge"],
    strings: ["writer", "lexicon.avoid-terms"],
  };
  const brief = "## Direction\n- who: Owners\n\n## Because\n- why: Time\n\n## Watch\n- risk: Scope\n";
  const item = { name: "badge", type: "registry:ui", files: [{ path: "badge.tsx", type: "registry:ui", content: "export const Badge = () => null\n" }] };
  // CP1-CHECKS: every case here writes one candidate, judges only that file's findings and removes it, so the cases
  // share one recut copy of the fixture per store instead of copying the 1,800-file fixture per case.
  let shared: ReturnType<typeof prepare> | undefined;
  beforeAll(() => { shared = prepare(store); });
  afterAll(() => { if (shared) rmSync(shared.dir, { recursive: true, force: true }); shared = undefined; });
  /** Writes one int2 candidate the way recut does; returns its path and the check's findings for that file only. */
  function judge(consumer: string, family: keyof typeof slots, name: string, int2: string, edit: (bytes: string) => string = bytes => bytes) {
    const [agent, slotId] = slots[family];
    const dir = join(consumer, "agents", agent, slotId);
    expect(JSON.parse(readFileSync(join(dir, "slot.json"), "utf8")).schema).toBe("clossys.slot/2");
    mkdirSync(join(dir, "candidates"), { recursive: true });
    const bytes = edit(recutCandidateBytes(name, int2, { agent, slotId, at: AT, version: "0.0.0", sourceRef: `agents/${agent}/${slotId}/candidates/${name}` }));
    writeFileSync(join(dir, "candidates", name), bytes);
    const rel = `agents/${agent}/${slotId}/candidates/${name}`;
    const found = checkSlotModel(consumer, { current: true }).filter(issue => issue.path === rel).map(issue => `${issue.code}: ${issue.message}`);
    rmSync(join(dir, "candidates", name));
    return { bytes, found };
  }

  it("passes a well-formed brief, element and Writer file, and reads each through its view", () => {
    const w = shared!;
    const ok = judge(w.consumer, "brief", "clean-v1.md", serializeFrontmatter({ slot: slots.brief[1], source: original, feeds: [], functions: ["gtm"], note: "kept" }, brief));
    expect(ok.found).toEqual([]);
    expect(ok.bytes.match(/^---$/gm)).toHaveLength(2);
    expect(candidateView("clean-v1.md", ok.bytes)).toContain('functions: ["gtm"]');
    expect(judge(w.consumer, "element", "clean-v1.json", JSON.stringify({ ...item, meta: { source: original } })).found).toEqual([]);
    expect(judge(w.consumer, "strings", "clean-v1.md", serializeFrontmatter({ slot: slots.strings[1], locales: ["en"], source: original, reason: "director/advantage.proposition.promise" }, '## en\n### avoid.one\n<!-- {"id":"avoid-one","bindings":[]} -->\nNever say synergy.\n')).found).toEqual([]);
  });

  it("a brief with no sections is a finding", () => {
    const w = shared!;
    expect(judge(w.consumer, "brief", "bare-v1.md", serializeFrontmatter({ slot: slots.brief[1], source: original, feeds: [], functions: [] }, "Just prose.\n")).found)
      .toContain("candidate-invalid: body must be ## Direction, ## Because, ## Watch");
  });

  it("a brief saved as .json is a finding", () => {
    const w = shared!;
    expect(judge(w.consumer, "brief", "brief-v1.json", JSON.stringify({ text: brief, meta: { source: original } })).found).toContain("candidate-name: brief candidates are .md");
  });

  it("an element that is no registry item, with a registry source and no ref, is a finding for each", () => {
    const w = shared!;
    const found = judge(w.consumer, "element", "nope-v1.json", JSON.stringify({ nope: true, meta: { source: { kind: "registry", ref: [] } } })).found;
    expect(found).toContain("candidate-invalid: registry-item name is required");
    expect(found).toContain("candidate-source: source.kind registry needs at least one ref");
  });

  it("pin state at the top level of a candidate is a finding (JSON beside the header, Markdown front matter)", () => {
    const w = shared!;
    const json = judge(w.consumer, "element", "state-v1.json", JSON.stringify({ ...item, meta: { source: original } }), bytes => JSON.stringify({ ...JSON.parse(bytes), status: "active", pinned: true })).found;
    expect(json).toContain("candidate-status: status is pin state; pinning lives only in pin.json");
    expect(json).toContain("candidate-status: pinned is pin state; pinning lives only in pin.json");
    const md = judge(w.consumer, "brief", "state-v1.md", serializeFrontmatter({ slot: slots.brief[1], source: original, feeds: [], functions: [], status: "active" }, brief)).found;
    expect(md).toContain("candidate-status: frontmatter status is pin state; pinning lives only in pin.json");
  });

  it("a Writer record carrying leaf, a bad vary and a second source beside the header are findings", () => {
    const w = shared!;
    expect(judge(w.consumer, "strings", "leaf-v1.md", serializeFrontmatter({ slot: slots.strings[1], locales: ["en"], source: original }, '## en\n### avoid.one\n<!-- {"id":"avoid-one","bindings":[],"leaf":"lexicon.avoid-terms"} -->\nNever.\n')).found)
      .toContain("candidate-invalid: record avoid.one carries leaf; the slot is the leaf");
    expect(judge(w.consumer, "element", "vary-v1.json", JSON.stringify({ ...item, meta: { source: original, vary: { tone: "loud", size: "big" } } })).found)
      .toContain('candidate-invalid: meta.vary must be {"<axis>": "<value>"} with one axis');
    expect(judge(w.consumer, "brief", "second-v1.md", serializeFrontmatter({ slot: slots.brief[1], source: original, feeds: [], functions: [] }, brief), bytes => bytes.replace("\nslot: ", `\nsource: ${JSON.stringify(original)}\nslot: `)).found)
      .toContain("candidate-source: source is the clossys header's; the candidate carries a second one");
    expect(existsSync(join(w.consumer, "agents", "writer", "lexicon.avoid-terms", "candidates", "leaf-v1.md"))).toBe(false);
  });
});

/**
 * Review r1-delta P1: the int2 kind rules judge only a candidate that still carries an int2-shaped document. The
 * target-format shapes (a release manifest, a Designer SVG, a Writer JSON record, a Director brief with only its
 * header) are judged by the target rules: the kind's extensions, the header source, and the candidate's own level.
 * Synthetic: the release tests' tmp consumer (structure and real slot ids only).
 */
describe("a target-format candidate is judged by the target rules", () => {
  const worlds: ReleaseWorld[] = [];
  afterEach(() => { for (const world of worlds.splice(0)) world.dispose(); });
  const make = (): ReleaseWorld => { const world = releaseWorld(); worlds.push(world); return world; };
  const release = (world: ReleaseWorld, flag: string, now: () => Date) => runReleaseCli(["site", flag, "--root", world.root], world.root, { builder: stubBuilder, now });
  /** The slot check's findings on candidate files, as `<path> <code>: <message>`. */
  const rows = (world: ReleaseWorld) => checkSlotModel(join(world.root, "clossys"), { current: true })
    .filter(issue => issue.path.includes("/candidates/")).map(issue => `${issue.path} ${issue.code}: ${issue.message}`);
  /** Writes one target-format candidate (header via buildCandidateHeader) and returns its findings under its slot. */
  function judge(world: ReleaseWorld, ref: string, name: string, content: unknown, extra: { source?: unknown; record?: string } = {}, edit: (bytes: string) => string = bytes => bytes) {
    const [agent, slotId] = ref.split("/") as [AgentId, string];
    const header = buildCandidateHeader({
      agent, slotId, name, createdBy: cliActor("test"), createdAt: AT as never, ...(extra.record ? { record: extra.record } : {}),
      source: (extra.source ?? { kind: "original", ref: [] }) as never,
    });
    const bytes = edit(serializeCandidate(name, header, content));
    const file = candidatePath(world.root, agent, slotId, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    const read = readSlotValue(JSON.parse(world.read(`clossys/agents/${agent}/${slotId}/slot.json`)))!;
    return candidateIssues(read, agent as SlotAgent, slotId, name, bytes).map(issue => `${issue.code}: ${issue.message}`);
  }

  it("clossys check gains no finding from clossys publisher release --manifest, and the pinned release slot clears as an input", async () => {
    const world = make();
    const now = clock();
    const consumer = join(world.root, "clossys");
    // The world places every slot in its agent's IA (release.site under releases/site, page.home under pages/site), each
    // slot.json at the ia of its position. `place` keeps that ia and edits the rest of a slot.json.
    const place = (id: string, edit: (slot: Record<string, unknown>) => Record<string, unknown>) => {
      const rel = `clossys/agents/publisher/${id}/slot.json`;
      world.write(rel, `${JSON.stringify(edit(JSON.parse(world.read(rel))), null, 2)}\n`);
    };
    const findings = (message: string) => message.split("\n").filter(line => /^\s+agents\//.test(line));
    const before = await runCli(["check", "--root", world.root], world.root);
    expect((await release(world, "--build", now)).exitCode).toBe(0);
    // The candidate findings before any release step: release --manifest and the ready-pin add none.
    const baseline = rows(world);
    const manifest = await release(world, "--manifest", now);
    expect(manifest.exitCode, manifest.message).toBe(0);
    // Every input pin of the world went through the CHOOSE gate (pinGate, its scorecard) and the cascade: none is
    // legacy, so the gates below pass on the real certifier's verdicts, and nothing here records a verdict by hand.
    // The manifest alone: clossys check gains no finding at all.
    const written = await runCli(["check", "--root", world.root], world.root);
    expect(written.exitCode, written.message).toBeLessThanOrEqual(before.exitCode);
    expect(findings(written.message).filter(line => !findings(before.message).includes(line))).toEqual([]);
    expect((await release(world, "--gates", now)).exitCode).toBe(0);
    const name = (manifest.output as { wrote: string[] }).wrote[0]!.split("/").pop()!;
    const pinned = await runCli(["pin", "publisher/release.site", name, "--by", `owner:${world.signoff(now)}`, "--root", world.root], world.root);
    expect(pinned.exitCode, pinned.message).toBe(0);
    expect(rows(world)).toEqual(baseline);
    expect(rows(world).filter(row => row.includes("release.site"))).toEqual([]);
    const after = await runCli(["check", "--root", world.root], world.root);
    // After the pin: no new finding at all, the clossys.pin/2 pin.json that `clossys pin` wrote included.
    expect(JSON.parse(world.read("clossys/agents/publisher/release.site/pin.json"))).toMatchObject({ schema: "clossys.pin/2", candidate: name });
    expect(findings(after.message).filter(line => !findings(before.message).includes(line))).toEqual([]);
    expect(after.message).not.toMatch(/release\.site[^\n]*(schema must be|format is required|entryOrder|candidates are)/);
    // slots.ts:740 (inputBlocker) gives the pinned manifest this verdict: the slot read and the pinned bytes.
    const manifestBytes = world.read(`clossys/agents/publisher/release.site/candidates/${name}`);
    const releaseRead = readSlotValue(JSON.parse(world.read("clossys/agents/publisher/release.site/slot.json")))!;
    expect(candidateIssues(releaseRead, "publisher", "release.site", name, manifestBytes)).toEqual([]);
    // Through slots.ts itself: page.home takes the release as an input, and inputBlocker reads the clossys.pin/2
    // pin.json `clossys pin` wrote, through to the candidate verdict at :740, and clears.
    place("page.home", slot => ({ ...slot, refs: [...(slot.refs as unknown[]), { to: "publisher/release.site", rel: "input" }] }));
    expect(readSlotEntry(consumer, "publisher", "release.site")).toBeDefined();
    expect(readiness(consumer, "publisher", "page.home")).toEqual({ ready: true, blockedBy: [] });
  });

  it("passes a Writer JSON record, the release world's Director brief, Designer content and a Designer SVG", () => {
    const world = make();
    // The world's own candidates come in through the submit verb (writeCandidate), in the shape it validates; the
    // target rules are judged here on target-format files beside them.
    expect(judge(world, "director/focus.reach.geography", "geography-v3.md", geographyBrief("en, fr").body)).toEqual([]);
    expect(judge(world, "designer/sections.hero", "hero-v2.svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>')).toEqual([]);
    expect(judge(world, "writer/sections.hero.copy", "home.hero-v2.json", { fields: { "header.heading": { en: "a", fr: "b" } } }, { record: "home.hero" })).toEqual([]);
    expect(judge(world, "director/focus.reach.geography", "geography-v2.md", "## Direction\n- Language: en, fr\n")).toEqual([]);
    expect(judge(world, "designer/sections.hero", "hero-v3.json", { placeholder: 3 }, { source: { kind: "package-default", ref: [] } })).toEqual([]);
  });

  it("keeps the target rules: the kind's extensions, the header source, nothing beside the header", () => {
    const world = make();
    expect(judge(world, "writer/sections.hero.copy", "home.hero-v2.svg", "<svg></svg>", { record: "home.hero" })).toContain("candidate-name: strings candidates are .md or .json");
    expect(judge(world, "publisher/page.home", "home-v2.md", "# home\n")).toContain("candidate-name: page candidates are .json");
    expect(judge(world, "designer/sections.hero", "hero-v2.json", { placeholder: 2 }, { source: { kind: "npm", ref: ["npm/left-pad"] } }))
      .toContain("candidate-source: source.kind npm needs exactly one ref npm/<package>@<exact version>");
    const beside = judge(world, "publisher/release.site", "site-v1.json", { publication: "site" }, {}, bytes => JSON.stringify({ ...JSON.parse(bytes), pinned: true, lineage: [], extra: 1 }));
    expect(beside).toEqual([
      "candidate-status: pinned is pin state; pinning lives only in pin.json",
      "candidate-source: lineage is replaced by the single source key",
      "candidate-invalid: extra sits beside the clossys header and content",
    ]);
  });

  it("still judges an int2-shaped document in the same world by every rule of its kind", () => {
    const world = make();
    const int2 = { schema: "clossys.publication/1", meta: { slot: "release.site" } };
    // A release slot holds the manifest, so a publication record there is refused as such (U39b fix r1) ...
    expect(judge(world, "publisher/release.site", "site-v1.json", int2))
      .toEqual(["candidate-invalid: publisher/release.site is a release slot: it holds the manifest clossys publisher release <pub> --manifest writes, not a page or publication record"]);
    // ... and on a publication slot the same document is still judged by every rule of the publication kind.
    const name = "site-v1.json";
    const header = buildCandidateHeader({ agent: "publisher", slotId: "publication.site", name, createdBy: cliActor("test"), createdAt: AT as never, source: { kind: "original", ref: [] } as never });
    const publication = readSlotValue({ ...JSON.parse(world.read("clossys/agents/publisher/release.site/slot.json")), kind: "publication" })!;
    expect(candidateIssues(publication, "publisher", "publication.site", name, serializeCandidate(name, header, int2)).map(issue => `${issue.code}: ${issue.message}`))
      .toEqual(expect.arrayContaining(["candidate-invalid: format is required", "candidate-invalid: entryOrder must be a list"]));
    expect(judge(world, "designer/sections.hero", "hero-v2.json", { name: "hero", type: "registry:block" })).toContain("candidate-invalid: files[] must carry path, type and inline content");
  });
});
