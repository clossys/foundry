import { LogoHero } from "../../blocks/LogoHero.js";
import type { SurfaceRendererEntry } from "../contract.js";
import { readSectionContent, required, text } from "./group-a-content.js";

export const logoHeroRenderer: SurfaceRendererEntry = {
  leaf: "sections.logo-hero",
  sample: dataset => ({ mark: dataset.assets.mark.src, name: dataset.assets.mark.name }),
  render(input) {
    const content = readSectionContent(input, "sections.logo-hero", { slots: ["mark", "name"], members: [] });
    return <LogoHero mark={text(content, required(content, "mark"), "mark")} name={text(content, required(content, "name"), "name")} />;
  },
};
