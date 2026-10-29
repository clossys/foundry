import { Logomark } from "../selected-components/Logomark.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { SectionFrame } from "./SectionFrame.js";

export interface LogoHeroProps {
  /** Existing consumer artwork; this block never invents a mark. */
  mark: string;
  /** The only authored text, used as the mark's accessible name. */
  name: string;
}

/** A public site's logo-only opening section, composed from the registered band and logo. */
export function LogoHero({ mark, name }: LogoHeroProps) {
  if (!mark.trim() || !name.trim()) throw new TypeError("LogoHero requires mark and name");
  return <SectionFrame {...dsAttrs("sections", "sections.logo-hero", "foundry/sections.logo-hero")}>
    <div role="img" aria-label={name} dir="auto" className="flex min-h-screen items-center justify-center">
      <Logomark src={mark} size="lg" />
    </div>
  </SectionFrame>;
}
