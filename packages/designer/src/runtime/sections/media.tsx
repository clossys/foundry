/** sections.media: registered media in static chrome, with optional authored annotations. */
import type { ReactNode } from "react";
import { MediaFigure } from "../../blocks/MediaFigure.js";
import type { ChromeCalloutsProps } from "../../blocks/media/ChromeCallouts.js";
import { isImageResource } from "../../catalog-assets/media.js";
import { IMAGE_RATIOS } from "../../importers/image-ratio.js";
import { list, mediaNode, memberValue, object, optionalText, readSectionContent, required, SectionContentError, text,
  type JsonObject, type SectionContent, type SectionRenderInput, type SectionRendererInputs } from "./group-a-content.js";

export const mediaInputs: SectionRendererInputs = { slots: ["figure", "callouts"], members: ["chrome.browser", "chrome.device", "chrome.bare"] };

function keys(content: SectionContent, value: JsonObject, allowed: readonly string[], path: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new SectionContentError(content.leaf, `${path}.${key} is not supported`);
}

/** Values are already resolved Writer copy at the content port; no literal copy fallback is supplied. */
function annotations(content: SectionContent): ChromeCalloutsProps | undefined {
  if (content.values.callouts === undefined) return undefined;
  const value = object(content, content.values.callouts, "callouts");
  keys(content, value, ["label", "items"], "callouts");
  const label = text(content, value.label, "callouts.label");
  const ids = new Set<string>();
  const items = list(content, value.items, "callouts.items").map((row, index) => {
    const path = `callouts.items.${index}`;
    const item = object(content, row, path);
    keys(content, item, ["id", "body"], path);
    const id = text(content, item.id, `${path}.id`);
    if (ids.has(id)) throw new SectionContentError(content.leaf, `${path}.id is duplicate`);
    ids.add(id);
    return { id, body: text(content, item.body, `${path}.body`) };
  });
  return { label, items };
}

export function renderMediaSection(input: SectionRenderInput): ReactNode {
  const content = readSectionContent(input, "sections.media", mediaInputs);
  const figure = object(content, required(content, "figure"), "figure");
  keys(content, figure, ["media", "caption", "chromeLabel", "ratio"], "figure");
  const chrome = memberValue(content, "chrome", ["browser", "device", "bare"] as const) ?? "bare";
  const chromeLabel = optionalText(content, figure.chromeLabel, "figure.chromeLabel");
  if (chromeLabel !== undefined && chrome !== "browser") throw new SectionContentError(content.leaf, "figure.chromeLabel requires chrome.browser");
  const props = { chrome, chromeLabel, caption: optionalText(content, figure.caption, "figure.caption"), callouts: annotations(content) };
  const media = object(content, figure.media, "figure.media");
  if (media.kind === "image") {
    keys(content, media, ["kind", "resource"], "figure.media");
    if (!isImageResource(media.resource)) throw new SectionContentError(content.leaf, "figure.media.resource must be a valid image resource");
    const ratio = optionalText(content, figure.ratio, "figure.ratio");
    if (ratio !== undefined && !Object.hasOwn(IMAGE_RATIOS, ratio)) throw new SectionContentError(content.leaf, "figure.ratio is not a canonical image ratio");
    return <MediaFigure {...props} image={media.resource} ratio={ratio as keyof typeof IMAGE_RATIOS | undefined} />;
  }
  if (figure.ratio !== undefined) throw new SectionContentError(content.leaf, "figure.ratio requires an image resource");
  return <MediaFigure {...props}>{mediaNode(content, figure.media, "figure.media")}</MediaFigure>;
}
