import { PAGE_META_FIELDS, validateCopyFields } from "./composition.js";
import type { ContentFinding } from "./composition.js";
import type { CandidateContent, ContentSlot } from "./model.js";
import { CONTENT_TREE } from "./taxonomy.js";
import type { ContentTree } from "./taxonomy.js";

/** Canonical URLs are slot workflow metadata, outside candidate revision content. */
export function isCanonicalUrl(value: unknown): value is string {
  if (typeof value !== "string" || value !== value.trim() || !/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch { return false; }
}

/** Explicit policy wins; otherwise auth and non-content slots stay out of indexes. */
export function robotsFor(slot: ContentSlot, tree: ContentTree = CONTENT_TREE): "index" | "noindex" {
  if (slot.meta?.robots !== undefined) return slot.meta.robots;
  const child = tree.nodes.find(node => node.id === slot.l1)?.children.find(node => node.id === slot.l2);
  return slot.kind !== "content" || slot.l2 === "auth" || child?.frame === "frames.auth-shell" ? "noindex" : "index";
}

/** Logical output only; encode every user-selected segment before filesystem use. */
export function outputPathFor(slot: Pick<ContentSlot, "route" | "deployTarget">): string {
  const { route, deployTarget } = slot;
  if (typeof deployTarget !== "string" || !deployTarget.trim()) throw new TypeError("Output requires a deploy target");
  if (typeof route !== "string" || !route.startsWith("/") || /[?#\\]/.test(route)
    || route.includes("//") || (route !== "/" && route.endsWith("/"))) throw new TypeError("Output requires a canonical absolute route path");
  const segments = route === "/" ? [] : route.slice(1).split("/");
  if (segments.some(segment => {
    try { return [".", ".."].includes(decodeURIComponent(segment)); }
    catch { return true; }
  })) throw new TypeError("Output route contains a noncanonical segment");
  const encode = (segment: string) => encodeURIComponent(segment).replace(/\./g, "%2E");
  return [encode(deployTarget), "app", ...segments.map(encode), "page.tsx"].join("/");
}

/** Readiness checks stay separate so legacy snapshots and incomplete drafts remain readable. */
export function checkPageMetadata(slot: ContentSlot, candidate: CandidateContent, tree: ContentTree = CONTENT_TREE): ContentFinding[] {
  const findings: ContentFinding[] = [...validateCopyFields(candidate.pageMeta ?? [], "content.pageMeta", PAGE_META_FIELDS)];
  if (findings.length) return findings;
  const add = (path: string, rule: string) => findings.push({ path, rule, message: `Invalid ${rule}` });
  const fields = candidate.pageMeta ?? [];
  const keys = new Set(["title"]);
  if (robotsFor(slot, tree) === "index") keys.add("description");
  for (const [index, field] of fields.entries()) {
    if (!slot.locales.includes(field.locale)) add(`content.pageMeta[${index}].locale`, "slot-locale");
  }
  for (const locale of slot.locales) {
    for (const key of keys) {
      const field = fields.find(entry => entry.locale === locale && entry.key === key);
      if (!field || !field.value.trim()) add(`content.pageMeta.${locale}.${key}`, "required-page-metadata");
    }
  }
  return findings;
}
