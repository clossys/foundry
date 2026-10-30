import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { SectionFrame } from "./SectionFrame.js";
import { componentLeaf } from "../runtime/component-leaf.js";

const Logomark = componentLeaf<typeof import("../components/Logomark.js").Logomark>("components.logo");
const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

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
    <SemanticContent as="div" role="img" aria-label={name} dir="auto" className="flex min-h-screen items-center justify-center">
      <Logomark src={mark} size="lg" />
    </SemanticContent>
  </SectionFrame>;
}
