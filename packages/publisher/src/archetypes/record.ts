/**
 * The page record the conformance check reads: one frame plus ordered
 * sections, the Writer copy each section binds, the page's route, navigation
 * and head metadata, its page actions and the links it renders. A record holds
 * references and bound values only; Publisher never authors any of them.
 *
 * `pageRecordsFromPublication` joins a consumer's own Publisher outputs (the
 * compiled content map, its route pack and page Copy bullets) with Writer's
 * compiled section bindings into these records.
 */
import type { ArchetypeId } from "./archetypes.js";
import type { PageFormatId } from "./formats.js";

export interface PageRecordCopy {
  /** Writer passage slot (key group) the section's copy comes from. */
  readonly group?: string;
  /** Writer section binding config id, when the copy is bound through one. */
  readonly config?: string;
  /** Bound content keys → Writer record refs. */
  readonly keys: Readonly<Record<string, string>>;
  /** Resolved copy values by key, when the caller has them (used for word budgets). */
  readonly text?: Readonly<Record<string, string>>;
}

export interface PageRecordSection {
  readonly section: string;
  /** Explicit archetype role; inferred from the section id when absent. */
  readonly role?: string;
  /** Absent or with no keys: the section has no Writer copy bound. */
  readonly copy?: PageRecordCopy;
  /** Hrefs this section renders (action destinations, link lists). */
  readonly links?: readonly string[];
}

export interface PageRecordAction {
  readonly id: string;
  readonly intent?: string;
}

export interface PageRecord {
  readonly id: string;
  readonly path: string;
  readonly archetype?: ArchetypeId | string;
  readonly format?: PageFormatId | string;
  readonly frame?: { readonly id: string; readonly members?: readonly string[] };
  readonly sections: readonly PageRecordSection[];
  /** Head metadata as Writer refs or resolved values; presence is what is checked. */
  readonly meta?: { readonly title?: string; readonly description?: string; readonly indexing?: "index" | "noindex" };
  readonly nav?: { readonly pinned: boolean; readonly label?: string };
  readonly actions?: readonly PageRecordAction[];
  /** Hrefs the frame renders for this page (navigation, footer links). */
  readonly links?: readonly string[];
}

export interface PageRecordSet {
  readonly records: readonly PageRecord[];
  /** Extra internal routes that resolve outside these records (for example redirects). */
  readonly routes?: readonly string[];
  /** Filled Director cell ids; enables the optional-role gate report. */
  readonly directorCells?: readonly string[];
}

type JsonObject = { readonly [key: string]: unknown };
const object = (value: unknown): value is JsonObject => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export interface PublicationInput {
  /** A compiled Publisher content map (`version`, `publicationId`, `format`, `entries`). */
  readonly contentMap: unknown;
  /** The publication's route pack (`routes[]` with `instanceId`, `path`, `slots[]`). */
  readonly routePack?: unknown;
  /** Writer compiled section bindings (`sectionId`, `configId`, `fields[]`). */
  readonly sectionBindings?: unknown;
  /** Page entry id → Copy bullet keys of its Publisher page cell (`meta-title`, `meta-description`, ...). */
  readonly pageCopy?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Page entry id → archetype and format; nothing is inferred from page names. */
  readonly pages?: Readonly<Record<string, { readonly archetype?: string; readonly format?: string }>>;
}

const META_KEYS = { title: "meta-title", description: "meta-description" } as const;
const NAV_KEYS = ["nav-label", "nav"] as const;

/** Join one publication's Publisher and Writer outputs into page records. Pure. */
export function pageRecordsFromPublication(input: PublicationInput): PageRecord[] {
  if (!object(input.contentMap) || !Array.isArray(input.contentMap.entries)) throw new TypeError("contentMap.entries is required");
  const routes = object(input.routePack) && Array.isArray(input.routePack.routes) ? input.routePack.routes.filter(object) : [];
  const bindings = Array.isArray(input.sectionBindings) ? input.sectionBindings.filter(object) : [];
  const binding = (section: string, config: string | undefined) =>
    config === undefined ? undefined : bindings.find(row => row.sectionId === section && row.configId === config);
  const pageFormat = input.contentMap.format === "deck.16x9" ? "slide" : "vertical-page";
  const records: PageRecord[] = [];
  for (const entry of input.contentMap.entries.filter(object)) {
    if (entry.kind !== "page" && entry.kind !== "slide") continue;
    const id = String(entry.id);
    const path = typeof entry.path === "string" ? entry.path : `/${String(entry.slug ?? id)}`;
    const route = routes.find(row => row.instanceId === id);
    const source = object(entry.source) ? entry.source : {};
    const routeSlots = route && Array.isArray(route.slots) ? route.slots.filter(object) : undefined;
    const slots = routeSlots ?? strings(source.sectionIds).map(section => ({ section }) as JsonObject);
    const sections: PageRecordSection[] = slots.map(slot => {
      const section = String(slot.section);
      const config = typeof slot.config === "string" ? slot.config : undefined;
      const bound = binding(section, config);
      const keys: Record<string, string> = {};
      for (const field of Array.isArray(bound?.fields) ? bound.fields.filter(object) : [])
        if (typeof field.key === "string" && object(field.ref) && typeof field.ref.id === "string") keys[field.key] = field.ref.id;
      const links = object(slot.data) ? Object.values(slot.data).filter((value): value is string => typeof value === "string" && /^(\/|#|https?:)/.test(value)) : [];
      return { section, ...(bound ? { copy: { config, keys } } : {}), ...(links.length ? { links } : {}) };
    });
    const copy = input.pageCopy?.[id] ?? {};
    const pin = object(entry.pin) ? entry.pin : undefined;
    const navLabel = NAV_KEYS.map(key => copy[key]).find(Boolean) ?? (typeof entry.title === "string" ? entry.title : undefined);
    const actions = Array.isArray(entry.actions) ? entry.actions.filter(object).map(action => ({ id: String(action.id), ...(typeof action.intent === "string" ? { intent: action.intent } : {}) })) : [];
    const description = copy[META_KEYS.description] ?? (typeof entry.description === "string" ? entry.description : undefined);
    const indexing = object(entry.indexing) && (entry.indexing.mode === "index" || entry.indexing.mode === "noindex") ? entry.indexing.mode : undefined;
    const meta: NonNullable<PageRecord["meta"]> = {
      ...(copy[META_KEYS.title] ? { title: copy[META_KEYS.title] } : {}),
      ...(description ? { description } : {}),
      ...(indexing ? { indexing } : {}),
    };
    const declared = input.pages?.[id];
    records.push({
      id, path,
      ...(declared?.archetype ? { archetype: declared.archetype } : {}),
      format: declared?.format ?? pageFormat,
      ...(typeof source.frameId === "string" ? { frame: { id: source.frameId } } : {}),
      sections, meta,
      nav: { pinned: pin?.nav === true, ...(navLabel ? { label: navLabel } : {}) },
      ...(actions.length ? { actions } : {}),
    });
  }
  return records;
}
