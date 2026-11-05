/**
 * CANDIDATE-OPTIONS: how many candidates each slot offers for choice, as data.
 *
 * One committed mapping per L2 group (`<l1>/<l2>` from ia.json). A class says how
 * many distinct candidates a slot must hold (`options`), the axis they differ on
 * (`varyOn`) and the allowed values of that axis. `clossys options --classes`
 * writes `options`/`varyOn` into each choice slot's slot.json from this table;
 * `check:slot-options` fails when a slot drifts from it or holds too few
 * distinct candidates. Slot overrides are listed here too, never hand-edited.
 */
import type { SlotAgent } from "./types.js";

export interface OptionClass {
  readonly id: string;
  /** Distinct candidates the slot must hold. */
  readonly options: 1 | 2 | 3;
  /** The axis candidates differ on; only for options > 1. */
  readonly varyOn?: string;
  /** Allowed values of the axis, in display order. */
  readonly values?: readonly string[];
  readonly summary: string;
}

export const OPTION_CLASSES: Readonly<Record<string, OptionClass>> = {
  "director.choice": { id: "director.choice", options: 3, varyOn: "angle", values: ["grounded", "ambitious", "human"], summary: "Director identity, aspiration and advantage: three framings of the same recorded findings." },
  "director.single": { id: "director.single", options: 1, summary: "Director context, focus, capability and execution: one sourced candidate." },
  "writer.choice": { id: "writer.choice", options: 3, varyOn: "tone", values: ["plain", "bold", "warm"], summary: "Writer headlines, taglines, calls to action, hero and page intros, messaging kit: three tones of the same keys." },
  "writer.narrative": { id: "writer.narrative", options: 3, varyOn: "arc", values: ["problem-first", "proof-first", "action-first"], summary: "Writer narratives: three orderings of the same passages and beats." },
  "writer.system": { id: "writer.system", options: 1, summary: "Writer system strings: one candidate, bulk-pinned; Studio shows confirm." },
};

/** Agent -> `<l1>/<l2>` -> class id. Every Director and Writer L2 group is listed. */
export const OPTION_GROUPS: Readonly<Partial<Record<SlotAgent, Readonly<Record<string, string>>>>> = {
  director: {
    "context/context.market": "director.single", "context/context.customer": "director.single", "context/context.competition": "director.single", "context/context.company": "director.single",
    "aspiration/aspiration.purpose": "director.choice", "aspiration/aspiration.culture": "director.choice", "aspiration/aspiration.goal": "director.choice",
    "focus/focus.category": "director.single", "focus/focus.segment": "director.single", "focus/focus.offer": "director.single", "focus/focus.reach": "director.single", "focus/focus.lifecycle": "director.single",
    "advantage/advantage.proposition": "director.choice", "advantage/advantage.defensibility": "director.choice", "advantage/advantage.model": "director.choice",
    "identity/identity.brand": "director.choice", "identity/identity.naming": "director.choice", "identity/identity.verbal": "director.choice", "identity/identity.visual": "director.choice",
    "capability/capability.competency": "director.single", "capability/capability.sourcing": "director.single", "capability/capability.operation": "director.single", "capability/capability.team": "director.single", "capability/capability.resource": "director.single",
    "execution/execution.priority": "director.single", "execution/execution.roadmap": "director.single", "execution/execution.measure": "director.single", "execution/execution.risk": "director.single",
  },
  writer: {
    "lexicon.voice/voice-tone": "writer.system", "lexicon.voice/voice-person-and-mood": "writer.system", "lexicon.voice/voice-rhythm": "writer.system",
    "lexicon.terminology/terminology-brand-names": "writer.system", "lexicon.terminology/terminology-glossary": "writer.system", "lexicon.terminology/terminology-avoid-list": "writer.system", "lexicon.terminology/terminology-spelling": "writer.system", "lexicon.terminology/terminology-pronunciation": "writer.system",
    "lexicon.claims/claims-product-facts": "writer.system", "lexicon.claims/claims-metrics": "writer.system", "lexicon.claims/claims-legal-and-compliance": "writer.system", "lexicon.claims/claims-comparisons": "writer.system",
    "lexicon.formats/formats-numbers-and-plurals": "writer.system", "lexicon.formats/formats-dates-and-times": "writer.system", "lexicon.formats/formats-currency-and-units": "writer.system", "lexicon.formats/formats-punctuation-and-capitalization": "writer.system", "lexicon.formats/formats-direction-and-expansion": "writer.system",
    "strings.interface/interface-actions": "writer.system", "strings.interface/interface-navigation": "writer.system", "strings.interface/interface-field-labels": "writer.system", "strings.interface/interface-statuses": "writer.system", "strings.interface/interface-counters": "writer.system",
    "strings.feedback/feedback-errors": "writer.system", "strings.feedback/feedback-warnings": "writer.system", "strings.feedback/feedback-confirmations": "writer.system", "strings.feedback/feedback-empty": "writer.system", "strings.feedback/feedback-loading": "writer.system",
    "strings.identity/identity-names": "writer.system", "strings.identity/identity-taglines": "writer.choice", "strings.identity/identity-legal-lines": "writer.system",
    "strings.media-text/media-text-alt-text": "writer.system", "strings.media-text/media-text-captions": "writer.system", "strings.media-text/media-text-transcripts": "writer.system",
    "strings.metadata/metadata-page-titles": "writer.system", "strings.metadata/metadata-descriptions": "writer.system", "strings.metadata/metadata-share-text": "writer.system", "strings.metadata/metadata-email-subject-and-preheader": "writer.system",
    "patterns.headings/headings-headlines": "writer.choice", "patterns.headings/headings-section-titles": "writer.system",
    "patterns.actions/actions-calls-to-action": "writer.choice", "patterns.actions/actions-links": "writer.system",
    "patterns.messages/messages-problems": "writer.system", "patterns.messages/messages-outcomes": "writer.system", "patterns.messages/messages-states": "writer.system", "patterns.messages/messages-help": "writer.system",
    "patterns.forms/forms-fields": "writer.system", "patterns.forms/forms-consent": "writer.system",
    "patterns.data-and-lists/data-and-lists-items": "writer.system", "patterns.data-and-lists/data-and-lists-tables": "writer.system",
    "patterns.attribution/attribution-quotes": "writer.system", "patterns.attribution/attribution-figures": "writer.system",
    "patterns.identity/identity-messaging-kit": "writer.choice",
    "passages.parts/parts-structure": "writer.system", "passages.parts/parts-navigation": "writer.system",
    "passages.explain/explain-introductions": "writer.choice", "passages.explain/explain-reading": "writer.system", "passages.explain/explain-promotion": "writer.choice", "passages.explain/explain-social-proof": "writer.system", "passages.explain/explain-media": "writer.system", "passages.explain/explain-guidance": "writer.system",
    "passages.organize/organize-collections": "writer.system", "passages.organize/organize-comparison": "writer.system", "passages.organize/organize-summaries": "writer.system", "passages.organize/organize-records": "writer.system", "passages.organize/organize-history": "writer.system",
    "passages.collect/collect-forms": "writer.system", "passages.collect/collect-workflows": "writer.system", "passages.collect/collect-preferences": "writer.system", "passages.collect/collect-configuration": "writer.system", "passages.collect/collect-conversation": "writer.system", "passages.collect/collect-inputs": "writer.system",
    "passages.navigate/navigate-indexes": "writer.system", "passages.navigate/navigate-discovery": "writer.system",
    "passages.respond/respond-states": "writer.system", "passages.respond/respond-messages": "writer.system",
    "narratives.web/web-site-and-demo": "writer.narrative", "narratives.web/web-app-and-admin": "writer.narrative", "narratives.web/web-chrome": "writer.system",
    "narratives.documents/documents-docs": "writer.system", "narratives.documents/documents-slides": "writer.narrative",
    "narratives.communications/communications-messages": "writer.system", "narratives.communications/communications-videos": "writer.narrative",
  },
};

/**
 * Per-slot exceptions to the group class, each with its reason. The logo name
 * slots carry the pinned Director name verbatim, so they offer no tone choice.
 */
export const OPTION_OVERRIDES: Readonly<Partial<Record<SlotAgent, Readonly<Record<string, { readonly class: string; readonly reason: string }>>>>> = {
  writer: {
    "passages.logo-hero": { class: "writer.system", reason: "renders the pinned identity.naming.name verbatim" },
    "passages.logo-mark": { class: "writer.system", reason: "renders the pinned identity.naming.name verbatim" },
  },
};

export interface OptionTable {
  readonly classes: Readonly<Record<string, OptionClass>>;
  readonly groups: Readonly<Partial<Record<SlotAgent, Readonly<Record<string, string>>>>>;
  readonly overrides: Readonly<Partial<Record<SlotAgent, Readonly<Record<string, { readonly class: string; readonly reason: string }>>>>>;
}
export const OPTION_TABLE: OptionTable = { classes: OPTION_CLASSES, groups: OPTION_GROUPS, overrides: OPTION_OVERRIDES };
