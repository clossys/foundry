/**
 * The words on the dev-only pack-review page, as one catalog-shaped constant.
 *
 * The rest of this template holds copy ids and no wording; these entries are
 * the exception. They follow the Writer front-door id grammar
 * (`front-door.<state>.<slot>`), and none uses a `{token}` placeholder, so
 * none needs a noun outside Writer's closed front-door noun set (its rule
 * F2). The wording is not in Writer's
 * `frontDoor.*` catalog yet: that catalog carries no pack-review state, and
 * until it does this is the single place the page's words live. No string
 * appears in markup: the page resolves every label through
 * `createCopyResolver(PACK_REVIEW_COPY)` and hands the view plain props.
 *
 * What would have been a placeholder is composed here instead. A review width
 * is one entry per width the review lists (`PACK_REVIEW_WIDTHS` and
 * `PACK_REVIEW_EMAIL_WIDTHS`), and a frame's accessible name joins one fixed
 * label with the page, state and width labels; the page and state are the
 * template's own route and slug, shown as they are and never reworded.
 *
 * Pure: no records, no environment and no file read of its own. It takes the
 * review widths from the pack subpath, so like the page it stays on the server.
 */
import { PACK_REVIEW_EMAIL_WIDTHS, PACK_REVIEW_WIDTHS } from "@clossys/publisher/pack";
import type { PackReviewViewLabels } from "@clossys/publisher/web";
import type { CopyRegistry, CopyRegistryEntry, CopyResolver } from "@clossys/writer";

const TEXT_ENTRIES: ReadonlyArray<readonly [id: string, text: string, context: string]> = [
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
  ["front-door.pack-review-frame.label", "Preview frame", "pack review page: first words of the accessible name of a contact-sheet frame"],
  ["front-door.pack-review-unavailable.title", "The review is unavailable", "pack review page: heading when the pack manifest cannot be listed"],
  ["front-door.pack-review-unavailable.description", "The pack manifest could not be read or did not pass its checks.", "pack review page: line under the heading when the manifest cannot be listed"],
  ["front-door.pack-review-unavailable.primary", "Back to the site", "pack review page: link home when the manifest cannot be listed"],
];

/** Every review width, once: the contact sheet's and the notification email's. */
const WIDTHS: readonly number[] = [...new Set<number>([...PACK_REVIEW_WIDTHS, ...PACK_REVIEW_EMAIL_WIDTHS])];

const widthId = (width: number): string => `front-door.pack-review-width-${width}.label`;

const WIDTH_ENTRIES: ReadonlyArray<readonly [id: string, text: string, context: string]> = WIDTHS.map((width) => [
  widthId(width),
  `${width} px wide`,
  "pack review page: a review width, in CSS pixels",
]);

const ENTRIES = [...TEXT_ENTRIES, ...WIDTH_ENTRIES];

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
  const text = (id: string): string => {
    const resolution = resolve({ id });
    if (resolution === undefined || resolution.text.trim().length === 0) throw new Error(`The pack review copy ${id} does not resolve.`);
    return resolution.text;
  };
  const widthText = (width: number): string => {
    if (!WIDTHS.includes(width)) throw new Error("The pack review copy has no label for that width.");
    return text(widthId(width));
  };
  return {
    heading: text("front-door.pack-review.title"),
    description: text("front-door.pack-review.description"),
    surfaceLabel: text("front-door.pack-review-surface.label"),
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
      exportWidth: widthText,
      frameTitle: ({ page, state, width }) =>
        [text("front-door.pack-review-frame.label"), page, ...(state === undefined ? [] : [state]), widthText(width)].join(", "),
    },
    unavailable: {
      title: text("front-door.pack-review-unavailable.title"),
      description: text("front-door.pack-review-unavailable.description"),
      action: text("front-door.pack-review-unavailable.primary"),
    },
  };
}
