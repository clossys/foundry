/**
 * Leaf freeze over the three Writer groups (foundry-audit-0019). Each group freezes its leaf ids in
 * `src/catalog/ia/<group>.leaf-freeze.json`; the tree may differ from the frozen set only by recorded amendments
 * (remove and add, with a reason). A rename is a remove plus an add. The basis is the writer.md 8 Q6 default; no owner
 * signature is claimed here.
 */
import { readFileSync } from "node:fs";
import { WRITER_GROUPS, leavesOf, type GroupTree, type WriterTreeFinding } from "../catalog/ia/target.js";

export interface LeafAmendment { id: string; remove: string[]; add: string[]; why: string }
export interface GroupLeafFreeze { schema: "clossys.leaf-freeze/2"; group: string; basis: string; signed: null | { by: string; ref: string }; leafIds: string[]; amendments: LeafAmendment[] }

export function loadGroupLeafFreezes(): GroupLeafFreeze[] {
  return WRITER_GROUPS.map(group => JSON.parse(readFileSync(new URL(`../../src/catalog/ia/${group}.leaf-freeze.json`, import.meta.url), "utf8")) as GroupLeafFreeze);
}

export function checkGroupLeafFreeze(trees: readonly GroupTree[], freezes: readonly GroupLeafFreeze[]): WriterTreeFinding[] {
  const findings: WriterTreeFinding[] = [];
  for (const group of WRITER_GROUPS) {
    const fail = (message: string) => { findings.push({ code: "LEAF-FREEZE", group, message: `LEAF-FREEZE: ${message}` }); };
    const freeze = freezes.find(entry => entry.group === group);
    const tree = trees.find(entry => entry.group === group);
    if (!freeze || freeze.schema !== "clossys.leaf-freeze/2" || !Array.isArray(freeze.leafIds) || !Array.isArray(freeze.amendments)) { fail(`${group} has no valid leaf freeze`); continue; }
    if (!tree) { fail(`${group} has no tree`); continue; }
    if (new Set(freeze.leafIds).size !== freeze.leafIds.length) fail(`${group} freeze lists an id twice`);
    const effective = new Set(freeze.leafIds);
    for (const amendment of freeze.amendments) {
      const where = `${group} amendment ${amendment.id || "(no id)"}`;
      if (!amendment.id?.trim() || !amendment.why?.trim()) fail(`${where} needs an id and a reason`);
      if (!(amendment.remove?.length || amendment.add?.length)) fail(`${where} changes nothing`);
      for (const id of amendment.remove ?? []) { if (!effective.delete(id)) fail(`${where} removes ${id}, which is not frozen`); }
      for (const id of amendment.add ?? []) { if (effective.has(id)) fail(`${where} adds ${id}, which is already frozen`); effective.add(id); }
    }
    const placed = new Set(leavesOf(tree));
    for (const id of effective) if (!placed.has(id)) fail(`${id} is frozen in ${group} and is missing from the tree with no amendment`);
    for (const id of placed) if (!effective.has(id)) fail(`${id} is in the ${group} tree but not frozen; record an amendment`);
  }
  return findings;
}
