/**
 * foundry-build-0032 (audit P6 and P13): the Studio and flow piece ids are recorded as retired in Designer data. They are
 * not IA leaves, so they sit in src/catalog/retired-pieces.json beside retired.json. Data only: no Studio code is removed
 * here (that is its own unit), and no Publisher page or layout places a flow piece, so all seven retire.
 */
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import componentSlots from "./slots/components.json" with { type: "json" };
import sectionSlots from "./slots/sections.json" with { type: "json" };
import frameSlots from "./slots/frames.json" with { type: "json" };
import { DESIGNER_RETIRED_PIECES, DESIGNER_TREES, retiredPieceFindings, type RetiredPieces } from "./ia/tree.js";

const here = dirname(fileURLToPath(import.meta.url));
const piecesDir = join(here, "..", "..", "ui", "pieces");
const pieceFolders = existsSync(piecesDir) ? readdirSync(piecesDir).filter(name => !name.startsWith(".")).sort() : [];
type SlotRow = { id: string; requires?: readonly string[]; contract: { composes?: readonly string[]; allowedComposes?: readonly string[] } };
const slots = [...componentSlots, ...sectionSlots, ...frameSlots] as unknown as SlotRow[];
const slotIds = slots.map(slot => slot.id);
const references = new Map(slots.map(slot => [slot.id, [...(slot.requires ?? []), ...(slot.contract.composes ?? []), ...(slot.contract.allowedComposes ?? [])]]));
const check = (register: RetiredPieces, extra: Partial<Parameters<typeof retiredPieceFindings>[2]> = {}) =>
  retiredPieceFindings(register, DESIGNER_TREES, { slotIds, pieceFolders, references, ...extra });
const ids = (prefix: string) => DESIGNER_RETIRED_PIECES.pieces.map(piece => piece.id).filter(id => id.startsWith(prefix));

describe("retired piece register (audit P6, P13)", () => {
  it("records 30 Studio ids and 7 flow ids, and the register is sound", () => {
    expect(DESIGNER_RETIRED_PIECES.pieces).toHaveLength(37);
    expect(ids("components.flow.")).toHaveLength(7);
    expect(ids("components.studio.")).toHaveLength(9);
    expect(ids("frames.studio-shell")).toEqual(["frames.studio-shell"]);
    expect(ids("sections.studio.").length + ids("sections.module.").length + ids("sections.producer.").length).toBe(20);
    expect(check(DESIGNER_RETIRED_PIECES)).toEqual([]);
  });

  it("covers every Designer piece folder", () => {
    expect(pieceFolders.length).toBeGreaterThan(0);
    for (const folder of pieceFolders) expect(ids(folder), folder).toEqual([folder]);
  });

  it("rejects a dropped folder record, a placed leaf, a duplicate and a live contract that names a piece (mutations)", () => {
    const pieces = DESIGNER_RETIRED_PIECES.pieces;
    const dropped = { ...DESIGNER_RETIRED_PIECES, pieces: pieces.filter(piece => piece.id !== "components.flow.canvas") };
    expect(check(dropped)).toEqual(["components.flow.canvas: piece folder is not recorded in retired-pieces.json"]);
    const placed = { ...DESIGNER_RETIRED_PIECES, pieces: [...pieces, { ...pieces[0]!, id: "sections.hero" }] };
    expect(check(placed)).toEqual(["sections.hero: a placed leaf retires through retired.json, not the piece register", "sections.hero: registered as a slot"]);
    const twice = { ...DESIGNER_RETIRED_PIECES, pieces: [...pieces, pieces[0]!] };
    expect(check(twice)).toEqual([`${pieces[0]!.id}: recorded more than once`]);
    const unsigned = { ...DESIGNER_RETIRED_PIECES, pieces: pieces.map((piece, index) => index ? piece : { ...piece, decidedBy: "" }) };
    expect(check(unsigned)).toEqual([`${pieces[0]!.id}: no decidedBy`]);
    const reading = new Map(references).set("sections.stats", ["components.flow.edge"]);
    expect(check(DESIGNER_RETIRED_PIECES, { references: reading })).toEqual(["sections.stats: names retired piece components.flow.edge"]);
  });
});
