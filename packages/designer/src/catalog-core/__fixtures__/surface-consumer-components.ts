import selected from "../../studio/__fixtures__/default-component-preview-profile.json" with { type: "json" };
import checkboxDocument from "../../catalog/fills/foundry/components.checkbox.json" with { type: "json" };
import * as components from "../../components/index.js";
import { defaultSourceModules } from "../../components/preview-runtime/modules.js";
import type { ComponentCandidate, ResolvedComponents } from "../../catalog-core/resolve-components.js";
import { componentDescriptorHash } from "../../catalog-core/resolve-components.js";
import type { ConsumerComponentSelection } from "../../runtime/component-leaf.client.js";

// These are real registered descriptors and compiled source modules. The saved
// resolver profile is runtime-pending; these bridge tests do not qualify a fill.
export function fixtureConsumerComponents(override = false): ConsumerComponentSelection {
  const profile = structuredClone(selected) as unknown as ResolvedComponents;
  if (override) {
    const descriptor = checkboxDocument.components.checkbox as unknown as ComponentCandidate;
    profile.components = { ...profile.components, "components.checkbox": {
      ...profile.components["components.checkbox"]!, descriptor, originKind: "adopted", origin: { kind: "adopted", source: "foundry", fill: "foundry/components.checkbox", pin: descriptor.pin, license: descriptor.license, sha256: componentDescriptorHash(descriptor), adoptedAt: "2026-10-30" }, impl: descriptor.impl as typeof profile.components[string]["impl"], propMap: descriptor.propMap,
    } };
    profile.selectionHash = componentDescriptorHash(descriptor);
  }
  return {
    profile: { components: profile }, selectionHash: profile.selectionHash,
    descriptors: Object.fromEntries(Object.entries(profile.components).map(([leaf, chosen]) => [leaf, componentDescriptorHash(chosen.descriptor)])),
    modules: { ...defaultSourceModules, "@clossys/designer/components": components },
  };
}
