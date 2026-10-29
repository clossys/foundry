import { Logomark } from "../components/Logomark.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { SectionFrame } from "./SectionFrame.js";

export interface LogoHeroProps {
  /** Existing consumer artwork; this block never invents a mark. */
  mark: string;
  /** The only authored text, used as the mark's accessible name. */
  name?: string;
  /** Mark-only presentation retains the permanent logo-mark surface. */
  member?: "brand.named" | "brand.mark-only";
}

/** A public site's logo-only opening section, composed from the registered band and logo. */
export function LogoHero({ mark, name, member = "brand.named" }: LogoHeroProps) {
  if (!mark.trim() || (member === "brand.named" && !name?.trim())) throw new TypeError("LogoHero requires mark and name");
  return <SectionFrame {...dsAttrs("sections", "sections.logo-hero", "foundry/sections.logo-hero")}>
    <div role={name ? "img" : undefined} aria-label={name} dir="auto" className="flex min-h-screen items-center justify-center">
      <Logomark src={mark} size="lg" />
    </div>
  </SectionFrame>;
}

/** The permanent logo-mark fill selects the same rendering with no authored name requirement. */
export function LogoMark(props: Omit<LogoHeroProps, "member">) {
  return <LogoHero {...props} member="brand.mark-only" />;
}
