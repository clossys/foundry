/**
 * clossys.page/1 under the Publisher page checks (foundry-build-0048 U4b; DECISION 0048-PAGE-SHAPE: one page shape).
 * A page record names a Designer frame, its Designer sections in order and Writer copy refs; Publisher's
 * `checkPageOption` judges a layout-role option. This adapter reads the record as that option, so the same checks
 * judge it and no second page shape is ever written:
 *
 * - the layout is the page slot's layout whose frame the record names (the one whose roles admit every section first);
 * - a section's copy is its binding (`bindings.<section>.copy`) whose Writer slot is `<section>.copy`, else its first;
 *   a data-bound record section (its Designer contract binds the clossys records it reads `host-injected`,
 *   foundry-build-0048 U20) binds no copy: its words are the records, so a binding on it is a finding;
 * - a section's role is the `<role>` of that copy's record key `<page>.<role>`, else the first free role that admits
 *   the section, else the section's own leaf name (which no layout role then admits);
 * - the page metadata record is the record's `title`, which must be a Writer ref (never text, no fallback);
 * - the route is the record's own `path`, which must be the page slot's path.
 *
 * The option keeps only refs, so the record itself is scanned for words and styling before it is read (fix rounds 1-2):
 * every display string anywhere in it must be a Writer key (the ST-P `page.no-inline-copy` scan), no key anywhere is a
 * style key (the style keys the option form's `page.no-style` refuses), the record's `copy` map and every binding carry
 * only Writer refs, `meta` and `nav` are closed sets, and a section entry is a Designer section id string.
 *
 * Pure: the caller passes the page slot contract, a layout lookup and the Designer catalog.
 */
import { noInlineCopy } from "../constitution/criteria/publisher/st-p/page.js";

export const PAGE_SCHEMA = "clossys.page/1";

export interface PageOptionFinding { readonly check: string; readonly message: string }
export interface LayoutRoles { readonly kind?: string; readonly frame?: string; readonly roles?: Readonly<Record<string, { readonly kinds: readonly string[]; readonly required: boolean }>> }
export interface PageSlotContract { readonly kind?: string; readonly publication?: string; readonly path?: string; readonly layouts?: readonly string[]; readonly records?: { readonly pattern: string; readonly meta: string } }

/** The fields a clossys.page/1 record carries; anything else is a place for words or styling. */
const PAGE_RECORD_FIELDS = new Set(["schema", "path", "slug", "title", "frame", "sections", "copy", "bindings", "nav", "meta"]);
/** The fields a section binding carries (validate.ts: section instance key -> copy slot -> Writer key). */
const BINDING_FIELDS = new Set(["copy"]);
/**
 * The closed `meta` and `nav` sets (fix round 2), as the option form closes its own `meta`: candidate provenance
 * (candidate.schema.json meta: source, vary, slot) plus the migrated publication entry; the Studio nav flags R01 reads.
 */
const META_FIELDS = new Set(["source", "vary", "slot", "entry"]);
const NAV_FIELDS = new Set(["nav", "hidden", "group"]);
const NAV_GROUP = /^[a-z][a-z0-9-]*$/;
/**
 * Style keys: the same keys Publisher's option-form `inlineCopyFindings` refuses as `page.no-style`
 * (@clossys/publisher STYLE_KEYS); publisher.test.ts (not shipped) pins the two verdicts equal.
 */
const STYLE_KEYS = /^(?:class|className|style|styles|css|tw|color|colour|background|font|fontSize|padding|margin|spacing|theme)$/i;
/** A Writer key ref `<writer slot>#<key>`. */
const COPY_REF = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3}#[^\s#]+$/;
const ROLE = /^[a-z][a-z0-9-]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const refsOf = (copy: unknown): string[] => (isRecord(copy) ? Object.values(copy).filter((value): value is string => typeof value === "string") : []);

/** A parsed candidate file is a clossys.page/1 record. */
export const isPageRecord = (value: unknown): value is Record<string, unknown> => isRecord(value) && value.schema === PAGE_SCHEMA;

/** The contract fixture a page record certifies under: its own route (`{route: {path}}`), or none without a path. */
export function pageFixtureOf(record: Record<string, unknown>): { route: { path: string } } | undefined {
  return typeof record.path === "string" ? { route: { path: record.path } } : undefined;
}

/** One lower-case kebab path segment: the only shape a page record's slug may take. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A page record read as the layout-role option `checkPageOption` judges, plus what only the record form can get wrong. */
export function pageOptionOf(
  slotId: string,
  record: Record<string, unknown>,
  page: PageSlotContract,
  layoutOf: (id: string) => LayoutRoles | undefined,
  /** The slugs a `<slug>` route may not take (Publisher `reservedSlugs`: the routes of a fixed publication, `/admin`). */
  reserved: readonly string[] = [],
  /** The Designer section ids that are data-bound record sections (admin-plan.ts `dataBoundSections`). */
  dataBound: ReadonlySet<string> = new Set(),
): { content: Record<string, unknown>; layoutId?: string; layout?: LayoutRoles; findings: PageOptionFinding[] } {
  const findings: PageOptionFinding[] = [];
  const add = (check: string, message: string) => findings.push({ check, message: `${slotId}: ${message}` });
  for (const finding of recordWordsAndStyle(record)) add(finding.check, finding.message);
  const hasPath = typeof record.path === "string", hasSlug = typeof record.slug === "string";
  if (!hasPath && !hasSlug) add("page.route", "names no route: a page record carries a path or a slug");
  else if (hasPath && hasSlug) add("page.route", "names both a path and a slug; a page record carries one");
  if (typeof page.path === "string" && hasPath && record.path !== page.path) add("page.route", `routes ${String(record.path)}, not the page slot's ${page.path}`);
  // A slug is one route segment, lower-case kebab: anything else (a slash, a case or whitespace variant) could claim or
  // shadow another route, so it is refused before the reserved compare, which is then exact on a canonical segment.
  const slugShaped = hasSlug && SLUG.test(record.slug as string);
  if (hasSlug && !slugShaped) add("page.route", `slug ${JSON.stringify(record.slug)} is not one lower-case path segment (a-z, 0-9, single hyphens); a page record's slug is one route segment`);
  if (slugShaped && typeof page.path === "string" && page.path.includes("<slug>") && reserved.includes(record.slug as string)) {
    add("page.route", `slug ${String(record.slug)} is reserved: ${page.path.replace("<slug>", String(record.slug))} is a route of a publication every consumer holds (the admin workspace); pick another slug`);
  }

  // A section entry is its instance key `<slot>[#n]`; its binding is keyed by that key, its unit by the slot id.
  const entries = (Array.isArray(record.sections) ? record.sections : []).filter((id): id is string => typeof id === "string");
  const sections = entries.map(key => key.split("#")[0]!);
  const frame = typeof record.frame === "string" ? `designer/${record.frame}` : undefined;
  const layouts = (page.layouts ?? []).map(ref => ({ ref, layout: layoutOf(ref.replace(/^publisher\//, "")) }))
    .filter((entry): entry is { ref: string; layout: LayoutRoles } => entry.layout?.kind === "layout" && entry.layout.frame === frame);
  const admits = (layout: LayoutRoles, id: string) => Object.values(layout.roles ?? {}).some(role => role.kinds.includes(`designer/${id}`));
  const chosen = layouts.find(entry => sections.every(id => admits(entry.layout, id))) ?? layouts[0];
  if (!chosen) add("page.layout-allowed", `frame ${String(record.frame)} is the frame of no layout the page slot allows (${(page.layouts ?? []).join(", ")})`);

  const prefix = page.records?.pattern.replace(/\.<role>$/, "") ?? slotId.replace(/^page\./, "");
  const roles = chosen?.layout.roles ?? {};
  const taken = new Set<string>();
  const bindingOf = (key: string): unknown => (isRecord(record.bindings) ? record.bindings[key] : undefined);
  const placed = sections.map((id, index) => {
    const key0 = entries[index]!;
    const binding = bindingOf(key0);
    const bound = refsOf(isRecord(binding) ? binding.copy : undefined);
    const recordSection = dataBound.has(id);
    const copy = recordSection ? undefined : bound.find(ref => ref.startsWith(`${id}.copy#`)) ?? bound[0];
    if (recordSection && binding !== undefined) add("page.record-key", `${key0} is a data-bound record section: it renders the clossys records it reads and binds no Writer copy (remove bindings.${key0})`);
    else if (copy === undefined && !recordSection) add("page.record-key", `${key0} binds no Writer record (bindings.${key0}.copy)`);
    const key = copy?.slice(copy.indexOf("#") + 1);
    const fromKey = key?.startsWith(`${prefix}.`) ? key.slice(prefix.length + 1) : undefined;
    const role = fromKey && ROLE.test(fromKey) ? fromKey
      : Object.keys(roles).find(name => !taken.has(name) && roles[name]!.kinds.includes(`designer/${id}`)) ?? id.replace(/^[a-z]+\./, "");
    taken.add(role);
    return { role, use: `designer/${id}`, ...(copy !== undefined ? { copy: `writer/${copy}` } : {}) };
  });

  // The metadata record is the title ref; a title that is not one is a finding (recordWordsAndStyle), never a fallback.
  const meta = typeof record.title === "string" && COPY_REF.test(record.title) ? record.title : undefined;
  const content: Record<string, unknown> = {
    ...(typeof record.path === "string" ? { path: record.path } : {}),
    ...(chosen ? { layout: chosen.ref } : {}),
    sections: placed,
    // No metadata ref leaves meta out, so checkPageOption reports the missing Writer meta record.
    ...(meta !== undefined ? { meta: { copy: `writer/${meta}` } } : {}),
  };
  return { content, ...(chosen ? { layoutId: chosen.ref.replace(/^publisher\//, ""), layout: chosen.layout } : {}), findings };
}

/** Where a page record holds words or styling: the record form of `page.no-inline-copy` and `page.no-style`. */
function recordWordsAndStyle(record: Record<string, unknown>): PageOptionFinding[] {
  const findings: PageOptionFinding[] = [];
  const copy = (where: string, detail: string) => findings.push({ check: "page.no-inline-copy", message: `${where}: ${detail}` });
  const style = (where: string) => findings.push({ check: "page.no-style", message: `${where}: a page record holds no styling` });
  for (const key of Object.keys(record)) if (!PAGE_RECORD_FIELDS.has(key) && !STYLE_KEYS.test(key)) copy(`page.${key}`, "not a clossys.page/1 field; words come from a Writer record");
  // Style keys at any depth, outside the record's own provenance note.
  const walk = (value: unknown, path: string[]): void => {
    if (Array.isArray(value)) value.forEach((item, index) => walk(item, [...path, String(index)]));
    else if (isRecord(value)) for (const [key, item] of Object.entries(value)) {
      const next = [...path, key];
      if (next.join(".") === "meta.source") continue;
      if (STYLE_KEYS.test(key)) style(next.join("."));
      else walk(item, next);
    }
  };
  walk(record, []);
  // Display strings at any depth are Writer keys (the ST-P scan); the title is judged on its own below.
  for (const failure of noInlineCopy({ kind: "page", text: "", json: record }, {})) if (!failure.startsWith("title ")) copy("page", failure);
  if (record.title !== undefined && (typeof record.title !== "string" || !COPY_REF.test(record.title))) {
    copy("page.title", `${JSON.stringify(record.title)} is not a Writer ref <writer slot>#<key>; the title names the page's Writer meta record`);
  }
  // The record's own copy map: every value is a Writer ref, never words (fix round 2).
  if (record.copy !== undefined && !isRecord(record.copy)) copy("page.copy", "maps copy slots to Writer refs <writer slot>#<key>");
  if (isRecord(record.copy)) for (const [slot, ref] of Object.entries(record.copy)) {
    if (!STYLE_KEYS.test(slot) && (typeof ref !== "string" || !COPY_REF.test(ref))) copy(`page.copy.${slot}`, `${JSON.stringify(ref)} is not a Writer ref <writer slot>#<key>; words come from a Writer record`);
  }
  if (record.meta !== undefined && !isRecord(record.meta)) copy("meta", "meta is the record's provenance object");
  if (isRecord(record.meta)) for (const key of Object.keys(record.meta)) {
    if (!META_FIELDS.has(key) && !STYLE_KEYS.test(key)) copy(`meta.${key}`, "not a page record meta field; page metadata words come from the Writer meta record");
  }
  if (record.nav !== undefined && !isRecord(record.nav)) copy("nav", "nav is {nav, hidden, group} flags");
  if (isRecord(record.nav)) for (const [key, value] of Object.entries(record.nav)) {
    if (STYLE_KEYS.test(key)) continue;
    if (!NAV_FIELDS.has(key)) copy(`nav.${key}`, "not a nav field (nav, hidden, group); words come from a Writer record");
    else if (key === "group" ? typeof value !== "string" || !NAV_GROUP.test(value) : typeof value !== "boolean") copy(`nav.${key}`, key === "group" ? "a nav group is an id, never text" : "a nav flag is true or false");
  }
  if (Array.isArray(record.sections)) record.sections.forEach((entry, index) => {
    if (typeof entry !== "string") copy(`sections[${index}]`, "a section entry is a Designer section id <slot>[#n], never an object or text");
  });
  if (record.bindings !== undefined && !isRecord(record.bindings)) copy("bindings", "bindings map section instance keys to Writer copy refs");
  if (isRecord(record.bindings)) for (const [key, binding] of Object.entries(record.bindings)) {
    if (!isRecord(binding)) { copy(`bindings.${key}`, "a binding is {copy: {<copy slot>: <writer slot>#<key>}}, never text"); continue; }
    for (const [field, value] of Object.entries(binding)) {
      if (STYLE_KEYS.test(field)) continue;
      if (!BINDING_FIELDS.has(field)) { copy(`bindings.${key}.${field}`, "not a binding field; words come from the Writer record"); continue; }
      if (!isRecord(value)) copy(`bindings.${key}.copy`, "maps copy slots to Writer refs <writer slot>#<key>");
      else for (const [slot, ref] of Object.entries(value)) if (typeof ref !== "string" || !COPY_REF.test(ref)) copy(`bindings.${key}.copy.${slot}`, `${JSON.stringify(ref)} is not a Writer ref <writer slot>#<key>`);
    }
  }
  return findings;
}

/** The Publisher check API slice the record checks call. */
export interface PageCheckApi {
  checkPageOption(pageId: string, content: Record<string, unknown>, page: unknown, layout: unknown, designer: unknown): readonly PageOptionFinding[];
  slotContract(id: string): unknown;
  /** The slugs a `<slug>` route of the publication may not take; absent in a Publisher packed before foundry-build-0048. */
  reservedSlugs?(publication?: string): readonly string[];
}

/** Every finding of one clossys.page/1 record: the adapter's own, then Publisher's `checkPageOption` over the read option. */
export function pageRecordFindings(api: PageCheckApi, slotId: string, record: Record<string, unknown>, page: PageSlotContract, designer: unknown, dataBound: ReadonlySet<string> = new Set()): { findings: PageOptionFinding[]; layoutId?: string; layout?: LayoutRoles } {
  const option = pageOptionOf(slotId, record, page, id => api.slotContract(id) as LayoutRoles | undefined, api.reservedSlugs?.(page.publication) ?? [], dataBound);
  const findings = [...option.findings, ...api.checkPageOption(slotId, option.content, page, option.layout, designer)];
  return { findings, ...(option.layoutId ? { layoutId: option.layoutId, layout: option.layout } : {}) };
}
