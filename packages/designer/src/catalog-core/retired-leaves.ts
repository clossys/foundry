import type { PlacementNode, Retired } from "./types.js";

/**
 * Global leaf retirement (owner D2 / LAD-1 / LAD-2, 2026-11-11). A retired leaf stays placed and registered so
 * its id is never reused; it is marked here instead of being deleted. `replacedBy` names the live leaf that
 * takes over (an alias-style merge); without it the leaf is simply no longer offered.
 */
export interface RetiredLeafFinding { code: "RETIRED_LEAF"; severity: "error"; subject: string; message: string }

const leavesOf = (nodes: readonly PlacementNode[]): string[] => nodes.flatMap(node => "leaves" in node ? node.leaves : leavesOf(node.children));
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function checkRetiredLeaves(
  retired: readonly Retired[],
  placements: readonly { layer: string; nodes: readonly PlacementNode[] }[],
): RetiredLeafFinding[] {
  const findings: RetiredLeafFinding[] = [];
  const fail = (subject: string, message: string) => findings.push({ code: "RETIRED_LEAF", severity: "error", subject, message: `RETIRED_LEAF: ${message}` });
  const placed = new Map<string, string>();
  for (const placement of placements) for (const id of leavesOf(placement.nodes)) placed.set(id, placement.layer);
  const retiredIds = new Set<string>();
  for (const entry of retired) {
    if (retiredIds.has(entry.id)) fail(entry.id, `${entry.id} is retired more than once`);
    retiredIds.add(entry.id);
    if (!placed.has(entry.id)) fail(entry.id, `${entry.id} is not a placed leaf; a retired leaf stays placed so its id is never reused`);
    if (!ISO_DATE.test(entry.retiredAt)) fail(entry.id, `${entry.id} retiredAt must be YYYY-MM-DD`);
  }
  for (const entry of retired) {
    if (entry.replacedBy === undefined) continue;
    if (!placed.has(entry.replacedBy)) fail(entry.id, `${entry.id} replacedBy ${entry.replacedBy} is not a placed leaf`);
    else if (placed.get(entry.replacedBy) !== placed.get(entry.id)) fail(entry.id, `${entry.id} replacedBy ${entry.replacedBy} is in another layer`);
    if (retiredIds.has(entry.replacedBy)) fail(entry.id, `${entry.id} replacedBy ${entry.replacedBy} is itself retired`);
  }
  return findings;
}

export function assertRetiredLeaves(...args: Parameters<typeof checkRetiredLeaves>): void {
  const findings = checkRetiredLeaves(...args);
  if (findings.length) throw new Error(findings.map(finding => finding.message).join("; "));
}

/** Ids of retired leaves; consumers treat these as not offered. */
export const retiredLeafIds = (retired: readonly Retired[]): ReadonlySet<string> => new Set(retired.map(entry => entry.id));
