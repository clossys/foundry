/**
 * The site's copy ids and the plain copy map the client carries.
 *
 * Every visible word on these pages is a Writer copy id. This module holds
 * the ids, and nothing else that can be seen: no wording, no default text.
 * The wording lives in the repository's own Writer copy registry and reaches
 * a page only through the resolver `site-records.ts` builds.
 *
 * It is pure and client-safe. It imports only types, so a client module can
 * import it without pulling Writer's Node-only root (`node:fs`, `node:crypto`)
 * or any Next.js module into the browser bundle. A server page resolves the
 * ids it needs once with `requireCopy` and hands the resulting plain map to a
 * client module, which reads it back through `createMapResolver`.
 */
import type { SiteFooterLegalProps } from "@clossys/designer/shell/server";
import type { ContactViewCopy, ContactViewDevPreview, ContactViewTopic, LegalViewLabels } from "@clossys/publisher/web";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import type { SiteTarget } from "./site-wiring";

/** Resolved copy, id to text. Plain data: it crosses the server/client boundary as props. */
export type SiteCopyMap = Readonly<Record<string, string>>;

const ref = (id: string): CopyRef => ({ id });

// ------------------------------------------------------------------ contact

/**
 * The topics the contact form offers. The view lists them and the handler
 * accepts them from this one list, so a topic cannot be offered without being
 * accepted, or accepted without being offered.
 */
export const CONTACT_TOPICS = ["product", "press", "partnership", "other"] as const;

export type ContactTopic = (typeof CONTACT_TOPICS)[number];

/**
 * The topic a `?topic=` query value names, or `undefined`. Only a string equal
 * to a listed id counts: an array (a repeated parameter), a different case,
 * surrounding whitespace, an unknown id and an object's inherited names all
 * select nothing. The value is compared and never echoed.
 */
export function resolveInitialTopic(param: string | readonly string[] | undefined): ContactTopic | undefined {
  if (typeof param !== "string") return undefined;
  return CONTACT_TOPICS.find((topic) => topic === param);
}

/** The states `?preview=` may pin the contact view to; the pack review lists the same ones. Mirrors `ContactViewDevPreview`, so a new state there fails to compile until it is listed here. */
export const DEV_PREVIEWS = ["idle", "submitting", "accepted", "invalid", "rate-limited", "unavailable"] as const satisfies readonly ContactViewDevPreview[];

/**
 * The state a `?preview=` query value pins the contact view to, or
 * `undefined`. On a production target it is always `undefined` and the value
 * is not inspected. Elsewhere only a string equal to one listed state counts:
 * an array, a different case, an empty string and an object's inherited names
 * select nothing. It never reads the environment: the caller passes the
 * target it already resolved. The value is compared and never echoed.
 */
export function resolveDevPreview(target: SiteTarget, param: string | readonly string[] | undefined): ContactViewDevPreview | undefined {
  if (target === "production") return undefined;
  if (typeof param !== "string") return undefined;
  return DEV_PREVIEWS.find((state) => state === param);
}

const topicCopyId = (topic: ContactTopic): string => `site.contact.topic.${topic}`;

export function contactViewTopics(): ContactViewTopic[] {
  return CONTACT_TOPICS.map((id) => ({ id, label: ref(topicCopyId(id)) }));
}

/** The subject line of the message a submission sends to the site's inbox. */
export const CONTACT_SUBJECT_ID = "site.contact.notification-subject";

const CONTACT_COPY_IDS: Readonly<Record<keyof ContactViewCopy, string>> = {
  heading: "site.contact.heading",
  description: "site.contact.description",
  topicLabel: "site.contact.topic-label",
  topicPlaceholder: "site.contact.topic-placeholder",
  nameLabel: "site.contact.name-label",
  emailLabel: "site.contact.email-label",
  phoneLabel: "site.contact.phone-label",
  messageLabel: "site.contact.message-label",
  submit: "site.contact.submit",
  submitting: "site.contact.submitting",
  errorSummary: "site.contact.error-summary",
  topicRequired: "site.contact.topic-required",
  nameRequired: "site.contact.name-required",
  emailRequired: "site.contact.email-required",
  emailInvalid: "site.contact.email-invalid",
  messageRequired: "site.contact.message-required",
  sentHeading: "site.contact.sent-heading",
  sentBody: "site.contact.sent-body",
  failureLabel: "site.contact.failure-label",
  invalid: "site.contact.invalid",
  rateLimited: "site.contact.rate-limited",
  unavailable: "site.contact.unavailable",
};

/** The contact page's title, for the document head. */
export const CONTACT_HEADING_ID = CONTACT_COPY_IDS.heading;

/** `ContactView`'s copy prop: one bare reference per entry. */
export function contactViewCopy(): ContactViewCopy {
  const copy: Record<string, CopyRef> = {};
  for (const [key, id] of Object.entries(CONTACT_COPY_IDS)) copy[key] = ref(id);
  return copy as unknown as ContactViewCopy;
}

// ------------------------------------------------------------------- footer

const FOOTER_COPY_IDS = {
  terms: "site.footer.terms",
  privacy: "site.footer.privacy",
  contact: "site.footer.contact",
  linksLabel: "site.footer.links-label",
} as const;

/** One resolved text from the map; throws, naming the id only, when it is absent or blank. */
export function siteText(copy: SiteCopyMap, id: string): string {
  const text = Object.hasOwn(copy, id) ? copy[id] : undefined;
  // The message names the id and never any text.
  if (typeof text !== "string" || text.trim().length === 0) throw new Error(`Site copy is missing ${id}.`);
  return text;
}

/** The legal row every page carries: the entity name and links to the three pages a visitor may need. */
export function siteFooterLegal(copy: SiteCopyMap, entity: string): SiteFooterLegalProps {
  return {
    entity,
    links: [
      { label: siteText(copy, FOOTER_COPY_IDS.terms), href: "/terms" },
      { label: siteText(copy, FOOTER_COPY_IDS.privacy), href: "/privacy" },
      { label: siteText(copy, FOOTER_COPY_IDS.contact), href: "/contact" },
    ],
    linksLabel: siteText(copy, FOOTER_COPY_IDS.linksLabel),
  };
}

const FOOTER_IDS: readonly string[] = Object.values(FOOTER_COPY_IDS);

/** Every id the contact page resolves: the form, its topics, the header's contact action (the landing page's) and the footer. */
export function allContactPageCopyIds(): string[] {
  return [...Object.values(CONTACT_COPY_IDS), ...CONTACT_TOPICS.map(topicCopyId), LANDING_COPY_IDS.contactAction, ...FOOTER_IDS];
}

// ------------------------------------------------------------------ landing

export const LANDING_COPY_IDS = {
  /** Used as the heading when the brand-facts record lists no tagline. */
  heading: "site.landing.heading",
  description: "site.landing.description",
  contactAction: "site.landing.contact-action",
} as const;

/** Every id the landing page resolves. `headingId` is the first tagline's copy id, or the fallback heading id. */
export function landingCopyIds(headingId: string): string[] {
  return [headingId, LANDING_COPY_IDS.description, LANDING_COPY_IDS.contactAction, ...FOOTER_IDS];
}

// -------------------------------------------------------------------- about

/**
 * The about page's own ids. The contact action is the landing page's, and the
 * footer is the shared one, so the page adds only what it says itself.
 */
export const ABOUT_COPY_IDS = {
  heading: "site.about.heading",
  description: "site.about.description",
  ctaHeading: "site.about.cta-heading",
  ctaDescription: "site.about.cta-description",
} as const;

/** Every id the about page resolves. */
export function aboutCopyIds(): string[] {
  return [...Object.values(ABOUT_COPY_IDS), LANDING_COPY_IDS.contactAction, ...FOOTER_IDS];
}

// -------------------------------------------------------------- share card

/** The share card's alternative text. Its words are the registry's, like every other. */
export const SHARE_CARD_ALT_ID = "site.share-card.alt";

/** What the share card reads from the brand-facts record. */
export interface SiteShareCardFacts {
  readonly brandLabel: string;
  /** The first tagline's copy id, when the record lists one. */
  readonly taglineCopyId: string | undefined;
}

/** The id the card's tagline comes from: the first tagline's, else the landing heading's. */
function shareCardTaglineId(facts: SiteShareCardFacts): string {
  return facts.taglineCopyId ?? LANDING_COPY_IDS.heading;
}

/** Every id the share card resolves: its tagline and its alternative text. */
export function siteShareCardCopyIds(facts: SiteShareCardFacts): string[] {
  return [shareCardTaglineId(facts), SHARE_CARD_ALT_ID];
}

/**
 * The plain text `buildShareCard` takes: the brand label as the name, the
 * tagline's copy and the alt copy. Throws, naming the id only, when an id is
 * not in the map.
 */
export function siteShareCardText(facts: SiteShareCardFacts, copy: SiteCopyMap): { name: string; tagline: string; alt: string } {
  return {
    name: facts.brandLabel,
    tagline: siteText(copy, shareCardTaglineId(facts)),
    alt: siteText(copy, SHARE_CARD_ALT_ID),
  };
}

// -------------------------------------------------------------------- legal

export const LEGAL_LABEL_IDS = {
  effectiveDate: "site.legal.effective-date",
  lastUpdated: "site.legal.last-updated",
  draftHeading: "site.legal.draft-heading",
} as const;

/** `LegalView`'s labels prop: one bare reference per label. The view resolves them through the server's resolver. */
export function legalViewLabels(): LegalViewLabels {
  return {
    effectiveDate: ref(LEGAL_LABEL_IDS.effectiveDate),
    lastUpdated: ref(LEGAL_LABEL_IDS.lastUpdated),
    draftHeading: ref(LEGAL_LABEL_IDS.draftHeading),
  };
}

// -------------------------------------------------------------------- error

export interface SiteErrorCopyIds {
  readonly title: string;
  readonly description: string;
  readonly action: string;
}

export const ERROR_COPY_IDS = {
  notFound: {
    title: "site.error.not-found.title",
    description: "site.error.not-found.description",
    action: "site.error.not-found.action",
  },
  failed: {
    title: "site.error.failed.title",
    description: "site.error.failed.description",
    action: "site.error.failed.action",
  },
} as const satisfies Record<string, SiteErrorCopyIds>;

/** Every id the error pages resolve. */
export function errorCopyIds(): string[] {
  return [...Object.values(ERROR_COPY_IDS.notFound), ...Object.values(ERROR_COPY_IDS.failed)];
}

// ------------------------------------------------------------------ resolve

/**
 * Resolves each id once and returns the text as a plain map. Throws, naming
 * the first id that does not resolve and never any text, so a page fails at
 * build or render time instead of showing a blank.
 */
export function requireCopy(resolver: CopyResolver, ids: readonly string[]): SiteCopyMap {
  const map: Record<string, string> = {};
  for (const id of ids) {
    const resolution = resolver(ref(id));
    if (resolution === undefined || typeof resolution.text !== "string" || resolution.text.trim().length === 0) {
      throw new Error(`Site copy does not resolve: ${id}.`);
    }
    map[id] = resolution.text;
  }
  return map;
}

/**
 * The resolver a client module reads a `SiteCopyMap` through. It answers only
 * an own id that is in the map, only for a bare reference (no values to
 * substitute) and only in its locale, so it cannot answer with anything the
 * server did not resolve.
 */
export function createMapResolver(copy: SiteCopyMap, locale = "en"): CopyResolver {
  return (request) => {
    if (typeof request?.id !== "string" || !Object.hasOwn(copy, request.id)) return undefined;
    if (request.values !== undefined) return undefined;
    if (request.locale !== undefined && request.locale !== locale) return undefined;
    const text = copy[request.id];
    if (typeof text !== "string") return undefined;
    return {
      ref: request,
      text,
      recordId: "site-copy-map",
      revision: "map",
      locale,
      source: { kind: "consumer", reference: "site-copy-map" },
      entryId: request.id,
    };
  };
}
