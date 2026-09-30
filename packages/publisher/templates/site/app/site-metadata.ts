/**
 * Maps Publisher's `buildSiteMetadata` output onto Next.js's Metadata API.
 *
 * `toNextMetadata` returns the page's `Metadata` (for `export const metadata`
 * or `generateMetadata`); `toNextViewport` returns its `Viewport` (for
 * `export const viewport` or `generateViewport`), because Next reads the theme
 * colour from the viewport, not from the metadata object. Both are pure: they
 * read only their argument, mutate nothing, and return a fresh object.
 *
 * Every field of the `buildSiteMetadata` result lands in exactly one place:
 * the title as `title.absolute` (so a root layout's title template never
 * rewrites it), the canonical under `alternates`, robots, the Open Graph set
 * with its image, the Twitter card with its image and alt text, `metadataBase`
 * as a URL, and the theme colour in the viewport.
 *
 * This module imports only types, so it adds nothing to a bundle and needs
 * neither Publisher nor Next.js at run time.
 */
import type { Metadata, Viewport } from "next";
import type { SiteMetadata } from "@clossys/publisher/web";

export function toNextMetadata(meta: SiteMetadata): Metadata {
  return {
    metadataBase: new URL(meta.metadataBase),
    title: { absolute: meta.title },
    description: meta.description,
    alternates: { canonical: meta.canonical },
    robots: meta.robots,
    openGraph: {
      title: meta.openGraph.title,
      description: meta.openGraph.description,
      url: meta.openGraph.url,
      siteName: meta.openGraph.siteName,
      type: meta.openGraph.type,
      locale: meta.openGraph.locale,
      images: [
        {
          url: meta.openGraph.image.url,
          alt: meta.openGraph.image.alt,
          width: meta.openGraph.image.width,
          height: meta.openGraph.image.height,
        },
      ],
    },
    twitter: {
      card: meta.twitter.card,
      title: meta.twitter.title,
      description: meta.twitter.description,
      images: [{ url: meta.twitter.image, alt: meta.twitter.imageAlt }],
    },
  };
}

export function toNextViewport(meta: SiteMetadata): Viewport {
  return { themeColor: meta.themeColor };
}
