/**
 * foundry-build-0032 (owner 2026-11-16, "go with your recommendation"; ia-audit 2026-11-16 P2 and P12).
 * P2: 14 of the 15 units Writer listed as awaiting now declare copy.fields, so Writer can derive one Copy slot each. The
 * fields are draft shapes (the slot records stay status draft); no copy string is written here. The fifteenth,
 * sections.sectioned-document, stays copy-less by its pinned design: its words are its own records and its only member is
 * landmark.none (section-copy.test.ts, library-cli/sectioned-document.test.ts), so Writer drops it from the awaiting list.
 * P12: the entity icons dedupe into assets.icon-organization with business and institution configs.
 */
import { describe, expect, it } from "vitest";
import assetSlots from "./slots/assets.json" with { type: "json" };
import componentSlots from "./slots/components.json" with { type: "json" };
import frameSlots from "./slots/frames.json" with { type: "json" };
import sectionSlots from "./slots/sections.json" with { type: "json" };
import assetContracts from "./slot-contracts/assets.json" with { type: "json" };
import componentContracts from "./slot-contracts/components.json" with { type: "json" };
import frameContracts from "./slot-contracts/frames.json" with { type: "json" };
import sectionContracts from "./slot-contracts/sections.json" with { type: "json" };
import { checkCopyFieldRoles, type CopyUnit } from "../check/copy-fields-role.js";
import { DESIGNER_RETIRED, DESIGNER_TREES, checkTree, type LayerTree } from "./ia/tree.js";

const AWAITING = [
  "components.command", "components.breadcrumbs", "components.sidebar", "components.media-player", "components.dialog", "components.sheet",
  "frames.site-header", "frames.site-footer", "frames.app-header", "frames.app-sidebar",
  "assets.lockup", "assets.mark", "assets.image", "assets.video",
];
const units = [...componentSlots, ...sectionSlots, ...frameSlots, ...assetSlots] as unknown as (CopyUnit & { contract: { copy?: { sourceLocale?: string } } })[];
const contracts = [...componentContracts, ...sectionContracts, ...frameContracts, ...assetContracts] as unknown as { slot: string; inputs: { name: string; kind: string }[]; limits: Record<string, unknown> }[];
const unit = (id: string) => units.find(candidate => candidate.id === id)!;

describe("copy fields for the 14 awaiting units (audit P2)", () => {
  it("each unit declares en copy fields that carry a role inside its budget", () => {
    for (const id of AWAITING) {
      expect(unit(id).contract.copy?.sourceLocale, id).toBe("en");
      expect(unit(id).contract.copy?.fields?.length, id).toBeGreaterThan(0);
    }
    expect(checkCopyFieldRoles(AWAITING.map(unit))).toEqual([]);
    expect(AWAITING).toHaveLength(14);
    const document = unit("sections.sectioned-document").contract as unknown as { copy: { fields: unknown[] }; members: { names: string[] } };
    expect(document.copy.fields).toEqual([]);
    expect(document.members.names).toEqual(["landmark.none"]);
  });

  it("the generated contract lists each copy field as a copy input with its en budget", () => {
    for (const id of AWAITING) {
      const record = contracts.find(row => row.slot === id)!;
      for (const field of unit(id).contract.copy!.fields!) {
        expect(record.inputs, `${id}#${field.key}`).toContainEqual(expect.objectContaining({ name: field.key, kind: "copy" }));
        expect(record.limits[`${field.key}.maxLength.en`], `${id}#${field.key}`).toBe(field.maxLength!.en);
      }
    }
  });

  it("mutation: a field over its role budget or without a role fails", () => {
    const sheet = structuredClone(unit("components.sheet"));
    sheet.contract.copy!.fields![0]!.maxLength = { en: 25 };
    expect(checkCopyFieldRoles([sheet]).map(finding => finding.message)).toEqual(["components.sheet#close.label: maxLength.en 25 is over the action budget 24"]);
    const header = structuredClone(unit("frames.site-header"));
    delete (header.contract.copy!.fields![0] as { role?: unknown }).role;
    expect(checkCopyFieldRoles([header]).map(finding => finding.code)).toEqual(["COPY_ROLE_MISSING"]);
  });
});

describe("entity icons dedupe into assets.icon-organization (audit P12)", () => {
  it("organization carries business and institution configs; the other two retire into it", () => {
    const organization = unit("assets.icon-organization").contract as unknown as { members: { names: string[] }; optional: string[] };
    expect(organization.members.names).toEqual(["default", "business", "institution"]);
    expect(organization.optional).toEqual(["business", "institution"]);
    for (const id of ["assets.icon-business", "assets.icon-institution"]) {
      expect(DESIGNER_RETIRED.find(entry => entry.id === id)?.replacedBy, id).toBe("assets.icon-organization");
    }
  });

  it("mutation: a retired icon not flagged in ia/assets.json fails", () => {
    const trees = structuredClone(DESIGNER_TREES) as LayerTree[];
    const assets = trees.find(layer => layer.layer === "assets") as { retired: string[] };
    assets.retired = assets.retired.filter(id => id !== "assets.icon-business");
    expect(checkTree(trees, DESIGNER_RETIRED)).toContain("assets.icon-business: retired in retired.json but not flagged in ia/assets.json");
  });
});
