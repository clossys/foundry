import type { HeroProps, SectionIntroProps } from "./blocks/index.js";
import type { HeroProps as ServerHeroProps, SectionIntroProps as ServerIntroProps } from "./blocks/server.js";
import type { BrandmarkProps, NavDisclosureProps, SiteFooterProps } from "./shell/index.js";
import type { BrandmarkProps as ServerBrandProps, SiteFooterProps as ServerFooterProps } from "./shell/server.js";

const intro = { eyebrowTone: "muted", measure: "wide", headingScale: "display" } as const;
const hero = { heading: "Opening", ...intro } as const;
const brand = { variant: "lockup", size: "md", label: "Example home", markSrc: "/mark.svg", wordmark: "Example", tone: "inverse" } as const;
const footer = { tone: "light" } as const;
intro satisfies SectionIntroProps;
intro satisfies ServerIntroProps;
hero satisfies HeroProps;
hero satisfies ServerHeroProps;
brand satisfies BrandmarkProps;
brand satisfies ServerBrandProps;
footer satisfies SiteFooterProps;
footer satisfies ServerFooterProps;
({ children: null, tone: "inverse" }) satisfies NavDisclosureProps;
// @ts-expect-error Eyebrow tones are closed.
({ eyebrowTone: "neutral" }) satisfies SectionIntroProps;
// @ts-expect-error Hero measures are closed.
({ heading: "Opening", measure: "full" }) satisfies HeroProps;
// @ts-expect-error Heading scales are closed.
({ headingScale: "large" }) satisfies SectionIntroProps;
// @ts-expect-error Footer rules are removed.
({ rule: "top" }) satisfies SiteFooterProps;
// @ts-expect-error Footer ground is removed.
({ ground: "base" }) satisfies SiteFooterProps;
// @ts-expect-error Footer tones are closed.
({ tone: "inverse" }) satisfies SiteFooterProps;
// @ts-expect-error Trigger tones are closed.
({ children: null, tone: "base" }) satisfies NavDisclosureProps;
// @ts-expect-error Brand tones are closed.
({ ...brand, tone: "base" }) satisfies BrandmarkProps;
