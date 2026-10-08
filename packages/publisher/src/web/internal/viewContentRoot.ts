import { SITE_MAIN_ID } from "../frame/types.js";

/** Landmark roles that belong to the page frame, never to a view's content root. */
const FRAME_LANDMARK_ROLES = new Set(["main", "banner", "contentinfo", "navigation"]);

/**
 * True when a caller passed any of a view's deprecated chrome props (`brand`,
 * `header`, `footer`, `mainId`, ...). Such a caller gets the legacy page, with
 * the view's own header, `<main>` and footer; everyone else gets the
 * chrome-free content for a `SiteFrame`.
 */
export function usesLegacyChrome(chrome: Readonly<Record<string, unknown>>): boolean {
  return Object.values(chrome).some((value) => value !== undefined);
}

/**
 * Refuses, at runtime and past the types, a chrome-free view content root that
 * claims a frame landmark role or the frame's main id. Names the view and the
 * rule, never the value.
 */
export function assertViewContentRoot(view: string, attributes: Readonly<Record<string, unknown>>): void {
  const role = attributes.role;
  if (typeof role === "string" && role.split(/\s+/).some((token) => FRAME_LANDMARK_ROLES.has(token.toLowerCase()))) {
    throw new Error(`${view}: the content root cannot take a landmark role; the page frame owns the page's landmarks.`);
  }
  if (attributes.id === SITE_MAIN_ID) {
    throw new Error(`${view}: the content root cannot take the frame's main id.`);
  }
}
