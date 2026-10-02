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
 * and the unit entry, so no entry names a width, a page or a state. The words
 * around the repository's own records (a section's name, a field's name, the
 * type specimen) are entries here too; the records' own words are never
 * entries, and `resolvePackReviewSections` places them beside these.
 * No string appears in markup: the page resolves every label through
 * `createCopyResolver(PACK_REVIEW_COPY)` and hands the view plain props.
 *
 * Pure and client-safe: types only, no records, no environment. The values
 * that are assembled come from the template's own route and state lists and
 * the view's own widths, never from the request.
 */
import type { PackReviewViewLabels } from "@clossys/publisher/web";
import type { EngagementContextFieldId } from "@clossys/strategist";
import type { CopyRegistry, CopyRegistryEntry, CopyResolver } from "@clossys/writer";

const ENTRIES: ReadonlyArray<readonly [id: string, text: string, context: string]> = [
  ["front-door.pack-review.title", "Pack review", "pack review page: heading"],
  ["front-door.pack-review.description", "The pack's strategy brief, brand kit, voice and copy, then this site's pages, forced states and exports, read from the repository's records.", "pack review page: line under the heading"],
  ["front-door.pack-review-surface.label", "Review", "pack review page: surface badge in the page banner"],
  ["front-door.pack-review-strategy.label", "Strategy brief", "pack review page: heading of the strategy brief section"],
  ["front-door.pack-review-strategy-empty.notice", "No Strategist contract and no engagement brief context are recorded yet.", "pack review page: the strategy brief section when neither record is present"],
  ["front-door.pack-review-strategy-contract.notice", "Read from the Strategist contract.", "pack review page: strategy brief source, the Strategist contract"],
  ["front-door.pack-review-strategy-brief.notice", "Read from the engagement brief's context. There is no Strategist contract yet.", "pack review page: strategy brief source, the engagement brief alone"],
  ["front-door.pack-review-strategy-summary.label", "Summary", "pack review page: strategy brief, the product summary"],
  ["front-door.pack-review-strategy-context.label", "Context from the owner", "pack review page: strategy brief, the engagement context already answered"],
  ["front-door.pack-review-strategy-questions.label", "Open questions for the owner", "pack review page: strategy brief, what the owner still has to decide"],
  ["front-door.pack-review-strategy-hypothesis.label", "Claim to approve", "pack review page: open question, a claim the Strategist contract still marks as a hypothesis"],
  ["front-door.pack-review-context-business.label", "Business", "pack review page: engagement context field, business"],
  ["front-door.pack-review-context-business.notice", "What kind of business is this?", "pack review page: open question, the business field is unanswered"],
  ["front-door.pack-review-context-product.label", "Product", "pack review page: engagement context field, product"],
  ["front-door.pack-review-context-product.notice", "What does the business offer?", "pack review page: open question, the product field is unanswered"],
  ["front-door.pack-review-context-audience.label", "Audience", "pack review page: engagement context field, audience"],
  ["front-door.pack-review-context-audience.notice", "Who does the business serve?", "pack review page: open question, the audience field is unanswered"],
  ["front-door.pack-review-context-stage.label", "Stage", "pack review page: engagement context field, stage"],
  ["front-door.pack-review-context-stage.notice", "What stage is the business at?", "pack review page: open question, the stage field is unanswered"],
  ["front-door.pack-review-context-intent.label", "Intent", "pack review page: engagement context field, intent"],
  ["front-door.pack-review-context-intent.notice", "What should this engagement achieve first?", "pack review page: open question, the intent field is unanswered"],
  ["front-door.pack-review-context-constraints.label", "Constraints", "pack review page: engagement context field, constraints"],
  ["front-door.pack-review-context-constraints.notice", "What constraints should the team work within?", "pack review page: open question, the constraints field is unanswered"],
  ["front-door.pack-review-brand-kit.label", "Brand kit", "pack review page: heading of the brand kit section"],
  ["front-door.pack-review-brand-kit-empty.notice", "No brand file is recorded yet.", "pack review page: the brand kit section when the brand file is absent"],
  ["front-door.pack-review-brand-kit.description", "Brand assets from the pack manifest, and color and type tokens from the brand file.", "pack review page: brand kit, the line under the brand name"],
  ["front-door.pack-review-brand-assets.label", "Assets", "pack review page: brand kit, the asset links"],
  ["front-door.pack-review-brand-colors.label", "Color tokens", "pack review page: brand kit, the color tokens"],
  ["front-door.pack-review-brand-type.label", "Type tokens", "pack review page: brand kit, the type tokens"],
  ["front-door.pack-review-brand-specimen.label", "Type specimen", "pack review page: brand kit, sample text in each face"],
  ["front-door.pack-review-brand-specimen.description", "Sphinx of black quartz, judge my vow. 0123456789", "pack review page: brand kit, the sample text set in each face"],
  ["front-door.pack-review-brand-facts.label", "Brand facts", "pack review page: brand kit, facts from the brand-facts record"],
  ["front-door.pack-review-fact-brand.label", "Brand", "pack review page: brand fact, the name in the banner"],
  ["front-door.pack-review-fact-entity.label", "Legal entity", "pack review page: brand fact, the registered legal name"],
  ["front-door.pack-review-fact-origin.label", "Canonical origin", "pack review page: brand fact, the site's canonical origin"],
  ["front-door.pack-review-voice.label", "Voice and copy", "pack review page: heading of the voice and copy section"],
  ["front-door.pack-review-voice-empty.notice", "No voice record and no reusable copy are recorded yet.", "pack review page: the voice and copy section when no record is present"],
  ["front-door.pack-review-voice-rules.label", "Voice rules", "pack review page: voice and copy, the rules from the voice record"],
  ["front-door.pack-review-voice-person.label", "Person", "pack review page: voice rule, person"],
  ["front-door.pack-review-voice-tense.label", "Tense", "pack review page: voice rule, tense"],
  ["front-door.pack-review-voice-formality.label", "Formality", "pack review page: voice rule, formality"],
  ["front-door.pack-review-voice-tone.label", "Tone", "pack review page: voice rule, tone"],
  ["front-door.pack-review-tagline.label", "Tagline", "pack review page: voice and copy, the tagline"],
  ["front-door.pack-review-pitch.label", "Pitch", "pack review page: voice and copy, the pitch at each length"],
  ["front-door.pack-review-pitch-one-liner.label", "One line", "pack review page: pitch length, one line"],
  ["front-door.pack-review-pitch-elevator.label", "Elevator", "pack review page: pitch length, elevator"],
  ["front-door.pack-review-pitch-paragraph.label", "Paragraph", "pack review page: pitch length, paragraph"],
  ["front-door.pack-review-boilerplate.label", "Boilerplate", "pack review page: voice and copy, the boilerplate at each length"],
  ["front-door.pack-review-boilerplate-short.label", "Short", "pack review page: boilerplate length, short"],
  ["front-door.pack-review-boilerplate-medium.label", "Medium", "pack review page: boilerplate length, medium"],
  ["front-door.pack-review-boilerplate-long.label", "Long", "pack review page: boilerplate length, long"],
  ["front-door.pack-review-faq.label", "FAQ", "pack review page: voice and copy, questions and answers"],
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

/** The words `resolvePackReviewSections` places beside the records' own words. */
export interface PackReviewSectionText {
  /** The line naming the strategy brief's source. */
  strategySource: { contract: string; brief: string };
  /** Leads each claim the Strategist contract still marks as a hypothesis. */
  hypothesis: string;
  /** Each engagement-context field's name, and the question shown while it is unanswered. */
  contextFields: Readonly<Record<EngagementContextFieldId, { label: string; question: string }>>;
  brandUsage: string;
  specimen: string;
  brandFacts: { brand: string; entity: string; origin: string };
  voiceRules: { person: string; tense: string; formality: string; tone: string };
  pitch: { oneLiner: string; elevator: string; paragraph: string };
  boilerplate: { short: string; medium: string; long: string };
}

/** What the page shows around the view, resolved. */
export interface PackReviewText {
  heading: string;
  description: string;
  surfaceLabel: string;
  labels: PackReviewViewLabels;
  sections: PackReviewSectionText;
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
  const contextField = (id: EngagementContextFieldId) => ({
    label: text(`front-door.pack-review-context-${id}.label`),
    question: text(`front-door.pack-review-context-${id}.notice`),
  });
  return {
    heading,
    description,
    surfaceLabel,
    labels: {
      strategy: {
        heading: text("front-door.pack-review-strategy.label"),
        empty: text("front-door.pack-review-strategy-empty.notice"),
        summary: text("front-door.pack-review-strategy-summary.label"),
        context: text("front-door.pack-review-strategy-context.label"),
        openQuestions: text("front-door.pack-review-strategy-questions.label"),
      },
      brandKit: {
        heading: text("front-door.pack-review-brand-kit.label"),
        empty: text("front-door.pack-review-brand-kit-empty.notice"),
        assets: text("front-door.pack-review-brand-assets.label"),
        colors: text("front-door.pack-review-brand-colors.label"),
        type: text("front-door.pack-review-brand-type.label"),
        specimen: text("front-door.pack-review-brand-specimen.label"),
        facts: text("front-door.pack-review-brand-facts.label"),
      },
      voice: {
        heading: text("front-door.pack-review-voice.label"),
        empty: text("front-door.pack-review-voice-empty.notice"),
        rules: text("front-door.pack-review-voice-rules.label"),
        tagline: text("front-door.pack-review-tagline.label"),
        pitch: text("front-door.pack-review-pitch.label"),
        boilerplate: text("front-door.pack-review-boilerplate.label"),
        faq: text("front-door.pack-review-faq.label"),
      },
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
    sections: {
      strategySource: {
        contract: text("front-door.pack-review-strategy-contract.notice"),
        brief: text("front-door.pack-review-strategy-brief.notice"),
      },
      hypothesis: text("front-door.pack-review-strategy-hypothesis.label"),
      contextFields: {
        business: contextField("business"),
        product: contextField("product"),
        audience: contextField("audience"),
        stage: contextField("stage"),
        intent: contextField("intent"),
        constraints: contextField("constraints"),
      },
      brandUsage: text("front-door.pack-review-brand-kit.description"),
      specimen: text("front-door.pack-review-brand-specimen.description"),
      brandFacts: {
        brand: text("front-door.pack-review-fact-brand.label"),
        entity: text("front-door.pack-review-fact-entity.label"),
        origin: text("front-door.pack-review-fact-origin.label"),
      },
      voiceRules: {
        person: text("front-door.pack-review-voice-person.label"),
        tense: text("front-door.pack-review-voice-tense.label"),
        formality: text("front-door.pack-review-voice-formality.label"),
        tone: text("front-door.pack-review-voice-tone.label"),
      },
      pitch: {
        oneLiner: text("front-door.pack-review-pitch-one-liner.label"),
        elevator: text("front-door.pack-review-pitch-elevator.label"),
        paragraph: text("front-door.pack-review-pitch-paragraph.label"),
      },
      boilerplate: {
        short: text("front-door.pack-review-boilerplate-short.label"),
        medium: text("front-door.pack-review-boilerplate-medium.label"),
        long: text("front-door.pack-review-boilerplate-long.label"),
      },
    },
    unavailable: {
      title: text("front-door.pack-review-unavailable.title"),
      description: text("front-door.pack-review-unavailable.description"),
      action: text("front-door.pack-review-unavailable.primary"),
    },
  };
}
