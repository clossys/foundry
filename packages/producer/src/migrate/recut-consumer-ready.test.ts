/**
 * foundry-build-0031: after `clossys migrate recut --apply` the consumer is one `clossys check` can judge.
 * Synthetic: a tmp copy of test-fixtures/consumer-legacy-tree, seeded in tmp with package default bodies (shape only).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PRODUCER_ROOT } from "../package-path.js";
import { readRecordHeader } from "../records/schema.js";
import { candidateView } from "../records/slot-current.js";
import { parseFrontmatter, serializeFrontmatter } from "../records/slot-model/frontmatter.js";
import { agentPackageRoot, positionIa, readSlot, validateSlot, SLOT_SCHEMA } from "../records/slot.js";
import { slotPositions, type IaDoc } from "../records/slot-model/index.js";
import { applyRecut, planRecut, RECUT_AGENTS, recutCandidateBytes, recutPending } from "./recut.js";

const AT = "2026-11-15T10:00:00Z";
const PACKAGES = join(PRODUCER_ROOT, "..");
const FRONT = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
const body = () => readFileSync(join(PACKAGES, "director", "src", "catalog", "defaults", "advantage.proposition.promise", "template-v1.md"), "utf8").replace(FRONT, "");
const jsonContent = () => (JSON.parse(readFileSync(join(PACKAGES, "writer", "defaults", "lexicon.energy", "energy-v1.json"), "utf8")) as { content: unknown }).content;
const HASH = `sha256:${"0123456789abcdef".repeat(4)}`;

let root: string | undefined;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = undefined; });

function world() {
  root = mkdtempSync(join(tmpdir(), "recut-ready-"));
  cpSync(join(PRODUCER_ROOT, "test-fixtures", "consumer-legacy-tree", "clossys"), join(root, "clossys"), { recursive: true });
  const consumer = join(root, "clossys");
  const agent = (name: string, ...rest: string[]) => join(consumer, "agents", name, ...rest);
  const put = (path: string, bytes: string) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, bytes); };
  return { root, consumer, agent, put };
}

/** The Writer package's own definition of a target slot (src/catalog/ia/<group>.json `slots`). */
function writerDefinition(dir: string, id: string): { kind: string; contract: Record<string, unknown>; inputs: { to: string; rel?: string; key?: string }[] } {
  const tree = JSON.parse(readFileSync(join(agentPackageRoot(dir, "writer"), "src", "catalog", "ia", "copy.json"), "utf8")) as { slots: { id: string; kind: string; contract: Record<string, unknown>; inputs: { to: string; rel?: string; key?: string }[] }[] };
  return tree.slots.find(slot => slot.id === id)!;
}

describe("migrate recut: a moved-to slot gets its slot.json (P2-1)", () => {
  it("writes the current-format slot.json of a target the recut places, from the package's own slot definition", () => {
    const w = world();
    w.put(w.agent("writer", "passages.hero", "candidates", "hero-v1.md"), body());
    expect(existsSync(w.agent("writer", "sections.hero.copy"))).toBe(false);
    applyRecut(planRecut(w.root, { at: AT }));

    const file = w.agent("writer", "sections.hero.copy", "slot.json");
    expect(existsSync(file)).toBe(true);
    const doc = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
    expect(validateSlot(doc)).toEqual([]);
    const definition = writerDefinition(w.root, "sections.hero.copy");
    const ia = JSON.parse(readFileSync(w.agent("writer", "ia.json"), "utf8")) as IaDoc;
    const position = slotPositions("writer", ia).get("sections.hero.copy")!;
    expect(doc).toMatchObject({ schema: "clossys.slot/2", id: "sections.hero.copy", agent: "writer", kind: definition.kind, status: "starter", base: null, contract: definition.contract });
    expect(doc.ia).toEqual(positionIa("sections.hero.copy", position));
    expect(doc.refs).toEqual(definition.inputs.map(ref => ({ to: ref.to, rel: ref.rel ?? "input", ...(ref.key !== undefined ? { key: ref.key } : {}) })));
    expect(doc.brief.inputs).toEqual(doc.refs);
    expect(readSlot(file).id).toBe("sections.hero.copy");

    // A second plan has nothing left to write.
    expect(recutPending(planRecut(w.root, { at: AT }))).toBe(0);
  });

  it("names a target the package defines no slot for, writes no slot.json for it, and applies the rest", () => {
    const w = world();
    w.put(w.agent("writer", "passages.hero", "candidates", "hero-v1.md"), body());
    // A Designer retired id moves to components.button; @clossys/designer has no base slot and no ia slots row for it.
    rmSync(w.agent("designer", "components.button"), { recursive: true, force: true });
    const meta = { slot: "components.native-action", source: { kind: "registry", ref: ["synthetic/item"], license: "MIT" }, element: {} };
    w.put(w.agent("designer", "components.native-action", "candidates", "native-action-v1.json"), `${JSON.stringify({ meta, content: jsonContent() }, null, 2)}\n`);
    const plan = planRecut(w.root, { at: AT });
    const finding = plan.slotFindings.find(line => line.startsWith("designer/components.button:"));
    expect(finding).toMatch(/@clossys\/designer defines no slot for it/);
    expect(plan.slots.some(slot => slot.file.includes(join("components.button", "slot.json")))).toBe(false);
    const result = applyRecut(plan);
    expect(result.iaSyncFindings).toContain(finding);
    expect(existsSync(w.agent("designer", "components.button", "slot.json"))).toBe(false);
    expect(existsSync(w.agent("designer", "components.button", "candidates", "native-action-v1.json"))).toBe(true);
    // The rest applied: the Writer target still got its slot.json.
    expect(existsSync(w.agent("writer", "sections.hero.copy", "slot.json"))).toBe(true);
  });
});

describe("migrate recut: every migrated slot.json sits where the recut ia.json places it", () => {
  it("writes each clossys.slot/2 ia from the agent ia.json position after the recut (retired ids move later orders)", () => {
    const w = world();
    w.put(w.agent("writer", "passages.hero", "candidates", "hero-v1.md"), body());
    applyRecut(planRecut(w.root, { at: AT }));
    let checked = 0;
    for (const agent of RECUT_AGENTS) {
      const iaFile = w.agent(agent, "ia.json");
      if (!existsSync(iaFile)) continue;
      const positions = slotPositions(agent, JSON.parse(readFileSync(iaFile, "utf8")) as IaDoc);
      for (const [id, position] of positions) {
        const file = w.agent(agent, id, "slot.json");
        if (!existsSync(file)) continue;
        const doc = JSON.parse(readFileSync(file, "utf8")) as { schema: string; ia: unknown };
        if (doc.schema !== SLOT_SCHEMA) continue;
        expect({ slot: `${agent}/${id}`, ia: doc.ia }).toEqual({ slot: `${agent}/${id}`, ia: positionIa(id, position) });
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe("migrate recut: a Designer candidate keeps its provenance (P2-6)", () => {
  const context = { agent: "designer" as const, slotId: "components.button", at: AT as `${string}Z`, version: "0.0.0", sourceRef: "agents/designer/components.native-action/candidates/native-action-v1.json" };
  const source = (bytes: string) => (readRecordHeader("native-action-v1.json", bytes) as { source: unknown }).source;
  it("carries meta.source as it is (kind, ref, hash, license) into the candidate/1 header source", () => {
    const meta = { slot: "components.native-action", source: { kind: "registry", ref: ["synthetic/item"], hash: HASH, license: "MIT" }, element: {} };
    const bytes = recutCandidateBytes("native-action-v1.json", `${JSON.stringify({ meta, content: jsonContent() }, null, 2)}\n`, context as never);
    expect(source(bytes)).toEqual(meta.source);
    expect((JSON.parse(bytes) as { content: unknown }).content).toEqual({ meta: { slot: meta.slot, element: {} }, content: jsonContent() });
  });
  it("falls back to meta.element.source, and to a derived source only when no source is present", () => {
    const element = { source: { kind: "original", ref: [] } };
    const fromElement = recutCandidateBytes("native-action-v1.json", `${JSON.stringify({ meta: { element }, content: jsonContent() })}\n`, context as never);
    expect(source(fromElement)).toEqual({ kind: "original", ref: [] });
    const none = recutCandidateBytes("native-action-v1.json", `${JSON.stringify({ meta: { element: {} }, content: jsonContent() })}\n`, context as never);
    expect(source(none)).toEqual({ kind: "derived", ref: [context.sourceRef] });
  });
  it("keeps a composition's parts, and fails a source the header cannot hold instead of making it derived", () => {
    const composition = { kind: "composition", ref: [], parts: [{ slot: "components.button", files: ["registry/aria-nova/ui/button.tsx"] }] };
    expect(source(recutCandidateBytes("native-action-v1.json", JSON.stringify({ meta: { source: composition }, name: "x" }), context as never))).toEqual(composition);
    for (const bad of [{ kind: "registry", ref: ["synthetic/item"], hash: 5 }, { kind: "registry", ref: ["synthetic/item"], extra: true }, { kind: "nope", ref: [] }]) {
      expect(() => recutCandidateBytes("native-action-v1.json", JSON.stringify({ meta: { source: bad }, name: "x" }), context as never)).toThrow(/not a valid clossys\.candidate\/1/);
    }
  });
});

/**
 * Review r1 P1-3: the recut moves only the source. Everything else an int2 candidate carries stays where the
 * current readers read it, through the candidate view: the view of the recut bytes is the int2 candidate.
 */
describe("migrate recut: nothing but the source moves (P1-3)", () => {
  const at = AT as `${string}Z`;
  const ctx = (agent: "director" | "designer" | "writer", slotId: string, name: string) => ({ agent, slotId, at, version: "0.0.0", sourceRef: `agents/${agent}/${slotId}/candidates/${name}` });
  const FRONTS = /^---$/gm;
  it("keeps a Designer registry item's meta (refVerbatim, element reads and reason, vary, slot, catalog, preview)", () => {
    const int2 = {
      name: "hero", type: "registry:block", files: [{ path: "hero.tsx", type: "registry:block", content: "export {}\n" }],
      meta: {
        catalog: { group: "sections" }, preview: { copy: "site.hero.title" }, slot: "sections.hero",
        source: { kind: "registry", ref: ["shadcn-aria/hero"], hash: HASH, license: "MIT" },
        element: { reads: { copyKeys: ["site.hero.title", { slot: "title", prop: "title", previewKey: "site.hero.title" }] }, reason: "director/advantage.proposition.promise" },
        refVerbatim: { files: { "hero.tsx": "registry/aria-nova/blocks/hero.tsx" } }, vary: { layout: "split" },
      },
    };
    const name = "hero-v1.json";
    const bytes = recutCandidateBytes(name, JSON.stringify(int2), ctx("designer", "sections.hero", name) as never);
    expect((readRecordHeader(name, bytes) as { source: unknown }).source).toEqual(int2.meta.source);
    expect(JSON.parse(bytes).content.meta.source).toBeUndefined();
    expect(JSON.parse(candidateView(name, bytes))).toEqual(int2);
    expect(recutCandidateBytes(name, bytes, ctx("designer", "sections.hero", name) as never)).toBe(bytes);
  });
  it("keeps a Writer file's reason and locales and a brief's feeds, functions, note and vary in its one front matter", () => {
    const strings = serializeFrontmatter({ slot: "lexicon.avoid-terms", locales: ["en"], source: { kind: "derived", ref: ["synthetic/strings"] }, reason: "director/advantage.proposition.promise" }, '## en\n### avoid.one\n<!-- {"id":"avoid-one","bindings":[]} -->\nNever.\n');
    const brief = serializeFrontmatter({ slot: "advantage.proposition.promise", source: { kind: "original", ref: [] }, feeds: ["designer"], functions: ["gtm"], note: "Kept \"as is\".", vary: { tone: "plain" } }, body());
    const reasonOnly = serializeFrontmatter({ slot: "lexicon.avoid-terms", source: { kind: "original", ref: [] }, reason: "director/advantage.proposition.promise" }, "## en\n");
    for (const [agent, slotId, int2] of [["writer", "lexicon.avoid-terms", strings], ["director", "advantage.proposition.promise", brief], ["writer", "lexicon.avoid-terms", reasonOnly]] as const) {
      const name = "kept-v1.md";
      const bytes = recutCandidateBytes(name, int2, ctx(agent, slotId, name) as never);
      expect(bytes.match(FRONTS)).toHaveLength(2);
      expect(bytes.endsWith(parseFrontmatter(int2).ok ? (parseFrontmatter(int2) as { value: { body: string } }).value.body : "")).toBe(true);
      const view = parseFrontmatter(candidateView(name, bytes));
      const before = parseFrontmatter(int2);
      expect(view.ok && before.ok).toBe(true);
      if (view.ok && before.ok) expect(view.value).toEqual(before.value);
      expect(recutCandidateBytes(name, bytes, ctx(agent, slotId, name) as never)).toBe(bytes);
    }
  });
  it("moves the int2 slot field with a moved candidate, like the header, and keeps any other value for the kind rules", () => {
    const moved = { ...ctx("writer", "sections.hero.copy", "hero-v1.md"), movedFrom: "passages.hero" };
    const md = serializeFrontmatter({ slot: "passages.hero", locales: ["en"], source: { kind: "original", ref: [] } }, "## en\n");
    expect(parseFrontmatter(candidateView("hero-v1.md", recutCandidateBytes("hero-v1.md", md, moved as never)))).toMatchObject({ ok: true, value: { fields: { slot: "sections.hero.copy", locales: ["en"] } } });
    const stale = md.replace('"passages.hero"', '"strings.other"');
    expect(parseFrontmatter(candidateView("hero-v1.md", recutCandidateBytes("hero-v1.md", stale, moved as never)))).toMatchObject({ ok: true, value: { fields: { slot: "strings.other" } } });
    const live = recutCandidateBytes("hero-v1.md", stale, ctx("writer", "sections.hero.copy", "hero-v1.md") as never);
    expect(parseFrontmatter(candidateView("hero-v1.md", live))).toMatchObject({ ok: true, value: { fields: { slot: "strings.other" } } });
    const json = JSON.stringify({ name: "x", meta: { slot: "components.native-action", source: { kind: "original", ref: [] } } });
    const element = { ...ctx("designer", "components.button", "x-v1.json"), movedFrom: "components.native-action" };
    expect(JSON.parse(candidateView("x-v1.json", recutCandidateBytes("x-v1.json", json, element as never))).meta.slot).toBe("components.button");
  });
});
