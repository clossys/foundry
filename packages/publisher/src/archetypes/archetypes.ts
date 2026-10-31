/**
 * Page archetypes: the composition-level reference Publisher owns. An
 * archetype is an ordered list of section roles. Each role names the Designer
 * section slot that fills it, the Writer passage slot (key group) that binds
 * its copy and, for optional roles, the Director cell whose presence turns the
 * role on. Data only: no markup, styling or copy lives here.
 */
import type { PageFormatId } from "./formats.js";

export const ARCHETYPE_IDS = ["marketing-home", "pricing", "contact", "legal", "docs", "app-page", "deck"] as const;
export type ArchetypeId = (typeof ARCHETYPE_IDS)[number];

export type SectionSlotId = `sections.${string}`;
export type WriterGroupId = `passages.${string}`;

export interface ArchetypeRole {
  /** Role id, unique inside its archetype. */
  readonly id: string;
  /** Primary Designer section slot id. */
  readonly section: SectionSlotId;
  /** Other Designer section slots that may fill the same role. */
  readonly alternates?: readonly SectionSlotId[];
  /** Writer passage slot that binds the primary section's copy. */
  readonly writer: WriterGroupId;
  readonly required: boolean;
  readonly min: number;
  readonly max: number;
  /** Director cell that turns an optional role on. */
  readonly gate?: string;
}

export interface PageArchetype {
  readonly id: ArchetypeId;
  /** Formats the archetype may be published as; the first is its default. */
  readonly formats: readonly PageFormatId[];
  /** Frames the archetype expects, narrower than the format's own list. Empty: any frame the format allows. */
  readonly frames: readonly `frames.${string}`[];
  readonly roles: readonly ArchetypeRole[];
}

const one = { min: 1, max: 1 } as const;
const req = (id: string, section: SectionSlotId, extra: Partial<ArchetypeRole> = {}): ArchetypeRole =>
  ({ id, section, writer: writerGroupOf(section), required: true, ...one, ...extra });
const opt = (id: string, section: SectionSlotId, gate: string | undefined, extra: Partial<ArchetypeRole> = {}): ArchetypeRole =>
  ({ id, section, writer: writerGroupOf(section), required: false, min: 0, max: 1, ...(gate ? { gate } : {}), ...extra });

/** Writer passage slots mirror Designer section slots one to one. */
export function writerGroupOf(section: string): WriterGroupId {
  return `passages.${section.replace(/^sections\./, "")}`;
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

const APP_BODY: readonly SectionSlotId[] = [
  "sections.resource-list", "sections.record-detail", "sections.data-grid", "sections.settings", "sections.form",
  "sections.cards", "sections.activity-feed", "sections.audit-log", "sections.access-matrix", "sections.account-summary",
  "sections.explorer", "sections.usage", "sections.status-list", "sections.task-list", "sections.wizard", "sections.chat",
  "sections.empty-state",
];

export const PAGE_ARCHETYPES: Readonly<Record<ArchetypeId, PageArchetype>> = freeze({
  "marketing-home": {
    id: "marketing-home", formats: ["vertical-page"], frames: ["frames.site-shell"],
    roles: [
      req("hero", "sections.hero"),
      opt("social-proof", "sections.logo-cloud", "advantage.proposition.proof"),
      req("value", "sections.features", { max: 3 }),
      opt("how-it-works", "sections.steps", "capability.operation.delivery"),
      opt("metrics", "sections.stats", "execution.measure.north-star"),
      opt("alternatives", "sections.comparison", "context.competition.alternative"),
      opt("testimonials", "sections.testimonials", "advantage.proposition.proof", { max: 2 }),
      opt("pricing", "sections.pricing", "advantage.model.pricing"),
      opt("questions", "sections.faq", "context.customer.buying"),
      req("closing-action", "sections.call-to-action"),
    ],
  },
  pricing: {
    id: "pricing", formats: ["vertical-page"], frames: ["frames.site-shell"],
    roles: [
      req("header", "sections.page-header"),
      req("plans", "sections.pricing"),
      opt("plan-comparison", "sections.comparison", "context.competition.alternative"),
      opt("testimonials", "sections.testimonials", "advantage.proposition.proof"),
      opt("questions", "sections.faq", "context.customer.buying"),
      opt("closing-action", "sections.call-to-action", undefined),
    ],
  },
  contact: {
    id: "contact", formats: ["vertical-page"], frames: ["frames.site-shell"],
    roles: [
      req("header", "sections.page-header"),
      req("form", "sections.form"),
      opt("channels", "sections.content", "focus.reach.channel"),
      opt("questions", "sections.faq", "context.customer.buying"),
    ],
  },
  legal: {
    id: "legal", formats: ["vertical-page"], frames: ["frames.site-shell", "frames.document"],
    roles: [
      opt("contents", "sections.table-of-contents", undefined),
      req("terms", "sections.legal-prose"),
    ],
  },
  docs: {
    id: "docs", formats: ["vertical-page"], frames: ["frames.site-shell", "frames.app-shell"],
    roles: [
      req("header", "sections.page-header"),
      opt("contents", "sections.table-of-contents", undefined),
      req("body", "sections.article", { alternates: ["sections.content"] }),
      opt("next", "sections.pagination", undefined),
      opt("related", "sections.link-index", undefined),
    ],
  },
  "app-page": {
    id: "app-page", formats: ["vertical-page", "canvas"], frames: ["frames.app-shell"],
    roles: [
      req("header", "sections.page-header"),
      opt("notices", "sections.notices", undefined),
      req("body", "sections.data-table", { alternates: APP_BODY, max: 4 }),
      opt("paging", "sections.pagination", undefined),
    ],
  },
  deck: {
    id: "deck", formats: ["slide"], frames: [],
    roles: [
      req("cover", "sections.hero"),
      opt("problem", "sections.section-header", "context.customer.need"),
      req("solution", "sections.features", { max: 3, alternates: ["sections.cards", "sections.media"] }),
      opt("proof", "sections.stats", "advantage.proposition.proof", { max: 2, alternates: ["sections.testimonials", "sections.logo-cloud"] }),
      opt("alternatives", "sections.comparison", "context.competition.alternative"),
      opt("model", "sections.pricing", "advantage.model.pricing"),
      opt("roadmap", "sections.timeline", "execution.roadmap.milestone"),
      opt("team", "sections.people", "capability.team.role"),
      req("close", "sections.call-to-action"),
    ],
  },
});

export function isArchetypeId(value: unknown): value is ArchetypeId {
  return typeof value === "string" && (ARCHETYPE_IDS as readonly string[]).includes(value);
}

/** Every Designer section slot a role accepts, primary first. */
export function roleSections(role: ArchetypeRole): readonly SectionSlotId[] {
  return [role.section, ...(role.alternates ?? [])];
}
