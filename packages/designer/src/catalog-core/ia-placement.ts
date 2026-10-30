import { isValidId, LAYERS } from "./ids.js";

/** IA diagnostics are structural registry findings, separate from runtime fill checks. */
export interface IAPlacementFinding {
  code: "IA1" | "IA2";
  severity: "error";
  subject: string;
  message: string;
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const facet = /^(?:scale|role|tier|library|libraries|lifecycle|draft|stable|foundry|shadcn|adopted|authored|derived|composed)$/i;

/** Cross-references show a leaf of another layer inside this tree without moving its home placement.
 * Each reference names an existing group or family and a nonempty list of foreign-layer slot ids.
 */
function crossReferenceCounts(placement: Record<string, unknown>, layer: string, nodes: ReadonlySet<string>, add: (code: IAPlacementFinding["code"], subject: string, message: string) => void): Map<string, number> {
  const counts = new Map<string, number>();
  if (!Object.hasOwn(placement, "crossReferences")) return counts;
  const rows = placement.crossReferences;
  if (!Array.isArray(rows)) { add("IA1", `${layer}.crossReferences`, "IA1: cross-references must be an array"); return counts; }
  for (const [index, row] of rows.entries()) {
    const subject = `${layer}.crossReferences.${index}`;
    if (!object(row) || typeof row.node !== "string") { add("IA1", subject, "IA1: a cross-reference needs a node and leaves"); continue; }
    if (!nodes.has(row.node)) add("IA1", subject, `IA1: cross-reference to unknown node ${row.node}`);
    if (!Array.isArray(row.leaves) || !row.leaves.length) { add("IA1", subject, "IA1: cross-references must contain nonempty leaf arrays"); continue; }
    for (const id of row.leaves) {
      if (typeof id !== "string" || !isValidId("slot", id)) { add("IA1", subject, `IA1: invalid cross-reference ${String(id)}`); continue; }
      if (id.startsWith(`${layer}.`)) add("IA1", id, `IA1: cross-reference ${id} names its own layer`);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/** IA1: each registered leaf occurs once at L3; IA2: branches never mix children and leaves. */
export function checkIAPlacement(placement: unknown, expectedLeafIds?: readonly string[]): IAPlacementFinding[] {
  const findings: IAPlacementFinding[] = [];
  const add = (code: IAPlacementFinding["code"], subject: string, message: string): void => { findings.push({ code, severity: "error", subject, message }); };
  if (!object(placement) || typeof placement.layer !== "string" || !LAYERS.some(layer => layer === placement.layer) || !Array.isArray(placement.nodes)) {
    add("IA1", "placement", "IA1: expected a known layer and L1 group array");
    return findings;
  }
  const layer = placement.layer;
  const seenNodes = new Set<string>();
  const leafCounts = new Map<string, number>();
  const expected = expectedLeafIds === undefined ? undefined : new Set(expectedLeafIds);
  const walk = (nodes: readonly unknown[], depth: number): void => {
    for (const [index, value] of nodes.entries()) {
      const subject = `${layer}.${object(value) && typeof value.id === "string" ? value.id : index}`;
      if (!object(value)) { add("IA1", subject, "IA1: expected a group or family node"); continue; }
      if (typeof value.id !== "string" || !value.id || typeof value.label !== "string" || !value.label.trim()) add("IA1", subject, "IA1: every group and family needs an id and label");
      else {
        if (seenNodes.has(value.id)) add("IA1", subject, "IA1: duplicate group or family id");
        seenNodes.add(value.id);
        if (facet.test(value.id) || facet.test(value.label)) add("IA1", subject, "IA1: facets cannot be groups or families");
      }
      const children = Object.hasOwn(value, "children");
      const leaves = Object.hasOwn(value, "leaves");
      if (children && leaves) add("IA2", subject, "IA2: a node cannot hold both children and leaves");
      if (depth === 1 ? !children || leaves : depth === 2 ? !leaves || children : true) add("IA1", subject, "IA1: expected L1 group > L2 family > L3 leaf");
      if (children) {
        if (!Array.isArray(value.children) || !value.children.length) add("IA1", subject, "IA1: groups must contain nonempty family arrays");
        else if (depth < 3) walk(value.children, depth + 1);
      }
      if (leaves) {
        if (!Array.isArray(value.leaves) || !value.leaves.length) add("IA1", subject, "IA1: families must contain nonempty leaf arrays");
        else for (const id of value.leaves) {
          if (typeof id !== "string" || !isValidId("slot", id) || !id.startsWith(`${layer}.`)) { add("IA1", subject, `IA1: invalid leaf ${String(id)}`); continue; }
          leafCounts.set(id, (leafCounts.get(id) ?? 0) + 1);
          if (expected && !expected.has(id)) add("IA1", id, `IA1: unregistered leaf ${id}`);
        }
      }
    }
  };
  if (!placement.nodes.length && (!expected || expected.size)) add("IA1", layer, "IA1: registered layers need groups and families");
  walk(placement.nodes, 1);
  for (const [id, count] of crossReferenceCounts(placement, layer, seenNodes, add)) if (count !== 1) add("IA1", id, `IA1: leaf ${id} is cross-referenced ${count} times`);
  for (const [id, count] of leafCounts) if (count !== 1) add("IA1", id, `IA1: leaf ${id} appears ${count} times`);
  for (const id of expected ?? []) if (!leafCounts.has(id)) add("IA1", id, `IA1: missing leaf ${id}`);
  return findings.sort((a, b) => a.subject.localeCompare(b.subject) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
}

/** Source guard used before a runtime or build catalog offers its placement trees. */
export function assertIAPlacements(placements: readonly { layer: string }[], slots: readonly { id: string; layer: string }[]): void {
  const findings = placements.flatMap(placement => checkIAPlacement(placement, slots.filter(slot => slot.layer === placement.layer).map(slot => slot.id)));
  // A cross-referenced leaf keeps one home placement in its own layer and at most one reference elsewhere.
  const registered = new Set(slots.map(slot => slot.id));
  const references = new Map<string, number>();
  for (const placement of placements) {
    const rows = (placement as { crossReferences?: unknown }).crossReferences;
    if (Array.isArray(rows)) for (const row of rows) if (object(row) && Array.isArray(row.leaves)) for (const id of row.leaves) if (typeof id === "string") references.set(id, (references.get(id) ?? 0) + 1);
  }
  for (const [id, count] of references) {
    if (!registered.has(id)) findings.push({ code: "IA1", severity: "error", subject: id, message: `IA1: unregistered cross-reference ${id}` });
    if (count > 1) findings.push({ code: "IA1", severity: "error", subject: id, message: `IA1: leaf ${id} is cross-referenced ${count} times` });
  }
  for (const layer of new Set(slots.map(slot => slot.layer))) if (placements.filter(placement => placement.layer === layer).length !== 1) findings.push({ code: "IA1", severity: "error", subject: layer, message: `IA1: expected one placement tree for ${layer}` });
  if (findings.length) throw new Error(findings.map(finding => `${finding.subject}: ${finding.message}`).join("; "));
}
