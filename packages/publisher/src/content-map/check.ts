import { FORMAT_IDS } from "../formats/contract.js";
import { CONTENT_MAP_MAX_DEPTH } from "./contract.js";
import type { ContentMap, ContentMapEntry, ContentMapFinding, ContentMapFindingCode } from "./contract.js";

const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.trim() === value;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const fields = (value: object, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
function canonicalPagePath(path: string): boolean {
  return /^\/(?:[^/?#\\]+\/?)*$/.test(path) && !path.includes("//") && !path.includes("%")
    && !path.split("/").some(part => part === "." || part === "..") && path === (path.replace(/\/$/, "") || "/");
}
function plain(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  if (![Object.prototype, null, ...(Array.isArray(value) ? [Array.prototype] : [])].includes(Object.getPrototypeOf(value))) return false;
  if (Array.isArray(value) && Object.keys(value).length !== value.length) return false;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value") || !plain(descriptor.value, seen)) return false;
  }
  seen.delete(value); return true;
}
export function contentMapPath(entry: ContentMapEntry): string {
  return entry.path ?? `/${entry.slug}`;
}
/** Every finding is blocking. An orphan is an entry whose parent chain cannot
 * reach a root, including descendants of missing-parent and cyclic branches. */
export function checkContentMap(input: unknown): readonly ContentMapFinding[] {
  const findings: ContentMapFinding[] = [];
  const add = (code: ContentMapFindingCode, path: string, message: string, entryId?: string) => findings.push({ severity: "P0", code, path, ...(entryId ? { entryId } : {}), message });
  if (!plain(input) || !record(input) || !fields(input, ["version", "publicationId", "format", "entries", "actions"]) || input.version !== 1 || !text(input.publicationId) || !Array.isArray(input.entries) || (input.actions !== undefined && !Array.isArray(input.actions))) {
    add("contract", "map", "A versioned plain content map is required"); return findings;
  }
  if (!(FORMAT_IDS as readonly unknown[]).includes(input.format)) add("format", "format", "Unknown content-map format");
  const entries = input.entries as ContentMapEntry[], byId = new Map<string, ContentMapEntry>();
  const ids = new Set<string>(), paths = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    const at = `entries.${index}`;
    if (!record(entry)) { add("contract", at, "Plain content entry required"); continue; }
    const source = entry.source;
    const planSource = record(source) && fields(source, ["planItemId"]) && text(source.planItemId);
    const frameSource = record(source) && fields(source, ["frameId", "sectionIds"]) && text(source.frameId) && Array.isArray(source.sectionIds) && source.sectionIds.every(text) && new Set(source.sectionIds).size === source.sectionIds.length;
    if (!fields(entry, ["id", "parentId", "order", "title", "path", "slug", "kind", "pin", "source", "icon", "description", "keywords"]) || !text(entry.id) || !text(entry.title) || !Number.isSafeInteger(entry.order) || entry.order < 0
      || !["page", "slide", "section", "group"].includes(entry.kind) || (entry.parentId !== undefined && !text(entry.parentId)) || (!planSource && !frameSource)
      || (entry.path === undefined) === (entry.slug === undefined) || !(text(entry.path) || text(entry.slug))
      || (entry.icon !== undefined && !text(entry.icon)) || (entry.description !== undefined && !text(entry.description)) || (entry.keywords !== undefined && (!Array.isArray(entry.keywords) || !entry.keywords.every(text)))) add("contract", at, "Invalid entry identity, content reference or metadata", entry.id);
    if (ids.has(entry.id)) add("duplicate-id", at, "Duplicate entry identity", entry.id); ids.add(entry.id);
    if (text(entry.id) && !byId.has(entry.id)) byId.set(entry.id, entry);
    const path = entry.path ?? (text(entry.slug) ? `/${entry.slug}` : undefined);
    if (path !== undefined && paths.has(path)) add("duplicate-path", at, "Duplicate resolved path", entry.id);
    if (path !== undefined) paths.add(path);
    if (input.format === "web.page.responsive" && (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.includes("\\") || /[\u0000-\u0020]/.test(path)
      || (entry.kind === "page" && !canonicalPagePath(path)))) add("web-path", at, "Web targets must stay local; pages require canonical registered paths", entry.id);
    if (entry.pin !== undefined && (!record(entry.pin) || !fields(entry.pin, ["nav", "group"]) || entry.pin.nav !== true || !["page", "group", "section"].includes(entry.kind) || !text(entry.id) || (entry.pin.group !== undefined && !text(entry.pin.group)))) add("pin", `${at}.pin`, "Only an existing page, group or section can be pinned", entry.id);
  }
  const maximum = typeof input.format === "string" && Object.hasOwn(CONTENT_MAP_MAX_DEPTH, input.format)
    ? CONTENT_MAP_MAX_DEPTH[input.format as keyof typeof CONTENT_MAP_MAX_DEPTH] : undefined;
  for (const entry of entries) {
    if (!record(entry) || !text(entry.id)) continue;
    if (entry.parentId !== undefined && !byId.has(entry.parentId)) add("missing-parent", `entries.${entry.id}.parentId`, "Parent entry is missing", entry.id);
    const chain: ContentMapEntry[] = [], seen = new Set<string>(); let current: ContentMapEntry | undefined = entry;
    let cyclic = false, reachesRoot = false;
    while (current) {
      if (seen.has(current.id)) { cyclic = true; break; }
      seen.add(current.id); chain.push(current);
      if (current.parentId === undefined) { reachesRoot = true; break; }
      current = byId.get(current.parentId);
    }
    if (cyclic) add("cycle", `entries.${entry.id}.parentId`, "Cyclic parent chain", entry.id);
    if (!reachesRoot) add("orphan", `entries.${entry.id}`, "Entry cannot reach a map root", entry.id);
    if (maximum !== undefined && chain.length > maximum) add("depth", `entries.${entry.id}`, `Format allows at most ${maximum} hierarchy levels`, entry.id);
    if (entry.pin && record(entry.pin)) {
      const ancestors = chain.slice(1);
      if (ancestors.some(parent => !parent.pin) || (entry.pin.group !== undefined && !ancestors.some(parent => parent.kind === "group" && parent.id === entry.pin!.group))) add("pin", `entries.${entry.id}.pin`, "Pinned entries require pinned ancestors and an existing ancestor group", entry.id);
    }
    if (input.format === "web.page.responsive" && entry.kind === "section") {
      const parent = byId.get(entry.parentId ?? "");
      const ownPath = typeof entry.path === "string" ? entry.path : typeof entry.slug === "string" ? `/${entry.slug}` : undefined;
      const parentPath = typeof parent?.path === "string" ? parent.path : typeof parent?.slug === "string" ? `/${parent.slug}` : undefined;
      if (!parent || parent.kind !== "page" || ownPath === undefined || parentPath === undefined || (!ownPath.startsWith(`${parentPath}?`) && !ownPath.startsWith(`${parentPath}/`))) add("contract", `entries.${entry.id}`, "A web section belongs to a page query or subpath", entry.id);
    }
  }
  const actionIds = new Set<string>();
  for (const [index, action] of ((input.actions ?? []) as unknown[]).entries()) {
    if (!record(action) || !fields(action, ["id", "label", "group", "intent"]) || ![action.id, action.label, action.group, action.intent].every(text)) { add("contract", `actions.${index}`, "Finite action identities and a host intent are required"); continue; }
    if (ids.has(action.id as string) || actionIds.has(action.id as string)) add("action-id", `actions.${index}.id`, "Action identity collides with an entry or action");
    actionIds.add(action.id as string);
  }
  return findings;
}
export function checkedContentMap(map: ContentMap): ContentMap {
  const findings = checkContentMap(map);
  if (findings.length) throw new TypeError(`Content map refused: ${findings.map(finding => `${finding.code} ${finding.path}`).join("; ")}`);
  return map;
}
