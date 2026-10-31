import { describe, expect, it } from "vitest";
import { writerKindSpecimen, writerSpecimenKind } from "./writer-specimen-kinds.js";
import { agentDetailData, agentGalleryLayers } from "../../studio/lib/agent-library";

const rule = (id: string, ruleName: string, value: string) => ({ id, context: `brand.voice.${ruleName}`, kind: "voice-rule", rule: ruleName, value, status: "draft" });
const term = (id: string, value: string, termStatus: string, extra: Record<string, unknown> = {}) => ({ id, context: `brand.x.${id}`, kind: "term", term: value, forms: [], termStatus, ...extra });

describe("Writer specimen kinds", () => {
  it("classifies page copy, voice, claims and naming records", () => {
    expect(writerSpecimenKind([{ id: "s", context: "site.home.title", text: "Hi" }])).toBe("strings");
    expect(writerSpecimenKind([])).toBe("strings");
    expect(writerSpecimenKind([rule("a", "energy", "Calm."), term("b", "npm", "avoid")])).toBe("voice");
    expect(writerSpecimenKind([{ id: "c", kind: "claim", phrasings: ["One loop."] }])).toBe("claims");
    expect(writerSpecimenKind([term("n", "Clossys", "brand")])).toBe("naming");
    expect(writerKindSpecimen("site.home", [{ id: "s", context: "site.home.title", text: "Hi" }])).toBeUndefined();
  });

  it("renders voice as principles plus do and don't words, from the records only", () => {
    const voice = writerKindSpecimen("brand.voice", [rule("a", "sentence-length", "Use short sentences."), term("b", "CLI", "avoid", { forms: ["terminal"], reason: "Plain words." }), term("c", "you", "preferred")])!;
    expect(voice.tables.map(table => table.id)).toEqual(["principles", "do", "dont"]);
    expect(voice.tables[0]!.rows[0]!.cells.map(cell => cell.text)).toEqual(["Sentence length", "Use short sentences."]);
    expect(voice.tables[2]!.rows[0]!.cells.map(cell => cell.text)).toEqual(["CLI", "terminal", "Plain words."]);
    expect(voice.excerpt).toEqual(["Use short sentences.", "Avoid: CLI"]);
  });

  it("renders each claim with its Director evidence and an honest status", () => {
    const claims = writerKindSpecimen("brand.claims", [
      { id: "c1", context: "brand.claims.promise", kind: "claim", status: "draft", strategy: { cell: "advantage.proposition.promise", version: 4 }, phrasings: ["One loop."], requiresCitation: true },
      { id: "c2", context: "brand.claims.unsourced", kind: "claim", status: "draft", phrasings: ["Faster."], requiresCitation: true },
    ])!;
    const [sourced, unsourced] = claims.tables[0]!.rows;
    expect(sourced!.cells[2]).toEqual({ text: "advantage.proposition.promise v4", ref: { label: "advantage.proposition.promise", agent: "director", slug: "advantage.proposition.promise" } });
    expect(sourced!.cells[3]!.status).toBe("draft");
    expect(unsourced!.cells[2]!.text).toBe("No evidence recorded");
    expect(unsourced!.cells[3]).toEqual({ text: "Citation required, no source", status: "missing" });
    expect(claims.summary).toBe("2 claims, 1 with a recorded Director source.");
  });

  it("renders names with their forms and usage rules", () => {
    const names = writerKindSpecimen("brand.naming", [term("name", "Clossys", "brand", { context: "brand.naming.name", reason: "Clossys" }), term("casing", "Clossys", "brand", { context: "brand.naming.casing", reason: "One capital C.", casing: "Clossys" })])!;
    expect(names.tables[0]!.rows.map(row => row.cells.map(cell => cell.text))).toEqual([["Name", "Clossys", "None", "No usage rule recorded"], ["Casing", "Clossys", "None", "One capital C. Casing: Clossys"]]);
    expect(names.excerpt).toEqual(["Clossys"]);
  });

  it("maps tables to detail data and an empty cell to the shared missing status", () => {
    const card = { id: "brand.claims", slug: "brand.claims", name: "Claims", version: 2, status: "active" as const, excerpt: [], records: 0 };
    const leaf = {
      agent: "writer" as const, card, trail: [], statusDetail: [], checks: [], contract: { facts: [], lists: [] }, history: [], uses: [], usedBy: [],
      specimen: { summary: "", rows: [], kind: "claims", tables: [{ id: "claims", label: "Claims", columns: ["Claim"], rows: [{ key: "c1", cells: [{ text: "director:x@1", ref: { label: "x", agent: "director", slug: "x" }, status: "draft" }] }] }] },
    };
    const detail = agentDetailData(leaf).specimen;
    expect(detail.title).toBe("Claims");
    expect(detail.tables![0]!.rows[0]!.cells[0]).toEqual({ text: "director:x@1", href: "/director/x", statusLabel: "Draft", statusTone: "outline" });
    expect(detail.status).toBe("missing");
    const layers = agentGalleryLayers({ state: "ready", agent: "writer", sections: [{ id: "l", label: "L", level: 0, cards: [] }, { id: "g", label: "G", level: 1, cards: [card] }], count: 1 });
    expect(layers[0]!.groups[0]!.cards[0]!.specimenStatus).toBe("missing");
  });
});
