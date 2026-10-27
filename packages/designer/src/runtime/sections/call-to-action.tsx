/** sections.call-to-action: CallToAction with its composed header and one primary plus at most one secondary Link. */
import type { ReactNode } from "react";
import { CallToAction } from "../../blocks/CallToAction.js";
import { actionNode, object, optionalText, readSectionContent, required, SectionContentError, text, type SectionRenderInput, type SectionRendererInputs } from "./group-a-content.js";

export const callToActionInputs: SectionRendererInputs = { slots: ["actions", "header"], members: [] };

export function renderCallToActionSection(input: SectionRenderInput): ReactNode {
  const content = readSectionContent(input, "sections.call-to-action", callToActionInputs);
  const header = object(content, required(content, "header"), "header");
  const actions = object(content, required(content, "actions"), "actions");
  const extra = Object.keys(actions).find(key => key !== "primary" && key !== "secondary");
  if (extra) throw new SectionContentError(content.leaf, `actions.${extra}: at most one primary and one secondary action`);
  return (
    <CallToAction
      title={text(content, header.title, "header.title")}
      eyebrow={optionalText(content, header.eyebrow, "header.eyebrow")}
      description={optionalText(content, header.description, "header.description")}
      primaryAction={actionNode(content, actions.primary, "actions.primary", "primary")}
      secondaryAction={actions.secondary === undefined ? undefined : actionNode(content, actions.secondary, "actions.secondary", "outline")}
    />
  );
}
