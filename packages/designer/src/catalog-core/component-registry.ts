import componentSlots from "../catalog/slots/components.json" with { type: "json" };
import componentPlacement from "../catalog/ia/components.json" with { type: "json" };
import componentAliases from "../catalog/aliases/components.json" with { type: "json" };
import { isValidId } from "./ids.js";
import { assertIAPlacements } from "./ia-placement.js";
import { assertFrozenLeafSets } from "./leaf-freeze.js";
import type { ComponentSlot, Placement, PlacementNode, SlotAlias } from "./types.js";

export interface ComponentRegistry {
  status: "build-unfrozen";
  slots: readonly ComponentSlot[];
  placement: Placement;
  aliases: readonly SlotAlias[];
}

/** Structural IA diagnostics only. Component fill, runtime and accessibility checks ship separately. */
export function componentRegistryFindings(registry: ComponentRegistry): string[] {
  const findings: string[] = [];
  const ids = new Set<string>();
  for (const slot of registry.slots) {
    if (!isValidId("slot", slot.id) || !slot.id.startsWith("components.")) findings.push(`id: invalid component slot ${slot.id}`);
    if (ids.has(slot.id)) findings.push(`id: duplicate component slot ${slot.id}`);
    ids.add(slot.id);
  }
  if (registry.placement.layer !== "components") findings.push("placement: expected components layer");
  const counts = new Map<string, number>();
  const nodeIds = new Set<string>();
  const visit = (nodes: readonly PlacementNode[], depth: number): void => {
    for (const node of nodes) {
      if (nodeIds.has(node.id)) findings.push(`placement: duplicate node ${node.id}`);
      nodeIds.add(node.id);
      if (depth > 2) findings.push(`placement: node ${node.id} exceeds two grouping levels`);
      if ("leaves" in node) for (const id of node.leaves) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
        if (!ids.has(id)) findings.push(`placement: unknown component slot ${id}`);
      }
      else visit(node.children, depth + 1);
    }
  };
  visit(registry.placement.nodes, 1);
  for (const id of ids) if (!counts.has(id)) findings.push(`placement: missing component slot ${id}`);
  for (const [id, count] of counts) if (count !== 1) findings.push(`placement: ${id} appears ${count} times`);
  const aliasIds = new Set<string>();
  for (const alias of registry.aliases) {
    if (!isValidId("slot", alias.id) || !alias.id.startsWith("components.")) findings.push(`alias: invalid id ${alias.id}`);
    if (ids.has(alias.id) || aliasIds.has(alias.id)) findings.push(`alias: duplicate id ${alias.id}`);
    aliasIds.add(alias.id);
    if (!ids.has(alias.target)) findings.push(`alias: unknown target ${alias.target}`);
    const contract = registry.slots.find(slot => slot.id === alias.target)?.contract;
    for (const member of Object.values(alias.memberMap ?? {})) {
      if (contract?.members.mode === "closed" && !contract.members.names.includes(member)) findings.push(`alias: unknown member ${alias.target}.${member}`);
    }
  }
  return findings.sort();
}

/** Fresh owned draft data. No component fill or implementation is claimed by this registry. */
export function loadComponentRegistry(): ComponentRegistry {
  const registry: ComponentRegistry = structuredClone({
    status: "build-unfrozen",
    slots: componentSlots as unknown as readonly ComponentSlot[],
    placement: componentPlacement as Placement,
    aliases: componentAliases as readonly SlotAlias[],
  });
  assertFrozenLeafSets([registry.placement], registry.slots, ["components"]);
  assertIAPlacements([registry.placement], registry.slots);
  const findings = componentRegistryFindings(registry);
  if (findings.length) throw new Error(`component registry: ${findings.join("; ")}`);
  return registry;
}
