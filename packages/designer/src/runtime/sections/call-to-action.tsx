/** sections.call-to-action: selected component leaves with caller-owned header and at most two real Links. */
import type { ReactNode } from "react";
import { componentLeaf } from "../component-leaf.js";
import { CallToAction } from "../../blocks/CallToAction.js";
import { object, optionalText, readSectionContent, required, SectionContentError, text, type SectionContent, type SectionRenderInput, type SectionRendererInputs } from "./group-a-content.js";

const Link = componentLeaf<typeof import("../../components/Link.js").Link>("components.link");
const variants = ["primary", "secondary", "outline", "ghost", "tonal", "quiet"] as const;
type ActionVariant = typeof variants[number];
function isVariant(value: string): value is ActionVariant { return variants.some(variant => variant === value); }

/** Navigation stays a real selected Link; every label and destination comes from resolved caller content. */
function action(content: SectionContent, value: Parameters<typeof object>[1], path: string, defaultVariant: ActionVariant): ReactNode {
  const entry = object(content, value, path);
  const variant = entry.variant === undefined ? defaultVariant : text(content, entry.variant, `${path}.variant`);
  if (!isVariant(variant)) throw new SectionContentError(content.leaf, `${path}.variant is not a link button variant`);
  return <Link href={text(content, entry.href, `${path}.href`)} buttonVariant={variant}>{text(content, entry.label, `${path}.label`)}</Link>;
}

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
      primaryAction={action(content, actions.primary, "actions.primary", "primary")}
      secondaryAction={actions.secondary === undefined ? undefined : action(content, actions.secondary, "actions.secondary", "outline")}
    />
  );
}
