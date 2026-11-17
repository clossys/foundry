/**
 * clossys.page/1 under the Publisher page checks (foundry-build-0048 U4b; DECISION 0048-PAGE-SHAPE: one page shape).
 * A page record names a Designer frame, its Designer sections in order and Writer copy refs; Publisher's
 * `checkPageOption` judges a layout-role option. This adapter reads the record as that option, so the same checks
 * judge it and no second page shape is ever written:
 *
 * - the layout is the page slot's layout whose frame the record names (the one whose roles admit every section first);
 * - a section's copy is its binding (`bindings.<section>.copy`) whose Writer slot is `<section>.copy`, else its first;
 * - a section's role is the `<role>` of that copy's record key `<page>.<role>`, else the first free role that admits
 *   the section, else the section's own leaf name (which no layout role then admits);
 * - the page metadata record is the record's `title` ref (else `copy.meta`);
 * - the route is the record's own `path`, which must be the page slot's path.
 *
 * Pure: the caller passes the page slot contract, a layout lookup and the Designer catalog.
 */

export const PAGE_SCHEMA = "clossys.page/1";

export interface PageOptionFinding { readonly check: string; readonly message: string }
export interface LayoutRoles { readonly kind?: string; readonly frame?: string; readonly roles?: Readonly<Record<string, { readonly kinds: readonly string[]; readonly required: boolean }>> }
export interface PageSlotContract { readonly kind?: string; readonly path?: string; readonly layouts?: readonly string[]; readonly records?: { readonly pattern: string; readonly meta: string } }

/** The fields a clossys.page/1 record carries; anything else is a place for words or styling. */
const PAGE_RECORD_FIELDS = new Set(["schema", "path", "slug", "title", "frame", "sections", "copy", "bindings", "nav", "meta"]);
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

/** A page record read as the layout-role option `checkPageOption` judges, plus what only the record form can get wrong. */
export function pageOptionOf(
  slotId: string,
  record: Record<string, unknown>,
  page: PageSlotContract,
  layoutOf: (id: string) => LayoutRoles | undefined,
): { content: Record<string, unknown>; layoutId?: string; layout?: LayoutRoles; findings: PageOptionFinding[] } {
  const findings: PageOptionFinding[] = [];
  const add = (check: string, message: string) => findings.push({ check, message: `${slotId}: ${message}` });
  for (const key of Object.keys(record)) if (!PAGE_RECORD_FIELDS.has(key)) add("page.no-inline-copy", `page.${key}: not a clossys.page/1 field; words come from a Writer record`);
  if (typeof page.path === "string" && typeof record.path === "string" && record.path !== page.path) add("page.route", `routes ${record.path}, not the page slot's ${page.path}`);

  const sections = (Array.isArray(record.sections) ? record.sections : []).filter((id): id is string => typeof id === "string").map(id => id.split("#")[0]!);
  const frame = typeof record.frame === "string" ? `designer/${record.frame}` : undefined;
  const layouts = (page.layouts ?? []).map(ref => ({ ref, layout: layoutOf(ref.replace(/^publisher\//, "")) }))
    .filter((entry): entry is { ref: string; layout: LayoutRoles } => entry.layout?.kind === "layout" && entry.layout.frame === frame);
  const admits = (layout: LayoutRoles, id: string) => Object.values(layout.roles ?? {}).some(role => role.kinds.includes(`designer/${id}`));
  const chosen = layouts.find(entry => sections.every(id => admits(entry.layout, id))) ?? layouts[0];
  if (!chosen) add("page.layout-allowed", `frame ${String(record.frame)} is the frame of no layout the page slot allows (${(page.layouts ?? []).join(", ")})`);

  const prefix = page.records?.pattern.replace(/\.<role>$/, "") ?? slotId.replace(/^page\./, "");
  const roles = chosen?.layout.roles ?? {};
  const taken = new Set<string>();
  const placed = sections.map(id => {
    const bound = isRecord(record.bindings) ? refsOf(isRecord(record.bindings[id]) ? (record.bindings[id] as Record<string, unknown>).copy : undefined) : [];
    const copy = bound.find(ref => ref.startsWith(`${id}.copy#`)) ?? bound[0];
    if (copy === undefined) add("page.record-key", `${id} binds no Writer record (bindings.${id}.copy)`);
    const key = copy?.slice(copy.indexOf("#") + 1);
    const fromKey = key?.startsWith(`${prefix}.`) ? key.slice(prefix.length + 1) : undefined;
    const role = fromKey && ROLE.test(fromKey) ? fromKey
      : Object.keys(roles).find(name => !taken.has(name) && roles[name]!.kinds.includes(`designer/${id}`)) ?? id.replace(/^[a-z]+\./, "");
    taken.add(role);
    return { role, use: `designer/${id}`, ...(copy !== undefined ? { copy: `writer/${copy}` } : {}) };
  });

  const meta = typeof record.title === "string" && COPY_REF.test(record.title) ? record.title
    : isRecord(record.copy) && typeof record.copy.meta === "string" ? record.copy.meta : undefined;
  const content: Record<string, unknown> = {
    ...(typeof record.path === "string" ? { path: record.path } : {}),
    ...(chosen ? { layout: chosen.ref } : {}),
    sections: placed,
    // No metadata ref leaves meta out, so checkPageOption reports the missing Writer meta record.
    ...(meta !== undefined ? { meta: { copy: `writer/${meta}` } } : {}),
  };
  return { content, ...(chosen ? { layoutId: chosen.ref.replace(/^publisher\//, ""), layout: chosen.layout } : {}), findings };
}

/** The Publisher check API slice the record checks call. */
export interface PageCheckApi {
  checkPageOption(pageId: string, content: Record<string, unknown>, page: unknown, layout: unknown, designer: unknown): readonly PageOptionFinding[];
  slotContract(id: string): unknown;
}

/** Every finding of one clossys.page/1 record: the adapter's own, then Publisher's `checkPageOption` over the read option. */
export function pageRecordFindings(api: PageCheckApi, slotId: string, record: Record<string, unknown>, page: PageSlotContract, designer: unknown): { findings: PageOptionFinding[]; layoutId?: string; layout?: LayoutRoles } {
  const option = pageOptionOf(slotId, record, page, id => api.slotContract(id) as LayoutRoles | undefined);
  const findings = [...option.findings, ...api.checkPageOption(slotId, option.content, page, option.layout, designer)];
  return { findings, ...(option.layoutId ? { layoutId: option.layoutId, layout: option.layout } : {}) };
}
