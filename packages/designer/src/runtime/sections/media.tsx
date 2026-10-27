/** sections.media: MediaFigure holding a registered chart or mark, with its caption. */
import type { ReactNode } from "react";
import { MediaFigure } from "../../blocks/MediaFigure.js";
import { mediaNode, object, optionalText, readSectionContent, required, type SectionRenderInput, type SectionRendererInputs } from "./group-a-content.js";

export const mediaInputs: SectionRendererInputs = { slots: ["figure"], members: [] };

export function renderMediaSection(input: SectionRenderInput): ReactNode {
  const content = readSectionContent(input, "sections.media", mediaInputs);
  const figure = object(content, required(content, "figure"), "figure");
  return <MediaFigure caption={optionalText(content, figure.caption, "figure.caption")}>{mediaNode(content, figure.media, "figure.media")}</MediaFigure>;
}
