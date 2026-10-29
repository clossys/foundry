import { LogoHero } from "../../blocks/LogoHero.js";
import { dsAttrs } from "../../catalog-core/provenance-attrs.js";
import type { SurfaceRendererEntry } from "../contract.js";
import { object, optionalText, readSectionContent, required, SectionContentError, text } from "./group-a-content.js";

/**
 * A logo-only opening section. The consumer resolves its registered assets.mark
 * member into media content; this adapter never supplies or generates artwork.
 * Any accessible name belongs to the asset metadata, not an authored copy slot.
 */
export const logoMarkRenderer: SurfaceRendererEntry = {
  leaf: "sections.logo-mark",
  sample: dataset => ({
    mark: {
      slot: dataset.assets.mark.slot,
      member: dataset.assets.mark.member,
      src: dataset.assets.mark.src,
      name: dataset.assets.mark.name,
    },
  }),
  render(input) {
    const content = readSectionContent(input, "sections.logo-mark", { slots: ["mark"], members: [] });
    const mark = object(content, required(content, "mark"), "mark");
    for (const key of Object.keys(mark)) {
      if (!["slot", "member", "src", "name"].includes(key)) throw new SectionContentError(content.leaf, `mark.${key} is not asset metadata`);
    }
    if (mark.slot !== "assets.mark") throw new SectionContentError(content.leaf, "mark.slot must reference assets.mark");
    const member = text(content, mark.member, "mark.member");
    if (!["mono", "positive", "reversed"].includes(member)) throw new SectionContentError(content.leaf, `mark.member ${member} is not registered for assets.mark`);
    const src = text(content, mark.src, "mark.src");
    const name = optionalText(content, mark.name, "mark.name");
    return <LogoHero {...dsAttrs("sections", "sections.logo-mark", "foundry/sections.logo-mark")} mark={src} name={name} member="brand.mark-only" />;
  },
};
