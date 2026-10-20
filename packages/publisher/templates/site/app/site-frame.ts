/**
 * The frame the error pages render in: Publisher's `SiteFrame` input (the
 * shell and its two resolvers) built from the plain copy map and two brand
 * facts.
 *
 * The other routes carry their own chrome through their views, so the root
 * layout mounts no frame. A 404 or 500 page has no view chrome of its own, so
 * `site-error-view.tsx` mounts this frame around `StatusView`: one skip link,
 * one banner, one `<main>`, one contentinfo on every page either way.
 *
 * Pure and client-safe, like `site-copy.ts`: it imports only types and the
 * copy map's resolver, so the client error boundary can build the same frame
 * from the copy the root layout provides.
 */
import type { SiteFrameInput, SiteShellInput } from "@clossys/publisher/web";
import type { CopyRef } from "@clossys/writer";
import { FOOTER_COPY_IDS, SITE_FRAME_COPY_IDS, createMapResolver } from "./site-copy";
import type { SiteCopyMap } from "./site-copy";

/** The two brand facts the frame shows: the banner's name and the legal row's entity. Plain data. */
export interface SiteFrameFacts {
  readonly brandLabel: string;
  readonly entity: string;
}

/**
 * The banner's mark: `app/icon.svg`, which Next also serves as the favicon.
 * The frame paints it in the brand's accent colour, using the file as a mask,
 * so a single-colour mark is expected. Replace the file with the brand's own.
 */
export const SITE_BRAND_MARK = { assetId: "site.brand-mark", src: "/icon.svg", width: 32, height: 32 } as const;

// The brand facts reach the frame's resolver under these ids. They are not
// Writer copy ids, and a copy map that holds one is refused, so registry copy
// can never stand in for a fact.
const FACT_IDS = {
  brandLabel: "site-frame.fact.brand-label",
  entity: "site-frame.fact.entity",
} as const;

const ref = (id: string): CopyRef => ({ id });

/** The frame input for an error page. Throws, naming the id only, when the copy map holds a brand-fact id. */
export function siteFrameInput(copy: SiteCopyMap, facts: SiteFrameFacts): SiteFrameInput {
  for (const id of Object.values(FACT_IDS)) {
    if (Object.hasOwn(copy, id)) throw new Error(`Site copy must not hold ${id}; it is a brand fact.`);
  }
  const resolveCopy = createMapResolver({ ...copy, [FACT_IDS.brandLabel]: facts.brandLabel, [FACT_IDS.entity]: facts.entity });
  const shell: SiteShellInput = {
    brand: {
      assetId: SITE_BRAND_MARK.assetId,
      label: ref(FACT_IDS.brandLabel),
      variant: "lockup",
      wordmark: ref(FACT_IDS.brandLabel),
      size: "md",
    },
    skipLink: ref(SITE_FRAME_COPY_IDS.skipLink),
    footer: {
      legal: {
        entity: ref(FACT_IDS.entity),
        links: [
          { href: "/terms", label: ref(FOOTER_COPY_IDS.terms) },
          { href: "/privacy", label: ref(FOOTER_COPY_IDS.privacy) },
          { href: "/contact", label: ref(FOOTER_COPY_IDS.contact) },
        ],
        linksLabel: ref(FOOTER_COPY_IDS.linksLabel),
      },
    },
  };
  const resolveAsset = (assetId: string): unknown =>
    assetId === SITE_BRAND_MARK.assetId
      ? { type: "image", src: SITE_BRAND_MARK.src, width: SITE_BRAND_MARK.width, height: SITE_BRAND_MARK.height, alt: facts.brandLabel }
      : undefined;
  return { shell, resolveCopy, resolveAsset };
}
