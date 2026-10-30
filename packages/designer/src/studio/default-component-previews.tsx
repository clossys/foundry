"use client";
import type { ReactNode } from "react";
import type { CompositeResolved, ResolvedComponent } from "../catalog-core/index.js";
import { sha256 } from "../catalog-core/digest.js";
import { stableStringify } from "../catalog-core/stable.js";
import { componentDescriptorHash, verifyComponentOutput } from "../catalog-core/resolve-components.js";
import { emittedTokenProperties } from "../catalog-core/emit.js";
import tokenSlots from "../catalog/slots/tokens.json" with { type: "json" };
import * as components from "../components/index.js";
import * as charts from "../charts/index.js";
import * as shell from "../shell/index.js";
import { defaultSourceModules } from "../components/preview-runtime/modules.js";
import { glyphs } from "../components/preview-runtime/adapters/glyphs.js";
import identities from "../components/preview-runtime/identities.json" with { type: "json" };
import { componentSpecimenPreview } from "./component-specimens.js";

/** Implementation identity excludes consumer stamps and expanded open token scales. */
function identity(component: ResolvedComponent): string {
  const { source: _consumer, ...descriptor } = component.descriptor;
  delete (descriptor as typeof descriptor & { origin?: unknown }).origin;
  const origin = component.origin.kind === "adopted"
    ? { kind: component.origin.kind, source: component.origin.source, fill: component.origin.fill, pin: component.origin.pin }
    : { kind: component.origin.kind, rule: component.origin.kind === "composed" || component.origin.kind === "derived" ? component.origin.rule : undefined };
  const { tokens: _bindings, ...reads } = component.reads;
  return sha256(stableStringify({ descriptor, impl: component.impl, propMap: component.propMap, reads, origin }));
}
const specimens = componentSpecimenPreview({ modules: {
  "@clossys/designer/components": components,
  "@clossys/designer/charts": charts,
  "@clossys/designer/shell": shell,
  ...defaultSourceModules,
}, provider: ({ children }: { children?: ReactNode }) => <components.GlyphProvider glyphs={glyphs}>{children}</components.GlyphProvider>, restOnly: true });

/** A local executable port for approved defaults. An edited/custom closure needs a host-supplied preview. */
export const defaultComponentPreviews = { preview(leaf: string, profile: CompositeResolved) {
  const seen = new Set<string>();
  let tokenProperties: ReturnType<typeof emittedTokenProperties> | undefined;
  const matches = (id: string): boolean => {
    if (seen.has(id)) return true;
    seen.add(id);
    const selected = profile.components.components[id];
    // Adoption hashes include descriptor.source (the consumer). Validate that
    // receipt locally before comparing the consumer-independent runtime identity.
    if (selected?.origin.kind === "adopted" && componentDescriptorHash(selected.descriptor) !== selected.origin.sha256) return false;
    if (!selected || !(id in identities.components) || identity(selected) !== identities.components[id as keyof typeof identities.components]) return false;
    // Open scales can contain additional consumer members. Every registered CSS
    // binding this descriptor reads must still resolve to the compiled property.
    for (const [member, property] of Object.entries(identities.tokens)) {
      if (selected.descriptor.reads.tokens.some(leaf => member === leaf || member.startsWith(`${leaf}.`)) && selected.reads.tokens[member] !== property) return false;
    }
    for (const [member, property] of Object.entries(selected.reads.tokens)) {
      if (!selected.descriptor.reads.tokens.some(leaf => member === leaf || member.startsWith(`${leaf}.`))) return false;
      if (Object.hasOwn(identities.tokens, member)) {
        if (identities.tokens[member as keyof typeof identities.tokens] !== property) return false;
        continue;
      }
      const slot = tokenSlots.find(slot => member.startsWith(`${slot.id}.`));
      if (!slot || slot.contract.members.mode !== "open" || !selected.descriptor.reads.tokens.includes(slot.id)
        || !new RegExp(slot.contract.members.pattern!).test(member.slice(slot.id.length + 1)) || profile.values.members[member]?.slot !== slot.id) return false;
      try { tokenProperties ??= emittedTokenProperties(profile.values); }
      catch { return false; }
      if (tokenProperties.get(member)?.property !== property) return false;
    }
    if (selected.impl.kind === "source") {
      try { verifyComponentOutput(selected.descriptor, profile.components.files); }
      catch { return false; }
    }
    for (const asset of selected.reads.assets) {
      const expected = glyphs[asset as keyof typeof glyphs];
      const members = Object.values(profile.values?.members ?? {}).filter(member => member.slot === asset);
      if (!expected || members.length !== 1 || stableStringify(members[0]!.value.light) !== stableStringify(expected)) return false;
    }
    return [...selected.descriptor.composes, ...selected.reads.components].every(matches);
  };
  return matches(leaf) ? specimens.preview(leaf, profile) : undefined;
} };
