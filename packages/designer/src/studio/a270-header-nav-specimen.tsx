/** Native Studio adapter for the existing header Frame, with caller-owned approved fixture copy. */
import type { DesignerSpecimenContext } from "./DesignerSpecimen.js";
import type { SpecimenLeafDefinition, SpecimenLeafProps } from "./specimen-layouts.js";
import { studioSpecimenLeaves, enumerateRegisteredDesignerSpecimenCases } from "./specimen-registry.js";
import { siteHeaderProps } from "../runtime/frames/site-header.js";
import type { CopyResolver } from "../frames/site-frame/copy-contract.js";
import { createHeaderNavSpecimen } from "./__fixtures__/a270-header-nav.js";

/**
 * The host supplies an emitted, descriptor-bound context and its NEED renderer.
 * The selected surface renders the neutral payload; native Frame viewports own
 * the specimen UI. A missing selected binding remains a visible NEED.
 */
export function renderHeaderNavStudioSpecimen(input: {
  readonly context: DesignerSpecimenContext;
  readonly resolveCopy: CopyResolver;
  readonly need: SpecimenLeafProps["need"];
  readonly labels: SpecimenLeafProps["labels"];
}) {
  const id = "frames.site-header", specimenId = "sections.specimen-frame-viewports";
  const button = input.context.profile.components.components["components.button"];
  if (!button || button.impl.kind !== "source" || button.origin.kind !== "adopted" || button.origin.source !== "shadcn@aria"
    || !button.descriptor.secondaryExports?.some(row => row.name === "LinkButton" && row.export === "LinkButton"))
    return input.need({ leaf: "components.button", reason: "NEED native selected shadcn@aria Button.LinkButton export." });
  const selected = input.context.profile.surfaces?.fills[id];
  const bound = input.context.surfaces?.[id];
  if (!selected || !bound || selected.descriptorHash !== bound.descriptorHash || !bound.renderContent)
    return input.need({ leaf: id, reason: "NEED emitted descriptor-bound header surface and selected component index." });
  const leaf = studioSpecimenLeaves.find((row: SpecimenLeafDefinition) => row.id === specimenId);
  if (!leaf) return input.need({ leaf: specimenId, reason: "NEED native registered Frame viewport specimen." });
  const payload = createHeaderNavSpecimen(input.resolveCopy);
  const props = siteHeaderProps(payload.input);
  const renderContent = bound.renderContent;
  const context: DesignerSpecimenContext = { ...input.context, surfaces: { ...input.context.surfaces,
    [id]: { ...bound, states: ["default"], render: () => renderContent({ ...props }) },
  } };
  const cases = enumerateRegisteredDesignerSpecimenCases({ context, specimen: specimenId, sourceLeaf: id });
  if (!cases?.items.length) return input.need({ leaf: id, reason: "NEED registered header Frame cases." });
  return leaf.render({ ...cases, context, need: input.need, labels: input.labels, expanded: true });
}
