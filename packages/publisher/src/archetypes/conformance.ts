/**
 * Page conformance: checks page records against their archetype and format,
 * their Writer bindings, routes and links, head and navigation metadata, and
 * reported copy-fit measurements. Report only: every result is a finding, and
 * the exit code is non-zero only in strict mode with at least one error.
 * Pure: no file, network or renderer access.
 */
import { isContentMapExternalHref } from "../content-map/check.js";
import { PAGE_ARCHETYPES, isArchetypeId, roleSections } from "./archetypes.js";
import type { ArchetypeRole, PageArchetype } from "./archetypes.js";
import { PAGE_FORMATS, isPageFormatId } from "./formats.js";
import type { PageFormat } from "./formats.js";
import { sectionFormats } from "./section-formats.js";
import { COPY_FIT_WIDTHS } from "./copy-fit.js";
import type { CopyFitMeasurement } from "./copy-fit.js";
import type { PageRecord, PageRecordSet } from "./record.js";

export const PAGE_CHECKS = ["archetype", "format", "copy", "links", "meta", "copy-fit"] as const;
export type PageCheckId = (typeof PAGE_CHECKS)[number];
export type PageFindingSeverity = "error" | "warning" | "info";

export interface PageFinding {
  readonly check: PageCheckId;
  readonly code: string;
  readonly severity: PageFindingSeverity;
  readonly page: string;
  /** Section index inside the page record. */
  readonly section?: number;
  readonly role?: string;
  readonly message: string;
}

export interface PageConformanceSummary {
  readonly id: string;
  readonly path: string;
  readonly archetype: string | null;
  readonly format: string | null;
  /** Role id → section indexes that filled it, in archetype order. */
  readonly roles: Readonly<Record<string, readonly number[]>>;
}

export interface PageConformanceReport {
  readonly schemaVersion: 1;
  readonly kind: "publisher.page-conformance";
  readonly checks: readonly PageCheckId[];
  readonly strict: boolean;
  readonly exitCode: 0 | 1;
  readonly totals: Readonly<Record<PageFindingSeverity, number>>;
  readonly pages: readonly PageConformanceSummary[];
  readonly findings: readonly PageFinding[];
}

export interface PageConformanceOptions {
  readonly strict?: boolean;
  /** Measurements from a copy-fit probe; absent means not measured. */
  readonly copyFit?: readonly CopyFitMeasurement[];
}

const words = (text: string) => text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
const canonicalPath = (path: string) => /^\/(?:[^/?#\\\s]+\/?)*$/.test(path) && !path.includes("//")
  && !path.split("/").some(part => part === "." || part === "..") && path === (path.replace(/\/$/, "") || "/");

function roleOf(archetype: PageArchetype, section: string, explicit: string | undefined): { role?: ArchetypeRole; index: number } {
  const index = explicit === undefined
    ? archetype.roles.findIndex(role => roleSections(role).includes(section as `sections.${string}`))
    : archetype.roles.findIndex(role => role.id === explicit && roleSections(role).includes(section as `sections.${string}`));
  return index < 0 ? { index } : { role: archetype.roles[index]!, index };
}

function checkArchetype(record: PageRecord, archetype: PageArchetype, cells: ReadonlySet<string> | undefined, out: PageFinding[]): Record<string, number[]> {
  const page = record.id, filled: Record<string, number[]> = Object.fromEntries(archetype.roles.map(role => [role.id, []]));
  let last = -1;
  record.sections.forEach((row, section) => {
    const { role, index } = roleOf(archetype, row.section, row.role);
    if (!role) {
      out.push({ check: "archetype", code: "archetype-extra-section", severity: "error", page, section, message: `${row.section}${row.role ? ` as role ${row.role}` : ""} fills no role of archetype ${archetype.id}` });
      return;
    }
    filled[role.id]!.push(section);
    if (index < last) out.push({ check: "archetype", code: "archetype-order", severity: "error", page, section, role: role.id, message: `Role ${role.id} comes after role ${archetype.roles[last]!.id}; archetype ${archetype.id} orders it earlier` });
    last = Math.max(last, index);
  });
  for (const role of archetype.roles) {
    const count = filled[role.id]!.length;
    if (role.required && count === 0) out.push({ check: "archetype", code: "archetype-role-missing", severity: "error", page, role: role.id, message: `Required role ${role.id} (${role.section}) is missing` });
    else if (count < role.min || count > role.max) out.push({ check: "archetype", code: "archetype-role-count", severity: "error", page, role: role.id, message: `Role ${role.id} has ${count} sections; archetype ${archetype.id} allows ${role.min}..${role.max}` });
    if (!cells || role.required || !role.gate) continue;
    if (count > 0 && !cells.has(role.gate)) out.push({ check: "archetype", code: "archetype-gate-off", severity: "warning", page, role: role.id, message: `Optional role ${role.id} is present but Director cell ${role.gate} is not filled` });
    if (count === 0 && cells.has(role.gate)) out.push({ check: "archetype", code: "archetype-gate-on", severity: "info", page, role: role.id, message: `Director cell ${role.gate} is filled; optional role ${role.id} (${role.section}) is available` });
  }
  return filled;
}

function checkFormat(record: PageRecord, format: PageFormat, archetype: PageArchetype | undefined, out: PageFinding[]): void {
  const page = record.id;
  if (archetype && !archetype.formats.includes(format.id)) out.push({ check: "format", code: "format-archetype", severity: "error", page, message: `Archetype ${archetype.id} is not published as ${format.id}; allowed: ${archetype.formats.join(", ")}` });
  const frame = record.frame?.id;
  if (frame === undefined) {
    if (format.frameRequired) out.push({ check: "format", code: "format-frame-missing", severity: "error", page, message: `Format ${format.id} requires a frame` });
  } else {
    if (!format.frames.includes(frame as `frames.${string}`)) out.push({ check: "format", code: "format-frame", severity: "error", page, message: `Frame ${frame} is not compatible with format ${format.id}${format.frames.length ? `; allowed: ${format.frames.join(", ")}` : " (no frame)"}` });
    else if (archetype && archetype.frames.length > 0 && !archetype.frames.includes(frame as `frames.${string}`)) out.push({ check: "format", code: "format-frame", severity: "error", page, message: `Frame ${frame} is not expected by archetype ${archetype.id}; expected: ${archetype.frames.join(", ")}` });
    if (!format.stickyHeader && (record.frame?.members ?? []).includes("position.sticky")) out.push({ check: "format", code: "format-sticky", severity: "error", page, message: `Format ${format.id} does not allow a sticky header` });
  }
  record.sections.forEach((row, section) => {
    const allowed = sectionFormats(row.section);
    if (!allowed) out.push({ check: "format", code: "format-section-unknown", severity: "warning", page, section, message: `${row.section} has no format compatibility entry` });
    else if (!allowed.includes(format.id)) out.push({ check: "format", code: "format-section", severity: "error", page, section, message: `${row.section} is not compatible with format ${format.id}; allowed: ${allowed.join(", ")}` });
    const max = format.copy.maxWords;
    if (max !== null && format.copy.unit && row.copy?.text) {
      const count = Object.values(row.copy.text).reduce((sum, text) => sum + words(text), 0);
      if (count > max) out.push({ check: "format", code: "format-word-budget", severity: "error", page, section, message: `${row.section} binds ${count} words; format ${format.id} allows ${max} per ${format.copy.unit}` });
    }
  });
  const intents = new Set((record.actions ?? []).map(action => action.intent).filter(Boolean));
  for (const intent of format.requiredActions) if (!intents.has(intent)) out.push({ check: "format", code: "format-action-missing", severity: "error", page, message: `Format ${format.id} requires page action ${intent}` });
}

function checkLinks(record: PageRecord, routes: ReadonlySet<string>, out: PageFinding[]): void {
  const page = record.id;
  const check = (href: string, section?: number) => {
    const at = section === undefined ? {} : { section };
    if (href.startsWith("#") || /^(mailto|tel):[^\s]+$/i.test(href)) return;
    if (href.startsWith("/") && !href.startsWith("//")) {
      const path = href.replace(/[?#].*$/, "") || "/";
      if (!routes.has(path) && !routes.has(path.replace(/\/$/, ""))) out.push({ check: "links", code: "link-unresolved", severity: "error", page, ...at, message: `${href} resolves to no route` });
      return;
    }
    if (!isContentMapExternalHref(href)) out.push({ check: "links", code: "link-invalid", severity: "error", page, ...at, message: `${href} is neither a route nor a valid external URL` });
  };
  (record.links ?? []).forEach(href => check(href));
  record.sections.forEach((row, section) => (row.links ?? []).forEach(href => check(href, section)));
}

function checkMeta(record: PageRecord, out: PageFinding[]): void {
  const page = record.id, meta = record.meta ?? {};
  if (!meta.title) out.push({ check: "meta", code: "meta-title-missing", severity: "error", page, message: "Page has no head title bound" });
  if (!meta.description) out.push({ check: "meta", code: "meta-description-missing", severity: meta.indexing === "noindex" ? "warning" : "error", page, message: "Page has no meta description bound" });
  if (record.nav?.pinned && !record.nav.label) out.push({ check: "meta", code: "nav-label-missing", severity: "error", page, message: "Page is pinned to navigation without a label" });
}

function checkCopyFit(record: PageRecord, measurements: readonly CopyFitMeasurement[] | undefined, out: PageFinding[]): void {
  const page = record.id, rows = (measurements ?? []).filter(row => row.page === page);
  if (rows.length === 0) {
    if (record.sections.length > 0) out.push({ check: "copy-fit", code: "copy-fit-not-measured", severity: "info", page, message: `Copy fit not measured at ${COPY_FIT_WIDTHS.join("/")}` });
    return;
  }
  for (const row of rows) if (row.overflow) out.push({ check: "copy-fit", code: "copy-fit-overflow", severity: "warning", page, section: row.section, message: `${row.key ?? "Copy"} overflows at ${row.width}px${row.overflowPx ? ` by ${row.overflowPx}px` : ""}` });
}

/** Check a set of page records. Never throws on record content; malformed input becomes findings. */
export function checkPageRecords(set: PageRecordSet, options: PageConformanceOptions = {}): PageConformanceReport {
  const findings: PageFinding[] = [], pages: PageConformanceSummary[] = [];
  const cells = set.directorCells ? new Set(set.directorCells) : undefined;
  const routes = new Set<string>(set.routes ?? []);
  const seen = new Map<string, string>();
  for (const record of set.records) {
    routes.add(record.path);
    if (!canonicalPath(record.path)) findings.push({ check: "links", code: "route-invalid", severity: "error", page: record.id, message: `Route ${record.path} is not a canonical page path` });
    const other = seen.get(record.path);
    if (other !== undefined) findings.push({ check: "links", code: "route-duplicate", severity: "error", page: record.id, message: `Route ${record.path} is also used by ${other}` });
    else seen.set(record.path, record.id);
  }
  for (const record of set.records) {
    const archetype = isArchetypeId(record.archetype) ? PAGE_ARCHETYPES[record.archetype] : undefined;
    if (!archetype) findings.push({ check: "archetype", code: "archetype-unknown", severity: "error", page: record.id, message: record.archetype ? `Unknown archetype ${record.archetype}` : "Page declares no archetype" });
    const formatId = record.format ?? archetype?.formats[0];
    const format = isPageFormatId(formatId) ? PAGE_FORMATS[formatId] : undefined;
    if (!format) findings.push({ check: "format", code: "format-unknown", severity: "error", page: record.id, message: formatId ? `Unknown format ${formatId}` : "Page declares no format" });
    const roles = archetype ? checkArchetype(record, archetype, cells, findings) : {};
    if (format) checkFormat(record, format, archetype, findings);
    record.sections.forEach((row, section) => {
      if (!row.copy || Object.keys(row.copy.keys).length === 0) findings.push({ check: "copy", code: "copy-unbound", severity: "error", page: record.id, section, message: `${row.section} has no Writer copy bound` });
    });
    checkLinks(record, routes, findings);
    checkMeta(record, findings);
    checkCopyFit(record, options.copyFit, findings);
    pages.push({ id: record.id, path: record.path, archetype: archetype?.id ?? null, format: format?.id ?? null, roles });
  }
  const totals = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) totals[finding.severity] += 1;
  const strict = options.strict === true;
  return { schemaVersion: 1, kind: "publisher.page-conformance", checks: PAGE_CHECKS, strict, exitCode: strict && totals.error > 0 ? 1 : 0, totals, pages, findings };
}
