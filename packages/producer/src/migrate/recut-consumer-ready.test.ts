/**
 * foundry-build-0031: after `clossys migrate recut --apply` the consumer is one `clossys check` can judge.
 * Synthetic: a tmp copy of test-fixtures/consumer, seeded in tmp with package default bodies (shape only).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PRODUCER_ROOT } from "../package-path.js";
import { readRecordHeader } from "../records/schema.js";
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
  cpSync(join(PRODUCER_ROOT, "test-fixtures", "consumer", "clossys"), join(root, "clossys"), { recursive: true });
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
  it("carries meta.source (kind, ref, license and hash) into the candidate/1 header source", () => {
    const meta = { slot: "components.native-action", source: { kind: "registry", ref: ["synthetic/item"], hash: HASH, license: "MIT" }, element: {} };
    const bytes = recutCandidateBytes("native-action-v1.json", `${JSON.stringify({ meta, content: jsonContent() }, null, 2)}\n`, context as never);
    const header = readRecordHeader("native-action-v1.json", bytes) as { source: unknown };
    expect(header.source).toEqual({ kind: "registry", ref: ["synthetic/item", JSON.stringify({ hash: HASH })], license: "MIT" });
    expect((JSON.parse(bytes) as { content: unknown }).content).toEqual(jsonContent());
  });
  it("falls back to meta.element.source, and to a derived source only when neither is valid", () => {
    const element = { source: { kind: "original", ref: [] } };
    const fromElement = recutCandidateBytes("native-action-v1.json", `${JSON.stringify({ meta: { element }, content: jsonContent() })}\n`, context as never);
    expect((readRecordHeader("native-action-v1.json", fromElement) as { source: unknown }).source).toEqual({ kind: "original", ref: [] });
    const none = recutCandidateBytes("native-action-v1.json", `${JSON.stringify({ meta: { element: {} }, content: jsonContent() })}\n`, context as never);
    expect((readRecordHeader("native-action-v1.json", none) as { source: unknown }).source).toEqual({ kind: "derived", ref: [context.sourceRef] });
  });
});
