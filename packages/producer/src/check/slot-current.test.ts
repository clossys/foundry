/**
 * foundry-build-0031: `clossys check` judges a recut consumer (clossys.slot/2). Synthetic: a tmp copy of
 * test-fixtures/consumer, recut in tmp, then the slot resolve that `clossys check` runs.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PRODUCER_ROOT } from "../package-path.js";
import { applyRecut, planRecut, recutCandidateBytes } from "../migrate/recut.js";
import { checkSlotModel } from "../records/slot-check.js";
import { OLD_SLOT_FORMAT, candidateView } from "../records/slot-current.js";
import { serializeFrontmatter } from "../records/slot-model/frontmatter.js";
import type { SlotAgent } from "../records/slot-model/types.js";
import { runSlotResolve } from "./slot-resolve.js";

const AT = "2026-11-15T10:00:00Z";
let root: string | undefined;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = undefined; });

function recut() {
  root = mkdtempSync(join(tmpdir(), "check-current-"));
  const consumer = join(root, "clossys");
  cpSync(join(PRODUCER_ROOT, "test-fixtures", "consumer", "clossys"), consumer, { recursive: true });
  const slot = join(consumer, "agents", "director", "advantage.proposition.promise", "slot.json");
  const before = readFileSync(slot, "utf8");
  applyRecut(planRecut(root, { at: AT }));
  return { consumer, slot, before };
}

describe("clossys check on a recut consumer (current slot format)", () => {
  it("judges it: no schema-version rows, no unreadable inputs, no missing slot.json", async () => {
    const w = recut();
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
    const w = recut();
    writeFileSync(w.slot, w.before);
    const result = await runSlotResolve(w.consumer);
    const old = result.findings.filter(row => row.message === OLD_SLOT_FORMAT);
    expect(old).toHaveLength(1);
    expect(result.findings.filter(row => /advantage\.proposition\.promise/.test(row.path ?? "") && /schema must be/.test(row.message))).toEqual([]);
  });
});

/**
 * Review r1 P1-1: a current-format candidate is judged by every rule of its kind, not by its header alone.
 * Each candidate is written as `clossys migrate recut` writes it (int2 bytes through recutCandidateBytes), into a
 * slot of the recut fixture; each defect is one the old (slot/1) rules found, and is still a finding.
 */
describe("a current-format candidate keeps every rule of its kind", () => {
  const original = { kind: "original", ref: [] };
  const slots: Record<"brief" | "element" | "strings", [SlotAgent, string]> = {
    brief: ["director", "advantage.proposition.promise"],
    element: ["designer", "components.badge"],
    strings: ["writer", "lexicon.avoid-terms"],
  };
  const brief = "## Direction\n- who: Owners\n\n## Because\n- why: Time\n\n## Watch\n- risk: Scope\n";
  const item = { name: "badge", type: "registry:ui", files: [{ path: "badge.tsx", type: "registry:ui", content: "export const Badge = () => null\n" }] };
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
    const w = recut();
    const ok = judge(w.consumer, "brief", "clean-v1.md", serializeFrontmatter({ slot: slots.brief[1], source: original, feeds: [], functions: ["gtm"], note: "kept" }, brief));
    expect(ok.found).toEqual([]);
    expect(ok.bytes.match(/^---$/gm)).toHaveLength(2);
    expect(candidateView("clean-v1.md", ok.bytes)).toContain('functions: ["gtm"]');
    expect(judge(w.consumer, "element", "clean-v1.json", JSON.stringify({ ...item, meta: { source: original } })).found).toEqual([]);
    expect(judge(w.consumer, "strings", "clean-v1.md", serializeFrontmatter({ slot: slots.strings[1], locales: ["en"], source: original, reason: "director/advantage.proposition.promise" }, '## en\n### avoid.one\n<!-- {"id":"avoid-one","bindings":[]} -->\nNever say synergy.\n')).found).toEqual([]);
  });

  it("a brief with no sections is a finding", () => {
    const w = recut();
    expect(judge(w.consumer, "brief", "bare-v1.md", serializeFrontmatter({ slot: slots.brief[1], source: original, feeds: [], functions: [] }, "Just prose.\n")).found)
      .toContain("candidate-invalid: body must be ## Direction, ## Because, ## Watch");
  });

  it("a brief saved as .json is a finding", () => {
    const w = recut();
    expect(judge(w.consumer, "brief", "brief-v1.json", JSON.stringify({ text: brief, meta: { source: original } })).found).toContain("candidate-name: brief candidates are .md");
  });

  it("an element that is no registry item, with a registry source and no ref, is a finding for each", () => {
    const w = recut();
    const found = judge(w.consumer, "element", "nope-v1.json", JSON.stringify({ nope: true, meta: { source: { kind: "registry", ref: [] } } })).found;
    expect(found).toContain("candidate-invalid: registry-item name is required");
    expect(found).toContain("candidate-source: source.kind registry needs at least one ref");
  });

  it("pin state at the top level of a candidate is a finding (JSON beside the header, Markdown front matter)", () => {
    const w = recut();
    const json = judge(w.consumer, "element", "state-v1.json", JSON.stringify({ ...item, meta: { source: original } }), bytes => JSON.stringify({ ...JSON.parse(bytes), status: "active", pinned: true })).found;
    expect(json).toContain("candidate-status: status is pin state; pinning lives only in pin.json");
    expect(json).toContain("candidate-status: pinned is pin state; pinning lives only in pin.json");
    const md = judge(w.consumer, "brief", "state-v1.md", serializeFrontmatter({ slot: slots.brief[1], source: original, feeds: [], functions: [], status: "active" }, brief)).found;
    expect(md).toContain("candidate-status: frontmatter status is pin state; pinning lives only in pin.json");
  });

  it("a Writer record carrying leaf, a bad vary and a second source beside the header are findings", () => {
    const w = recut();
    expect(judge(w.consumer, "strings", "leaf-v1.md", serializeFrontmatter({ slot: slots.strings[1], locales: ["en"], source: original }, '## en\n### avoid.one\n<!-- {"id":"avoid-one","bindings":[],"leaf":"lexicon.avoid-terms"} -->\nNever.\n')).found)
      .toContain("candidate-invalid: record avoid.one carries leaf; the slot is the leaf");
    expect(judge(w.consumer, "element", "vary-v1.json", JSON.stringify({ ...item, meta: { source: original, vary: { tone: "loud", size: "big" } } })).found)
      .toContain('candidate-invalid: meta.vary must be {"<axis>": "<value>"} with one axis');
    expect(judge(w.consumer, "brief", "second-v1.md", serializeFrontmatter({ slot: slots.brief[1], source: original, feeds: [], functions: [] }, brief), bytes => bytes.replace("\nslot: ", `\nsource: ${JSON.stringify(original)}\nslot: `)).found)
      .toContain("candidate-source: source is the clossys header's; the candidate carries a second one");
    expect(existsSync(join(w.consumer, "agents", "writer", "lexicon.avoid-terms", "candidates", "leaf-v1.md"))).toBe(false);
  });
});
