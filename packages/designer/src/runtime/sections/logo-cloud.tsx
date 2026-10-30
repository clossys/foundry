/** sections.logo-cloud: LogoCloud marks drawn by Logomark. The count member must match the logos supplied. */
import type { ReactNode } from "react";
import { LogoCloud } from "../../blocks/LogoCloud.js";
import { componentLeaf } from "../component-leaf.js";
import { list, memberValue, object, optionalText, readSectionContent, required, SectionContentError, text, type SectionRenderInput, type SectionRendererInputs } from "./group-a-content.js";

export const logoCloudInputs: SectionRendererInputs = {
  slots: ["logos"],
  members: ["count.3", "count.4", "count.6", "count.8", "count.12", "monochrome.true", "monochrome.false"],
};
const Logomark = componentLeaf<typeof import("../../components/Logomark.js").Logomark>("components.logo");

export function renderLogoCloudSection(input: SectionRenderInput): ReactNode {
  const content = readSectionContent(input, "sections.logo-cloud", logoCloudInputs);
  const items = list(content, required(content, "logos"), "logos").map((row, index) => {
    const logo = object(content, row, `logos.${index}`);
    return {
      id: text(content, logo.id, `logos.${index}.id`),
      name: text(content, logo.name, `logos.${index}.name`),
      // The cloud hides the artwork and speaks `name`, so the mark carries no title of its own.
      logo: <Logomark src={text(content, logo.src, `logos.${index}.src`)} size="md" />,
      href: optionalText(content, logo.href, `logos.${index}.href`),
    };
  });
  const count = memberValue(content, "count", ["3", "4", "6", "8", "12"] as const);
  if (count !== undefined && Number(count) !== items.length) throw new SectionContentError(content.leaf, `count.${count} selected but ${items.length} logos supplied`);
  const monochrome = memberValue(content, "monochrome", ["true", "false"] as const);
  return <LogoCloud items={items} tone={monochrome === undefined ? undefined : monochrome === "true" ? "monochrome" : "original"} />;
}
