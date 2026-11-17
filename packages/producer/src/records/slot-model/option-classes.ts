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
  "writer.choice": { id: "writer.choice", options: 3, varyOn: "tone", values: ["plain", "bold", "warm"], summary: "Writer story section copy (hero, page intros, calls to action, pricing): three tones of the same keys." },
  "writer.narrative": { id: "writer.narrative", options: 3, varyOn: "arc", values: ["problem-first", "proof-first", "action-first"], summary: "Writer editorial narratives (articles, case studies): three orderings of the same beats." },
  "writer.system": { id: "writer.system", options: 1, summary: "Writer system strings: one candidate, bulk-pinned; Studio shows confirm." },
};

/** Agent -> `<l1>/<l2>` -> class id. Every Director and Writer L2 group is listed, keyed by the current trees. */
export const OPTION_GROUPS: Readonly<Partial<Record<SlotAgent, Readonly<Record<string, string>>>>> = {
  director: {
    "context/context.market": "director.single", "context/context.customer": "director.single", "context/context.competition": "director.single", "context/context.company": "director.single",
    "aspiration/aspiration.purpose": "director.choice", "aspiration/aspiration.culture": "director.choice",
    "focus/focus.category": "director.single", "focus/focus.segment": "director.single", "focus/focus.offer": "director.single", "focus/focus.reach": "director.single", "focus/focus.lifecycle": "director.single",
    "advantage/advantage.proposition": "director.choice", "advantage/advantage.defensibility": "director.choice", "advantage/advantage.economics": "director.single",
    "identity/identity.brand": "director.choice", "identity/identity.naming": "director.choice", "identity/identity.verbal": "director.choice", "identity/identity.visual": "director.choice",
    // The regrouped L2s (economics, targets, timeline, task force, plan) are single: none of their leaves offered options before the regroup.
    "targets/targets.goal": "director.single", "targets/targets.measure": "director.single",
    "timeline/timeline.priority": "director.single", "timeline/timeline.schedule": "director.single",
    "task-force/task-force.team": "director.single", "task-force/task-force.sourcing": "director.single",
    "plan/plan.resource": "director.single", "plan/plan.operation": "director.single", "plan/plan.risk": "director.single",
  },
  writer: {
    "voice.tone/attitude": "writer.system", "voice.tone/address": "writer.system", "voice.tone/rhythm": "writer.system",
    "voice.wording/mechanics": "writer.system", "voice.wording/terms": "writer.system",
    "prose.editorial/narratives": "writer.narrative", "prose.editorial/changelog": "writer.system",
    "prose.reference/help": "writer.system", "prose.reference/policies": "writer.system",
    "copy.component-text/actions": "writer.system", "copy.component-text/navigation": "writer.system", "copy.component-text/text-and-media": "writer.system", "copy.component-text/overlays": "writer.system",
    // Hero, page intro, call to action and pricing copy carry the headline, tagline and call-to-action shapes.
    "copy.section-copy/story": "writer.choice",
    "copy.section-copy/parts": "writer.system", "copy.section-copy/navigation": "writer.system", "copy.section-copy/reading": "writer.system", "copy.section-copy/records": "writer.system", "copy.section-copy/forms": "writer.system", "copy.section-copy/states": "writer.system",
    "copy.frame-copy/bars": "writer.system",
    "copy.asset-text/marks": "writer.system", "copy.asset-text/media": "writer.system",
    "copy.page-metadata/site": "writer.system", "copy.page-metadata/docs": "writer.system", "copy.page-metadata/app": "writer.system", "copy.page-metadata/slides": "writer.system",
  },
};

/**
 * Per-slot exceptions to the group class, each with its reason. None today: the logo name copy
 * (assets.lockup.copy, assets.mark.copy) renders the pinned Director name verbatim and its group,
 * copy.asset-text/marks, is already writer.system.
 */
export const OPTION_OVERRIDES: Readonly<Partial<Record<SlotAgent, Readonly<Record<string, { readonly class: string; readonly reason: string }>>>>> = {};

export interface OptionTable {
  readonly classes: Readonly<Record<string, OptionClass>>;
  readonly groups: Readonly<Partial<Record<SlotAgent, Readonly<Record<string, string>>>>>;
  readonly overrides: Readonly<Partial<Record<SlotAgent, Readonly<Record<string, { readonly class: string; readonly reason: string }>>>>>;
}
export const OPTION_TABLE: OptionTable = { classes: OPTION_CLASSES, groups: OPTION_GROUPS, overrides: OPTION_OVERRIDES };
