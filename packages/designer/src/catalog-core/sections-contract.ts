import type { BodySubstrate, SectionSubstrateRenderTest } from "./body-substrate.js";
import type { SpecimenRenderPartName } from "../studio/specimen-render-part-identities.js";
import sectionSlots from "../catalog/slots/sections.json" with { type: "json" };
import sectionPlacement from "../catalog/ia/sections.json" with { type: "json" };
import sectionRetired from "../catalog/retired/sections.json" with { type: "json" };
import { isValidId } from "./ids.js";
import { sectionCopySchemaFindings } from "./section-copy.js";
import type { SectionCopySchema } from "./section-copy.js";
import { assertIAPlacements } from "./ia-placement.js";
import type { Placement, PlacementNode, Retired, SlotAlias, Status } from "./types.js";

/** A section is a content region placed inside the host's main landmark. */
export interface SectionContract {
  kind: "section";
  /** One mechanically paired Writer passage; words remain consumer-owned. */
  passageSchema: `passages.${string}`;
  copy: SectionCopySchema;
  /** Each declaration requires a render test; absent means unmeasured support. */
  substrates?: readonly BodySubstrate[];
  /** Named source tests, not evidence that a current consumer run passed. */
  substrateTests?: readonly SectionSubstrateRenderTest[];
  root: "section" | "div" | "header" | "nav" | "article" | "figure";
  anatomy: { band: "sections.band" | null; header: "sections.section-header" | null };
  slots: readonly { name: string; type: "copy" | "media" | "records" | "action" | "region"; required: boolean; max?: number }[];
  members: { mode: "closed"; names: readonly string[] };
  /** Axes whose values still need specification; never treated as covered members. */
  unresolvedMemberAxes?: readonly string[];
  allowedComposes: readonly `components.${string}`[];
  /** Registered sections composed by this implementation, separate from shared parts. */
  composes?: readonly `sections.${string}`[];
  parts: readonly ("sections.band" | "sections.section-header" | "sections.pagination" | SpecimenRenderPartName)[];
  allowedReads: { tokens: readonly `tokens.${string}`[]; assets: readonly `assets.${string}`[] };
  data: "host-injected";
  states?: readonly ("loading" | "empty" | "error")[];
  surface: "site" | "app" | "both";
}

/** Separate from value-engine slots until section fills and resolution ship. */
export interface SectionSlot {
  id: string;
  layer: "sections";
  contract: SectionContract;
  requires: readonly string[];
  status: Status;
}

export interface SectionRegistry {
  status: "build-unfrozen";
  slots: readonly SectionSlot[];
  placement: Placement;
  retired: readonly Retired[];
  aliases: readonly SlotAlias[];
}

/** Structural IA diagnostics only; this does not check section implementations. */
export function sectionRegistryFindings(registry: SectionRegistry): string[] {
  const findings: string[] = [];
  const ids = new Set<string>();
  for (const slot of registry.slots) {
    if (!isValidId("slot", slot.id) || !slot.id.startsWith("sections.")) findings.push(`id: invalid section slot ${slot.id}`);
    if (ids.has(slot.id)) findings.push(`id: duplicate section slot ${slot.id}`);
    ids.add(slot.id);
    findings.push(...sectionCopySchemaFindings(slot));
  }
  for (const slot of registry.slots) {
    const composes = slot.contract.composes;
    if (composes === undefined) continue;
    if (!Array.isArray(composes) || composes.some(target => typeof target !== "string")) {
      findings.push(`composition: ${slot.id} requires section ids`);
      continue;
    }
    if (new Set(composes).size !== composes.length) findings.push(`composition: ${slot.id} has duplicate sections`);
    for (const target of composes) {
      if (!ids.has(target)) findings.push(`composition: ${slot.id} has unknown section ${target}`);
      if (target === slot.id) findings.push(`composition: ${slot.id} composes itself`);
    }
  }
  if (registry.placement.layer !== "sections") findings.push("placement: expected sections layer");
  const counts = new Map<string, number>();
  const nodeIds = new Set<string>();
  const visit = (nodes: readonly PlacementNode[], depth: number): void => {
    for (const node of nodes) {
      if (nodeIds.has(node.id)) findings.push(`placement: duplicate node ${node.id}`);
      nodeIds.add(node.id);
      if (depth > 2) findings.push(`placement: node ${node.id} exceeds two grouping levels`);
      if ("leaves" in node) for (const id of node.leaves) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
        if (!ids.has(id)) findings.push(`placement: unknown section slot ${id}`);
      }
      else visit(node.children, depth + 1);
    }
  };
  visit(registry.placement.nodes, 1);
  for (const id of ids) if (!counts.has(id)) findings.push(`placement: missing section slot ${id}`);
  for (const [id, count] of counts) if (count !== 1) findings.push(`placement: ${id} appears ${count} times`);
  const retiredIds = new Set<string>();
  for (const entry of registry.retired) {
    if (retiredIds.has(entry.id) || ids.has(entry.id)) findings.push(`retired: duplicate id ${entry.id}`);
    retiredIds.add(entry.id);
    if (!entry.replacedBy || !ids.has(entry.replacedBy)) findings.push(`retired: unknown target ${entry.replacedBy ?? entry.id}`);
  }
  return findings.sort();
}

/** Fresh draft registry. Legacy ids are read-only aliases, never new permanent leaves. */
export function loadSectionRegistry(): SectionRegistry {
  const registry: SectionRegistry = structuredClone({
    status: "build-unfrozen",
    slots: sectionSlots as unknown as readonly SectionSlot[],
    placement: sectionPlacement as Placement,
    retired: sectionRetired as readonly Retired[],
    aliases: sectionRetired.map(entry => ({ id: entry.id, target: entry.replacedBy })),
  });
  assertIAPlacements([registry.placement], registry.slots);
  const findings = sectionRegistryFindings(registry);
  if (findings.length) throw new Error(`section registry: ${findings.join("; ")}`);
  return registry;
}

/** Public catalog rows for copy inspectors and passage derivation, without UI dependencies. */
export function sectionCopyCatalog(registry: SectionRegistry = loadSectionRegistry()) {
  return registry.slots.map(({ id, status, contract }) => ({
    id, status, passageSchema: contract.passageSchema, sourceLocale: contract.copy.sourceLocale,
    fields: structuredClone(contract.copy.fields),
  }));
}
