/** sections.content: ContentSection with its header group, prose body, chart or mark media and footnote. */
import { Fragment, type ReactNode } from "react";
import { ContentSection } from "../../blocks/ContentSection.js";
import { actionNode, list, mediaNode, memberValue, object, optionalText, proseNodes, readSectionContent, required, type JsonObject, type SectionRenderInput, type SectionRendererInputs } from "./group-a-content.js";

export const contentInputs: SectionRendererInputs = { slots: ["body", "footnote", "header", "media"], members: ["layout.stacked", "layout.split-start", "layout.split-end"] };

export function renderContentSection(input: SectionRenderInput): ReactNode {
  const content = readSectionContent(input, "sections.content", contentInputs);
  const header: JsonObject = content.values.header === undefined ? {} : object(content, content.values.header, "header");
  const actions = header.actions === undefined ? undefined : list(content, header.actions, "header.actions").map((action, index) => <Fragment key={index}>{actionNode(content, action, `header.actions.${index}`, index === 0 ? "primary" : "outline")}</Fragment>);
  const media = content.values.media === undefined ? undefined : mediaNode(content, content.values.media, "media");
  const body = proseNodes(content, required(content, "body"), "body");
  const footnote = optionalText(content, content.values.footnote, "footnote");
  const common = {
    eyebrow: optionalText(content, header.eyebrow, "header.eyebrow"),
    heading: optionalText(content, header.heading, "header.heading"),
    description: optionalText(content, header.description, "header.description"),
    actions,
    footnote,
    media,
  };
  const layout = memberValue(content, "layout", ["stacked", "split-start", "split-end"] as const);
  if (layout === "split-start" || layout === "split-end") return <ContentSection layout={layout} eyebrow={common.eyebrow} heading={common.heading} description={common.description} actions={common.actions} footnote={common.footnote} media={common.media}>{body}</ContentSection>;
  return <ContentSection layout="stacked" eyebrow={common.eyebrow} heading={common.heading} description={common.description} actions={common.actions} footnote={common.footnote} media={common.media}>{body}</ContentSection>;
}
