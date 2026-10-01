/**
 * The review index behind `PackReviewView`: every page, forced state and
 * exported artifact of a site, enumerated from `pack.json` and the site's own
 * route list. Pure: no file system, no clock, no network.
 *
 * - R1: a page is one route the caller lists, in the caller's order. Its badge
 *   is the `website` item's; a pack with no `website` item reports `draft`.
 * - R2: a state is a slug the caller declares for a listed route. Nothing is
 *   discovered or guessed.
 * - R3: exports come from `outputPaths` of three items, in this order:
 *   `share-card` (OG image), `brand-kit` (favicon, app icon, logo, or
 *   `other`, by file name) and `notification-email` (an `.html` output is
 *   listed twice, at 600 and 375 px, and a `.txt` output is the plain-text
 *   variant). A directory output (a trailing `/`) is not an export. Every
 *   export carries the badge of its own item.
 * - R4: the badge is the pack status folded onto `draft`, `delegated` or
 *   `approved` (`packReviewStatus`); `published` is `approved`.
 * - R5: a refusal is a rule and a position, never a value taken from the
 *   input. A manifest that does not validate, an output path that is not a
 *   plain relative path, and a route or state that is not a plain path or
 *   slug are all refused; the index is returned whole or not at all.
 */
import type { PackStatus } from "@clossys/controller";
import type { PackManifest } from "./types.js";
import { validatePackManifest } from "./validate.js";

/** The iteration badge each entry shows. */
export const PACK_REVIEW_STATUSES = ["draft", "delegated", "approved"] as const;
export type PackReviewStatus = (typeof PACK_REVIEW_STATUSES)[number];

/** The viewport widths, in CSS pixels, the contact sheet renders each page and state at. */
export const PACK_REVIEW_WIDTHS = [390, 1024, 1440] as const;

/** The widths, in CSS pixels, the notification email is reviewed at. */
export const PACK_REVIEW_EMAIL_WIDTHS = [600, 375] as const;

const STATUS_FOLD: Readonly<Record<PackStatus, PackReviewStatus>> = {
  absent: "draft",
  found: "draft",
  draft: "draft",
  "in-review": "delegated",
  kept: "approved",
  published: "approved",
};

/** Folds a pack item status onto the three words a review shows. Exhaustive over `PackStatus`. */
export function packReviewStatus(status: PackStatus): PackReviewStatus {
  return STATUS_FOLD[status];
}

export type PackReviewExportKind = "og-image" | "favicon" | "app-icon" | "logo" | "email-html" | "email-text" | "other";

export interface PackReviewPage {
  /** The route, e.g. `/contact`. */
  id: string;
  status: PackReviewStatus;
  /** Slugs of the forced states the page accepts, in the caller's order. */
  states: readonly string[];
}

export interface PackReviewExport {
  /** Unique across the index: the item id, the output's position and, for an email width, the width. */
  id: string;
  /** The pack item the output belongs to. */
  itemId: string;
  kind: PackReviewExportKind;
  /** The output path exactly as `pack.json` lists it. */
  path: string;
  status: PackReviewStatus;
  /** The review width in CSS pixels; only on `email-html`. */
  width?: number;
}

export interface PackReviewIndex {
  pages: readonly PackReviewPage[];
  exports: readonly PackReviewExport[];
}

/** What the caller knows about the site: its routes and, per route, the states it can be forced into. */
export interface PackReviewInput {
  routes: readonly { id: string }[];
  states: Readonly<Record<string, readonly string[]>>;
}

export interface PackReviewIssue {
  rule: string;
  path: string;
}

export type PackReviewIndexResult = { ok: true; index: PackReviewIndex } | { ok: false; issues: readonly PackReviewIssue[] };

const ROUTE_RE = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/;
const STATE_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A plain relative path: forward slashes, no empty or dot segment, no scheme, query, fragment or control character. */
function isSafeOutputPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;
  if (CONTROL.test(value) || /[\\?#:]/.test(value) || value.startsWith("/")) return false;
  const segments = value.endsWith("/") ? value.slice(0, -1).split("/") : value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function baseName(path: string): string {
  return (path.split("/").pop() ?? "").toLowerCase();
}

function brandKitKind(path: string): PackReviewExportKind {
  const name = baseName(path);
  if (name.startsWith("favicon")) return "favicon";
  if (name.startsWith("apple-touch") || name.startsWith("app-icon") || name.startsWith("icon")) return "app-icon";
  if (name.startsWith("logo")) return "logo";
  return "other";
}

/** The three items whose outputs are reviewed, in review order. */
const EXPORT_ITEMS = ["share-card", "brand-kit", "notification-email"] as const;

/**
 * Builds the review index (R1-R5). Returns the whole index, or every refusal
 * with its position; it never throws and never reads anything but its two
 * arguments.
 */
export function buildPackReviewIndex(manifest: PackManifest, input: PackReviewInput): PackReviewIndexResult {
  const issues: PackReviewIssue[] = [];
  const refuse = (rule: string, path: string) => void issues.push({ rule, path });

  const rawManifest: unknown = manifest;
  if (!isManifestShape(rawManifest) || !validateQuietly(rawManifest)) {
    return { ok: false, issues: [{ rule: "invalid-manifest", path: "manifest" }] };
  }
  const rawInput: unknown = input;
  if (!isRecord(rawInput) || !Array.isArray(rawInput["routes"]) || !isRecord(rawInput["states"])) {
    return { ok: false, issues: [{ rule: "invalid-input", path: "input" }] };
  }
  const routes: readonly unknown[] = rawInput["routes"];
  const states: Readonly<Record<string, unknown>> = rawInput["states"];

  const routeIds: string[] = [];
  routes.forEach((route, index) => {
    const id = isRecord(route) ? route["id"] : undefined;
    if (typeof id !== "string" || !ROUTE_RE.test(id)) return refuse("invalid-route", `routes[${index}].id`);
    if (routeIds.includes(id)) return refuse("duplicate-route", `routes[${index}].id`);
    routeIds.push(id);
  });

  Object.keys(states).forEach((route, routeIndex) => {
    if (!routeIds.includes(route)) return refuse("unknown-state-route", `states[${routeIndex}]`);
    const slugs = states[route];
    if (!Array.isArray(slugs)) return refuse("invalid-state", `states[${routeIndex}]`);
    slugs.forEach((slug, slugIndex) => {
      if (typeof slug !== "string" || !STATE_RE.test(slug)) refuse("invalid-state", `states[${routeIndex}][${slugIndex}]`);
    });
  });

  rawManifest.items.forEach((item, itemIndex) => {
    item.outputPaths.forEach((path, pathIndex) => {
      if (!isSafeOutputPath(path)) refuse("unsafe-output-path", `items[${itemIndex}].outputPaths[${pathIndex}]`);
    });
  });

  if (issues.length > 0) return { ok: false, issues };

  const byId = new Map(rawManifest.items.map((item) => [item.id, item]));
  const websiteStatus = packReviewStatus(byId.get("website")?.status ?? "absent");

  const pages: PackReviewPage[] = routeIds.map((id) => ({
    id,
    status: websiteStatus,
    states: Object.hasOwn(states, id) ? [...(states[id] as readonly string[])] : [],
  }));

  const exports: PackReviewExport[] = [];
  for (const itemId of EXPORT_ITEMS) {
    const found = byId.get(itemId);
    if (found === undefined) continue;
    const status = packReviewStatus(found.status);
    found.outputPaths.forEach((path, position) => {
      if (path.endsWith("/")) return;
      const base = `${itemId}:${position}`;
      if (itemId === "share-card") {
        exports.push({ id: base, itemId, kind: "og-image", path, status });
      } else if (itemId === "brand-kit") {
        exports.push({ id: base, itemId, kind: brandKitKind(path), path, status });
      } else if (baseName(path).endsWith(".html")) {
        for (const width of PACK_REVIEW_EMAIL_WIDTHS) exports.push({ id: `${base}:${width}`, itemId, kind: "email-html", path, status, width });
      } else if (baseName(path).endsWith(".txt")) {
        exports.push({ id: base, itemId, kind: "email-text", path, status });
      } else {
        exports.push({ id: base, itemId, kind: "other", path, status });
      }
    });
  }

  return { ok: true, index: { pages, exports } };
}

/** The shape `validatePackManifest` and this module read: an object whose items are objects with a string id and array outputPaths. */
function isManifestShape(value: unknown): value is PackManifest {
  return (
    isRecord(value) &&
    Array.isArray(value["items"]) &&
    value["items"].every((item) => isRecord(item) && typeof item["id"] === "string" && Array.isArray(item["outputPaths"]))
  );
}

function validateQuietly(manifest: PackManifest): boolean {
  try {
    return validatePackManifest(manifest).exitCode === 0;
  } catch {
    return false;
  }
}
