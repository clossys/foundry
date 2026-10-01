/**
 * The words on the dev-only pack-review page, as one catalog-shaped constant.
 *
 * The rest of this template holds copy ids and no wording; these entries are
 * the exception. They follow the Writer front-door id grammar
 * (`front-door.<state>.<slot>`) and use no `{token}` placeholder, so each
 * entry satisfies Writer's rule F2 (a placeholder must be one of the closed
 * `FRONT_DOOR_NOUNS`) as it stands and could be added to Writer's `frontDoor.*`
 * catalog under the same id. They are not in that catalog today: this is the
 * single place the page's words live. A review width and a frame's accessible
 * name are assembled in `packReviewText` from the page, the state, the width
 * and the unit entry, so no entry names a width, a page or a state.
 * No string appears in markup: the page resolves every label through
 * `createCopyResolver(PACK_REVIEW_COPY)` and hands the view plain props.
 *
 * Pure and client-safe: types only, no records, no environment. The values
 * that are assembled come from the template's own route and state lists and
 * the view's own widths, never from the request.
 */
import type { PackReviewViewLabels } from "@clossys/publisher/web";
import type { CopyRegistry, CopyRegistryEntry, CopyResolver } from "@clossys/writer";

const ENTRIES: ReadonlyArray<readonly [id: string, text: string, context: string]> = [
  ["front-door.pack-review.title", "Pack review", "pack review page: heading"],
  ["front-door.pack-review.description", "Pages, forced states and exports of this site, listed from the pack manifest.", "pack review page: line under the heading"],
  ["front-door.pack-review-surface.label", "Review", "pack review page: surface badge in the page banner"],
  ["front-door.pack-review-pages.label", "Pages and states", "pack review page: heading of the pages section"],
  ["front-door.pack-review-exports.label", "Exports", "pack review page: heading of the exports section"],
  ["front-door.pack-review-sheet.label", "Contact sheet", "pack review page: heading of the contact sheet"],
  ["front-door.pack-review-none.notice", "Nothing to review here.", "pack review page: an empty list"],
  ["front-door.pack-review-draft.label", "Draft", "pack review page: iteration badge, draft"],
  ["front-door.pack-review-delegated.label", "Delegated", "pack review page: iteration badge, delegated"],
  ["front-door.pack-review-approved.label", "Approved", "pack review page: iteration badge, approved"],
  ["front-door.pack-review-og-image.label", "OG image", "pack review page: export kind"],
  ["front-door.pack-review-favicon.label", "Favicon", "pack review page: export kind"],
  ["front-door.pack-review-app-icon.label", "App icon", "pack review page: export kind"],
  ["front-door.pack-review-logo.label", "Logo", "pack review page: export kind"],
  ["front-door.pack-review-email-html.label", "Notification email", "pack review page: export kind, the HTML email"],
  ["front-door.pack-review-email-text.label", "Notification email, plain text", "pack review page: export kind, the plain-text email"],
  ["front-door.pack-review-other.label", "Other export", "pack review page: export kind, any other output"],
  ["front-door.pack-review-width-unit.label", "px", "pack review page: the unit that follows a review width, in CSS pixels"],
  ["front-door.pack-review-unavailable.title", "The review is unavailable", "pack review page: heading when the pack manifest cannot be listed"],
  ["front-door.pack-review-unavailable.description", "The pack manifest could not be read or did not pass its checks.", "pack review page: line under the heading when the manifest cannot be listed"],
  ["front-door.pack-review-unavailable.primary", "Back to the site", "pack review page: link home when the manifest cannot be listed"],
];

function placeholdersOf(text: string): string[] {
  return [...new Set([...text.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!))];
}

function entryFor([id, text, context]: (typeof ENTRIES)[number]): CopyRegistryEntry {
  const placeholders = placeholdersOf(text);
  return { id, text, context, status: "approved", ...(placeholders.length > 0 ? { placeholders } : {}) };
}

/** Every id the page uses, in catalog order. */
export const PACK_REVIEW_COPY_IDS: readonly string[] = ENTRIES.map(([id]) => id);

/** The catalog: US English, `approved` as the template's own statement and not a consumer's sign-off. */
export const PACK_REVIEW_COPY: CopyRegistry = {
  id: "front-door-pack-review",
  locale: "en",
  revision: "1",
  source: { kind: "imported", reference: "templates/site/app/pack-review-copy.ts" },
  entries: ENTRIES.map(entryFor),
};

/** What the page shows around the view, resolved. */
export interface PackReviewText {
  heading: string;
  description: string;
  surfaceLabel: string;
  labels: PackReviewViewLabels;
  unavailable: { title: string; description: string; action: string };
}

/**
 * Resolves every label from `resolve`. Throws, naming only the copy id, when
 * one does not resolve to non-blank text: a missing label is a bug in this
 * catalog, never something to render around.
 */
export function packReviewText(resolve: CopyResolver): PackReviewText {
  const text = (id: string, values?: Record<string, string | number>): string => {
    const resolution = resolve(values === undefined ? { id } : { id, values });
    if (resolution === undefined || resolution.text.trim().length === 0) throw new Error(`The pack review copy ${id} does not resolve.`);
    return resolution.text;
  };
  const heading = text("front-door.pack-review.title");
  const description = text("front-door.pack-review.description");
  const surfaceLabel = text("front-door.pack-review-surface.label");
  const unit = text("front-door.pack-review-width-unit.label");
  return {
    heading,
    description,
    surfaceLabel,
    labels: {
      pagesHeading: text("front-door.pack-review-pages.label"),
      exportsHeading: text("front-door.pack-review-exports.label"),
      sheetHeading: text("front-door.pack-review-sheet.label"),
      none: text("front-door.pack-review-none.notice"),
      statuses: {
        draft: text("front-door.pack-review-draft.label"),
        delegated: text("front-door.pack-review-delegated.label"),
        approved: text("front-door.pack-review-approved.label"),
      },
      kinds: {
        "og-image": text("front-door.pack-review-og-image.label"),
        favicon: text("front-door.pack-review-favicon.label"),
        "app-icon": text("front-door.pack-review-app-icon.label"),
        logo: text("front-door.pack-review-logo.label"),
        "email-html": text("front-door.pack-review-email-html.label"),
        "email-text": text("front-door.pack-review-email-text.label"),
        other: text("front-door.pack-review-other.label"),
      },
      exportWidth: (width) => `${width} ${unit}`,
      frameTitle: ({ page, state, width }) => [page, ...(state === undefined ? [] : [state]), `${width} ${unit}`].join(", "),
    },
    unavailable: {
      title: text("front-door.pack-review-unavailable.title"),
      description: text("front-door.pack-review-unavailable.description"),
      action: text("front-door.pack-review-unavailable.primary"),
    },
  };
}
