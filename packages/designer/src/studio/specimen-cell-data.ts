import type { ResolvedMember } from "../catalog-core/types.js";
import type { DesignerSpecimenContext, DesignerSpecimenNeed } from "./DesignerSpecimen.js";
import { tokenSpecimenItems, assetSpecimenItems } from "./specimen-token-assets.js";
import { componentSpecimenItems, surfaceSpecimenItems, type SpecimenItemSet } from "./specimen-viewports.js";

/** Parsed native cell data; raw Markdown/file text never becomes specimen presentation. */
export interface DesignerSpecimenCellData {
  readonly id: string;
  readonly status?: "active" | "draft" | "retired";
  /** Exact value-engine result for this cell's active or draft fill, when the projection supplies one. */
  readonly members?: Readonly<Record<string, ResolvedMember>>;
}
export type DesignerSpecimenCellCases = { readonly context: DesignerSpecimenContext; readonly cases: SpecimenItemSet } | DesignerSpecimenNeed;

/** Preserves cell-specific values; a draft without executable native data never borrows an active fill. */
export function designerSpecimenCellData(context: DesignerSpecimenContext, cell: DesignerSpecimenCellData): DesignerSpecimenCellCases {
  let selected = context;
  if (/^(themes|assets)\./.test(cell.id)) {
    if (cell.members !== undefined) {
      const members = Object.entries(cell.members);
      if (!members.length || members.some(([id, member]) => !id.startsWith(`${cell.id}.`) || member.slot !== cell.id)) return { leaf: cell.id, reason: "The cell's resolved members do not belong to its exact native leaf." };
      const current = Object.fromEntries(Object.entries(context.profile.values.members).filter(([, member]) => member.slot !== cell.id));
      selected = { ...context, profile: { ...context.profile, values: { ...context.profile.values, members: { ...current, ...cell.members } } } };
    } else if (cell.status && cell.status !== "active") return { leaf: cell.id, reason: "This draft or retired cell has no cell-specific resolved values." };
    const items = cell.id.startsWith("themes.") ? tokenSpecimenItems(selected, cell.id) : assetSpecimenItems(selected, cell.id);
    return items.length ? { context: selected, cases: { items, axes: [] } } : { leaf: cell.id, reason: "This cell has no resolved value specimens." };
  }
  if (cell.status && cell.status !== "active") return { leaf: cell.id, reason: "This draft or retired cell requires its own descriptor-matched native runtime." };
  const cases = cell.id.startsWith("components.") ? componentSpecimenItems(selected, cell.id) : /^(sections|frames)\./.test(cell.id) ? surfaceSpecimenItems(selected, cell.id) : undefined;
  return cases?.items.length ? { context: selected, cases } : { leaf: cell.id, reason: "This cell has no registered native specimen data." };
}
