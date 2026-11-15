/**
 * Page option checks (ia-target/publisher.md 9.4.2; absorbs foundry-audit-0018). A page option places one section per
 * layout role. The role is the section's instance key: unique on the page, so one Designer section kind may appear twice
 * under two roles, and the Writer record key `<page>.<role>` stays unique. Publisher assembles only: a page option names
 * a Designer unit and a Writer record key per role, never words and never styling.
 *
 * Pure functions: the caller passes the page and layout contracts and the live Designer catalog.
 */

export interface PlacedSection { role?: unknown; use?: unknown; variant?: unknown; copy?: unknown; links?: unknown; [key: string]: unknown }
export interface PageOptionContent { layout?: unknown; sections?: unknown; meta?: unknown; [key: string]: unknown }
export interface RoleContract { kinds: readonly string[]; required: boolean }
export interface LayoutContract { frame?: string; chrome?: readonly string[]; roles?: Readonly<Record<string, RoleContract>> }
export interface PageContract { layouts: readonly string[]; records?: { pattern: string; meta: string } }
export interface DesignerIds { live: ReadonlySet<string>; retired: ReadonlySet<string> }

export interface PageFinding { check: string; message: string }

/** Fields a page option may carry: everything else is a place for words or styling. */
const PAGE_FIELDS = new Set(["path", "status", "collection", "layout", "sections", "meta"]);
const SECTION_FIELDS = new Set(["role", "use", "variant", "copy", "links"]);
const META_FIELDS = new Set(["copy", "indexing", "shareImage"]);
const STYLE_KEYS = /^(?:class|className|style|styles|css|tw|color|colour|background|font|fontSize|padding|margin|spacing|theme)$/i;

/** A role (instance key) is one lowercase id segment. */
export const INSTANCE_KEY = /^[a-z][a-z0-9-]*$/;
/** A variant value is a Designer axis token, never prose or a style value. */
const AXIS_TOKEN = /^[a-z][a-z0-9-]*$/;
/** A Writer record ref: `writer/<slot>#<record>`. */
const WRITER_REF = /^writer\/([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+)#([a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+)$/;
/** A link target: a Publisher page id, optionally with `#<role>` on that page. */
const PAGE_LINK = /^publisher\/page\.[a-z0-9][a-z0-9-]*(?:#[a-z][a-z0-9-]*)?$/;
const PATH = /^\/[a-z0-9<>/-]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const unitId = (ref: string): string => ref.replace(/^designer\//, "");

/** `page.no-inline-copy` and `page.no-style` over the whole option: unknown fields, style keys and prose values fail. */
export function inlineCopyFindings(content: PageOptionContent): PageFinding[] {
  const findings: PageFinding[] = [];
  const style = (where: string, key: string) => findings.push({ check: "page.no-style", message: `${where}.${key}: a page option holds no styling` });
  const copy = (where: string, detail: string) => findings.push({ check: "page.no-inline-copy", message: `${where}: ${detail}` });
  for (const [key, value] of Object.entries(content)) {
    if (STYLE_KEYS.test(key)) { style("page", key); continue; }
    if (!PAGE_FIELDS.has(key)) { copy(`page.${key}`, "not a page option field; words come from a Writer record"); continue; }
    if (key === "path" && (typeof value !== "string" || !PATH.test(value))) copy("page.path", "a path is a lowercase route, not text");
    if (key === "collection" && (typeof value !== "string" || !AXIS_TOKEN.test(value))) copy("page.collection", "a collection is an id, not text");
  }
  if (isRecord(content.meta)) {
    for (const [key, value] of Object.entries(content.meta)) {
      if (STYLE_KEYS.test(key)) style("meta", key);
      else if (!META_FIELDS.has(key)) copy(`meta.${key}`, "page metadata words come from the Writer meta record");
      else if (key === "copy" && (typeof value !== "string" || !WRITER_REF.test(value))) copy("meta.copy", "must be a Writer record ref writer/<slot>#<record>");
      else if (key !== "copy" && (typeof value !== "string" || !/^(?:[a-z][a-z0-9-]*|designer\/[a-z0-9.-]+)$/.test(value))) copy(`meta.${key}`, "must be a token or a Designer ref");
    }
  } else copy("meta", "a page option names its Writer meta record");
  const sections = Array.isArray(content.sections) ? content.sections : [];
  sections.forEach((section, index) => {
    const where = `sections[${index}]`;
    if (!isRecord(section)) { copy(where, "a section is an object {role, use, copy}"); return; }
    for (const [key, value] of Object.entries(section)) {
      if (STYLE_KEYS.test(key)) { style(where, key); continue; }
      if (!SECTION_FIELDS.has(key)) { copy(`${where}.${key}`, "not a section field; words come from the Writer record"); continue; }
      if (key === "copy" && (typeof value !== "string" || !WRITER_REF.test(value))) copy(`${where}.copy`, "must be a Writer record ref writer/<slot>#<record>, never text");
      if (key === "variant") {
        if (!isRecord(value)) copy(`${where}.variant`, "a variant is a map of Designer axis tokens");
        else for (const [axis, token] of Object.entries(value)) {
          if (STYLE_KEYS.test(axis)) style(`${where}.variant`, axis);
          else if (typeof token !== "string" || !AXIS_TOKEN.test(token)) copy(`${where}.variant.${axis}`, "a variant value is an axis token, never text or a style value");
        }
      }
      if (key === "links") {
        if (!isRecord(value)) copy(`${where}.links`, "links map a field to a page id");
        else for (const [field, target] of Object.entries(value)) {
          if (typeof target !== "string" || !PAGE_LINK.test(target)) copy(`${where}.links.${field}`, "a link target is a page id publisher/page.<id>[#<role>], never a path or text");
        }
      }
    }
  });
  return findings;
}

/**
 * Every check of one page option: instance keys, the layout pick, roles against the layout, units against the live
 * Designer catalog, record keys and no inline copy or styling.
 */
export function checkPageOption(
  pageId: string,
  content: PageOptionContent,
  page: PageContract,
  layout: LayoutContract | undefined,
  designer: DesignerIds,
): PageFinding[] {
  const findings: PageFinding[] = [];
  const add = (check: string, message: string) => findings.push({ check, message: `${pageId}: ${message}` });
  const record = page.records?.pattern.replace(/\.<role>$/, "") ?? pageId.replace(/^page\./, "");

  if (typeof content.layout !== "string" || !page.layouts.includes(content.layout)) add("page.layout-allowed", `layout ${String(content.layout)} is not one the page slot allows (${page.layouts.join(", ")})`);
  if (!layout?.roles) add("page.layout-allowed", `layout ${String(content.layout)} has no role contract`);
  const roles = layout?.roles ?? {};

  if (!Array.isArray(content.sections) || content.sections.length === 0) add("page.assembled", "a page places at least one section");
  const sections = (Array.isArray(content.sections) ? content.sections : []).filter(isRecord) as PlacedSection[];
  const keys = new Set<string>();
  sections.forEach((section, index) => {
    const key = section.role;
    if (typeof key !== "string" || !INSTANCE_KEY.test(key)) { add("page.instance-key", `sections[${index}] has no instance key (role)`); return; }
    if (keys.has(key)) add("page.instance-key", `instance key ${key} appears twice; each section on a page has its own role`);
    keys.add(key);
    const contract = roles[key];
    if (!contract) add("page.role-allowed", `role ${key} is not a role of ${String(content.layout)}`);
    const use = typeof section.use === "string" ? section.use : "";
    if (!use.startsWith("designer/sections.")) add("page.unit-resolves", `${key} places ${use || "nothing"}, not a Designer section`);
    else if (designer.retired.has(unitId(use))) add("page.unit-resolves", `${key} places retired ${use}`);
    else if (!designer.live.has(unitId(use))) add("page.unit-resolves", `${key} places ${use}, which the Designer catalog does not have`);
    if (contract && use && !contract.kinds.includes(use)) add("page.role-allowed", `${key} places ${use}; the role allows ${contract.kinds.join(", ")}`);
    if (typeof section.copy === "string") {
      const match = WRITER_REF.exec(section.copy);
      if (match && match[2] !== `${record}.${key}`) add("page.record-key", `${key} copy record ${match[2]} is not ${record}.${key}`);
      if (match && use && match[1] !== `${unitId(use)}.copy`) add("page.record-key", `${key} copy slot ${match[1]} is not ${unitId(use)}.copy`);
    }
  });
  for (const [role, contract] of Object.entries(roles)) if (contract.required && !keys.has(role)) add("page.required-roles", `required role ${role} is not placed`);
  for (const finding of inlineCopyFindings(content)) add(finding.check, finding.message);
  return findings;
}

/** A layout's frame and chrome units resolve to live Designer frames; every role kind is a live Designer section. */
export function checkLayoutUnits(layoutId: string, layout: LayoutContract, designer: DesignerIds): string[] {
  const findings: string[] = [];
  const resolve = (ref: string, what: string) => {
    const id = unitId(ref);
    if (!ref.startsWith("designer/")) findings.push(`${layoutId}: ${what} ${ref} is not a Designer ref`);
    else if (designer.retired.has(id)) findings.push(`${layoutId}: ${what} ${ref} is retired`);
    else if (!designer.live.has(id)) findings.push(`${layoutId}: ${what} ${ref} is not in the Designer catalog`);
  };
  if (!layout.frame?.startsWith("designer/frames.")) findings.push(`${layoutId}: frame ${String(layout.frame)} is not a Designer frame`);
  else resolve(layout.frame, "frame");
  for (const [role, contract] of Object.entries(layout.roles ?? {})) for (const kind of contract.kinds) resolve(kind, `role ${role} kind`);
  return findings;
}
