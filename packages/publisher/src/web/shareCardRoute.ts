/**
 * Builds the exports of a site's `opengraph-image` route from one brand share
 * card. A route file reads each export by name, so it assigns them one by one:
 *
 * ```ts
 * const route = createShareCardRoute({ ImageResponse, card, alt });
 * export const alt = route.alt;
 * export const size = route.size;
 * export const contentType = route.contentType;
 * export default route.Image;
 * ```
 *
 * CALLER SUPPLIES `ImageResponse`. Publisher does not depend on `next`; the
 * caller passes its own image-response class, and this module imports nothing
 * from `next`.
 *
 * WORDING STAYS THE CALLER'S. Every word on the card and its alternative text
 * come from `card`, `title` and `alt`; none is built in here. When `title` is
 * given it replaces `card.headline`, and a function `alt` is called with the
 * headline actually drawn.
 *
 * BUILD-TIME FAILURE. The card is built when `createShareCardRoute` is called,
 * so a bad input fails when the route module loads, not when an image is
 * requested. Every input problem throws the `ShareCardError` that
 * `buildBrandShareCard` throws, unchanged; an `ImageResponse` that is not a
 * function throws `ShareCardError("invalid-input")`.
 */

import type { ReactElement } from "react";
import { ShareCardError, buildBrandShareCard, type BrandShareCardInput } from "./shareCard.js";
import type { SiteShareCard } from "./siteMetadata.js";

export interface ShareCardRouteInput {
  /** The caller's image-response class, such as the one a framework provides. Publisher imports none. */
  ImageResponse: new (element: ReactElement, init: { width: number; height: number }) => Response;
  /** The brand share card to draw. `headline` stays required here; `alt` is given beside it. */
  card: Omit<BrandShareCardInput, "alt">;
  /** Replaces `card.headline` when given. A blank title is refused. */
  title?: string;
  /** The image's alternative text, or a function of the headline actually drawn. The caller writes every word. */
  alt: string | ((headline: string) => string);
}

export interface ShareCardRoute {
  alt: string;
  size: { width: number; height: number };
  contentType: "image/png";
  /** The record to pass as `site.shareCard` to `buildSiteMetadata`. */
  shareCard: SiteShareCard;
  /** Returns `new ImageResponse(element, size)`. */
  Image: () => Response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createShareCardRoute(input: ShareCardRouteInput): ShareCardRoute {
  if (!isRecord(input)) throw new ShareCardError("invalid-input");
  const { ImageResponse, card, title, alt } = input;
  if (typeof ImageResponse !== "function") throw new ShareCardError("invalid-input");
  if (!isRecord(card)) throw new ShareCardError("invalid-input");
  if (typeof alt !== "string" && typeof alt !== "function") throw new ShareCardError("invalid-input");

  const headline = title === undefined ? card["headline"] : title;
  // `alt` is read by the card builder only after it has accepted the headline,
  // so a function `alt` is never called with a refused headline.
  const built = buildBrandShareCard({
    ...card,
    headline: headline as string,
    get alt(): string {
      return typeof alt === "function" ? alt(headline as string) : alt;
    },
  });

  const size = Object.freeze({ width: built.width, height: built.height });
  const { element } = built;
  return Object.freeze({
    alt: built.shareCard.alt,
    size,
    contentType: built.contentType,
    shareCard: built.shareCard,
    Image: (): Response => new ImageResponse(element, size),
  });
}
