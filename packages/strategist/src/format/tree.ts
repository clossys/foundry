import type { StrategyCatalog } from "../catalog.js";
import { loadCatalog } from "../catalog.js";
import { isPlainObject } from "../validation.js";
import { positiveInteger } from "./ref.js";
import { strings } from "./markdown.js";
import type { FormatIssue, FormatResult, StrategyTree } from "./types.js";

export function validateTree(value: unknown, catalog: StrategyCatalog = loadCatalog()): FormatResult<StrategyTree> {
  const issues: FormatIssue[] = []; const add = (path: string, message: string) => issues.push({ path, line: 1, message });
  if (!isPlainObject(value)) return { ok: false, issues: [{ path: "tree", line: 1, message: "Expected a tree object" }] };
  const known = new Set(catalog.cells.map(c => c.id));
  for (const key of Object.keys(value)) if (!["schemaVersion", "catalog", "archetype", "core", "tree", "active"].includes(key)) add(key, "Unknown tree field");
  if (value.schemaVersion !== 1) add("schemaVersion", "Expected schemaVersion 1");
  if (value.catalog !== "@clossys/strategist#strategy-v1") add("catalog", "Unknown catalog identifier");
  if (value.archetype !== "default" && (typeof value.archetype !== "string" || !Object.hasOwn(catalog.archetypes.extras, value.archetype))) add("archetype", "Unknown archetype");
  if (value.core !== "archetype") {
    if (!strings(value.core) || value.core.some(id => !known.has(id)) || new Set(value.core).size !== value.core.length) add("core", "Expected archetype or unique known core ids");
    else if (catalog.archetypes.default.some(id => !(value.core as string[]).includes(id))) add("core", "Explicit core must contain every default core cell");
  }
  if (!isPlainObject(value.active)) add("active", "Expected an active pointer object");
  else for (const [id, version] of Object.entries(value.active)) {
    if (!known.has(id)) add(`active.${id}`, "Unknown cell id");
    if (version !== null && !positiveInteger(version)) add(`active.${id}`, "Expected null or a positive safe version integer");
  }
  if (value.tree !== undefined) {
    if (!Array.isArray(value.tree)) add("tree", "Expected a grouping array");
    else {
      const placements: string[] = []; const groups = new Set<string>();
      const group = (node: Record<string, unknown>, path: string) => {
        if (typeof node.id !== "string" || !node.id.trim() || groups.has(node.id)) add(`${path}.id`, "Expected a unique group id");
        else groups.add(node.id);
        if (typeof node.name !== "string" || !node.name.trim()) add(`${path}.name`, "Expected a group name");
      };
      for (const [i, node] of value.tree.entries()) {
        const path = `tree[${i}]`;
        if (!isPlainObject(node)) { add(path, "Expected a group"); continue; } group(node, path);
        if (!Array.isArray(node.children)) { add(`${path}.children`, "Expected child groups"); continue; }
        for (const [j, child] of node.children.entries()) {
          const childPath = `${path}.children[${j}]`;
          if (!isPlainObject(child)) { add(childPath, "Expected a child group"); continue; } group(child, childPath);
          if (!strings(child.cells)) { add(`${childPath}.cells`, "Expected cell ids"); continue; }
          placements.push(...child.cells);
          for (const id of child.cells) if (!known.has(id)) add(`${childPath}.cells`, "Unknown or renamed cell id");
        }
      }
      if (placements.length !== known.size || new Set(placements).size !== known.size || [...known].some(id => !placements.includes(id))) add("tree", "Grouping must place every catalog leaf exactly once");
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: value as unknown as StrategyTree };
}
