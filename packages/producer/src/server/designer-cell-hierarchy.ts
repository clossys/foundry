import type { BuildCatalogData } from "@clossys/designer/catalog";
import { agentModule } from "./cells.js";
import type { CellSummary } from "./contract.js";

export interface DesignerCellGroup {
  id: string;
  name: string;
  children: { id: string; name: string; cells: string[] }[];
}
export interface DesignerCellHierarchy {
  tree: DesignerCellGroup[];
  designerLayers: { id: string; label: string; groups: string[] }[];
  designerSlots: { id: string; layer: string; kind: "token" | "asset" | "component" | "section" | "frame"; valueKind?: string }[];
}

/** Join stored cell identities to the installed Designer's canonical IA.
 * Catalog offerings never become consumer cells, and cross-references never
 * place a cell a second time. The caller retains an existing authored tree. */
export function projectDesignerCellHierarchy(cells: readonly Pick<CellSummary, "id">[], catalog: Pick<BuildCatalogData, "slots" | "placements">): DesignerCellHierarchy {
  if (!cells.length) throw new Error("The consumer has no Designer cells to place.");
  const known = new Set(cells.map(cell => cell.id));
  if (known.size !== cells.length) throw new Error("The Designer cell index contains duplicate identities.");
  const slots = new Map(catalog.slots.map(slot => [slot.id, slot]));
  if (slots.size !== catalog.slots.length) throw new Error("The Designer catalog contains duplicate slots.");
  for (const id of known) if (!slots.has(id)) throw new Error("A Designer cell has no registered native slot.");
  const result: DesignerCellHierarchy = { tree: [], designerLayers: [], designerSlots: [] };
  const placed = new Set<string>(), nodes = new Set<string>(), layers = new Set<string>();
  for (const placement of catalog.placements) {
    if (layers.has(placement.layer)) throw new Error("The Designer catalog repeats a layer.");
    layers.add(placement.layer);
    const layer = { id: placement.layer, label: placement.layer, groups: [] as string[] };
    result.designerLayers.push(layer);
    for (const group of placement.nodes) {
      if (!("children" in group)) throw new Error("The native Designer IA has no L1 grouping.");
      const groupId = `${placement.layer}/${group.id}`;
      if (!group.id || !group.label.trim() || nodes.has(groupId)) throw new Error("A native Designer group is invalid.");
      nodes.add(groupId);
      const projected: DesignerCellGroup = { id: groupId, name: group.label, children: [] };
      for (const family of group.children) {
        if (!("leaves" in family)) throw new Error("The native Designer IA has no L2 grouping.");
        const familyId = `${placement.layer}/${family.id}`;
        if (!family.id || !family.label.trim() || nodes.has(familyId)) throw new Error("A native Designer collection is invalid.");
        nodes.add(familyId);
        const members: string[] = [];
        for (const id of family.leaves) {
          const slot = slots.get(id);
          if (!slot || slot.layer !== placement.layer) throw new Error("A native Designer placement has no matching slot.");
          if (!known.has(id)) continue;
          if (placed.has(id)) throw new Error("The native Designer IA places a cell more than once.");
          placed.add(id);
          members.push(id);
          const contract = slot.contract;
          const valueKind = contract.kind === "token" ? contract.$type : contract.kind === "asset" ? contract.valueKind : undefined;
          result.designerSlots.push({ id, layer: slot.layer, kind: contract.kind, ...(valueKind ? { valueKind } : {}) });
        }
        if (members.length) projected.children.push({ id: familyId, name: family.label, cells: members });
      }
      if (projected.children.length) { result.tree.push(projected); layer.groups.push(groupId); }
    }
  }
  if (placed.size !== known.size) throw new Error("The native Designer IA does not place every consumer cell.");
  return result;
}

/** Resolve the actual installed package rather than a repository-local registry. */
export async function designerCellHierarchy(cells: readonly Pick<CellSummary, "id">[]): Promise<DesignerCellHierarchy> {
  const api = await agentModule("designer", "catalog-core/index.js");
  return projectDesignerCellHierarchy(cells, api.loadBuildCatalog());
}
