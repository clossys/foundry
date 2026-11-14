import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reader } from "../../test/store.js";
import { stageSlot, strategyRoot } from "../__fixtures__/slot-model.js";
import { readStrategyRoot } from "../store.js";
import { parseSlotCitation, slotCitationsInText, versionedCitation, versionedCitationsInText } from "./citation.js";
import { slotCandidateCell } from "./slot.js";

const NEED = "context.customer.need", PROMISE = "advantage.proposition.promise";
const owner = (slot: string) => slot === NEED ? "director" as const : slot === "copy.hero" ? "writer" as const : undefined;
/** Candidate bytes as written (no fixture rewriting), so the retired versioned form can be staged. */
const candidate = (refs: readonly string[], because: string) => [
  "---", `slot: ${JSON.stringify(PROMISE)}`, `source: ${JSON.stringify({ kind: "derived", ref: refs })}`, "feeds: []", "functions: []", "---", "",
  "## Direction", "- Promise: Ship in a day.", "", "## Because", `- ${because}`, "", "## Watch", "- If churn > 5% each month, then review.", "",
].join("\n");

describe("slot citations (planner D2)", () => {
  it("parses a slot id or `<agent>:<slot>`; the versioned form is not a citation", () => {
    expect(parseSlotCitation(NEED)).toEqual({ slot: NEED });
    expect(parseSlotCitation(`director:${NEED}`)).toEqual({ agent: "director", slot: NEED });
    expect(parseSlotCitation(`${NEED}@2`)).toBeUndefined();
    expect(versionedCitation(`writer:copy.hero@3`)).toEqual({ agent: "writer", slot: "copy.hero", version: 3, text: "writer:copy.hero@3" });
  });

  it("rewrites versioned citations of known slots only, idempotently", () => {
    const text = `Cites ${NEED}@2 and writer:copy.hero@3; not react@18.3.1, npm/x@1.2.3, @scope/copy.hero@1, strategy:${NEED}@2 or designer:${NEED}@1.`;
    const once = slotCitationsInText(text, owner);
    expect(once).toEqual({ text: `Cites ${NEED} and writer:copy.hero; not react@18.3.1, npm/x@1.2.3, @scope/copy.hero@1, strategy:${NEED}@2 or designer:${NEED}@1.`, count: 2 });
    expect(slotCitationsInText(once.text, owner)).toEqual({ text: once.text, count: 0 });
    expect(versionedCitationsInText(once.text).map(row => row.text)).toEqual([`designer:${NEED}@1`]);
  });

  it("leaves line anchors versioned: a line number only means something in one version's bytes", () => {
    const text = `Voice (${NEED}@2). <!-- {"id":"x","directorSources":[{"ref":"director:${NEED}@2","line":12}]} --> trait director:${NEED}@2#direction-L18, obligation director:${NEED}@2#L9.`;
    const once = slotCitationsInText(text, owner);
    expect(once.count).toBe(1);
    expect(once.text).toBe(text.replace(`(${NEED}@2)`, `(${NEED})`));
    expect(versionedCitationsInText(once.text)).toEqual([]);
  });

  it("resolves a candidate's slot citation through the pin, and refuses the versioned form", () => {
    const bytes = candidate([NEED], `Teams lose a day a week (${NEED}).`);
    const cell = (resolve: (slot: string) => number | undefined) => slotCandidateCell({ id: PROMISE, version: 1, updated: "2026-11-01", path: "p", bytes, resolve });
    expect(cell(() => 2).cites).toEqual([{ kind: "cell", ref: { cell: NEED, version: 2 } }]);
    expect(cell(() => 5).because[0]!.refs).toEqual([{ kind: "cell", ref: { cell: NEED, version: 5 } }]);
    // Unpinned: version 0, which no cell has, so the check reports it unresolved.
    expect(cell(() => undefined).cites).toEqual([{ kind: "cell", ref: { cell: NEED, version: 0 } }]);
    expect(() => slotCandidateCell({ id: PROMISE, version: 1, updated: "2026-11-01", path: "p", bytes: candidate([`${NEED}@1`], `Observed (${NEED}@1).`), resolve: () => 1 }))
      .toThrow(`p: versioned citation ${NEED}@1`);
  });

  it("a re-pin of the cited slot re-addresses the citing cell without touching it", () => {
    const base = mkdtempSync(join(tmpdir(), "director-citation-"));
    try {
      const root = strategyRoot(base);
      stageSlot(root, NEED, 1, "Need: Teams of 20 lose a day a week.");
      stageSlot(root, PROMISE, 1, "Promise: Ship in a day.", { refs: [`${NEED}@1`], because: [`Teams lose a day a week (${NEED}@1).`] });
      expect(readStrategyRoot(root, reader).cells.find(c => c.id === PROMISE)!.cites).toEqual([{ kind: "cell", ref: { cell: NEED, version: 1 } }]);
      stageSlot(root, NEED, 2, "Need: Teams of 50 lose two days a week.");
      const model = readStrategyRoot(root, reader);
      expect(model.issues).toEqual([]);
      expect(model.cells.find(c => c.id === PROMISE)!.cites).toEqual([{ kind: "cell", ref: { cell: NEED, version: 2 } }]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
