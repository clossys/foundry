/**
 * Import an earlier ("v0") pack index into a `pack.json` manifest.
 *
 * The earlier index shape is not defined anywhere else in this package, so
 * `LegacyV0Pack` below is the documented input type. Invariants:
 *
 * - L1: `draft` becomes `draft`, `delegated` becomes `in-review`, `approved`
 *   becomes `kept`. Nothing becomes `published`.
 * - L2: `approved` needs `approvedAt`. `draft` and `delegated` with
 *   `approvedAt` are refused. Approval is never inferred from another field.
 * - L3: a timestamp is `YYYY-MM-DD` (becomes `T00:00:00Z`) or the UTC form
 *   `validatePackManifest` accepts; anything else, and any impossible date,
 *   is refused. `updated` becomes `updatedAt`; `createdAt` and `verifiedAt`
 *   are null.
 * - L4: each item gets `condition: "current"`, `version: "v0.1"`, empty
 *   `sourcePins`, `outputPaths` and `publishedTo`, and `nextAction: null`.
 *   `notes` is dropped.
 * - L5: a missing or extra item key, an unknown key inside an item, an
 *   unknown status, or an `iteration` other than `"v0"` is refused by path.
 *   An issue names a path and a reason, never the offending value.
 * - L6: every `validatePackManifest` finding on the result is a refusal.
 * - L7: the writer writes `<root>/clossys/publisher/pack.json` (2-space JSON,
 *   final LF). It writes nothing when the file already exists or the import
 *   was refused.
 *
 * No clock and no network: the manifest is a function of the input alone.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PackItem, PackLayer, PackManifest, PackVisibility } from "./types.js";
import { validatePackManifest } from "./validate.js";

export type LegacyV0PackStatus = "draft" | "delegated" | "approved";

/** One item of the earlier pack index. `delegated` is delegated approval, pending the owner's review. */
export interface LegacyV0PackItem {
  status: LegacyV0PackStatus;
  iteration: "v0";
  approvedAt?: string;
  updated?: string;
  notes?: string;
}

export type LegacyV0PackKey = "brief" | "brandKit" | "voice" | "shareCard" | "email" | "website";

/** The earlier pack index: one entry per item. Other top-level keys are ignored. */
export interface LegacyV0Pack {
  items: Record<LegacyV0PackKey, LegacyV0PackItem>;
}

export interface LegacyV0PackItemSpec {
  key: LegacyV0PackKey;
  id: string;
  layer: PackLayer;
  owner: string;
  visibility: PackVisibility;
  needs: readonly string[];
}

/** The fixed, ordered item table: earlier key to pack item id, layer, owner, visibility and needs. */
export const LEGACY_V0_PACK_ITEMS: readonly LegacyV0PackItemSpec[] = [
  { key: "brief", id: "strategy-brief", layer: "foundation", owner: "strategist", visibility: "internal", needs: [] },
  { key: "brandKit", id: "brand-kit", layer: "identity", owner: "designer", visibility: "internal", needs: ["strategy-brief"] },
  { key: "voice", id: "voice", layer: "identity", owner: "writer", visibility: "internal", needs: ["strategy-brief"] },
  { key: "shareCard", id: "share-card", layer: "surface", owner: "publisher", visibility: "public", needs: ["brand-kit", "voice"] },
  { key: "email", id: "notification-email", layer: "surface", owner: "publisher", visibility: "internal", needs: ["brand-kit", "voice"] },
  { key: "website", id: "website", layer: "surface", owner: "publisher", visibility: "public", needs: ["brand-kit", "voice"] },
];

/** One refusal: where in the input, and why. The message never carries the input's value. */
export interface LegacyV0PackIssue {
  path: string;
  message: string;
}

export type LegacyV0PackImportResult =
  | { ok: true; manifest: PackManifest }
  | { ok: false; issues: readonly LegacyV0PackIssue[] };

export type LegacyV0PackWriteResult =
  | { ok: true; path: string; manifest: PackManifest }
  | { ok: false; issues: readonly LegacyV0PackIssue[] };

/** Where the writer puts the manifest, relative to its root directory. */
export const LEGACY_V0_PACK_OUTPUT_PATH = "clossys/publisher/pack.json";

const STATUS_MAP = { draft: "draft", delegated: "in-review", approved: "kept" } as const;
const ITEM_KEYS = ["status", "iteration", "approvedAt", "updated", "notes"] as const;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const UTC_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function realDate(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** Normalizes one timestamp (L3), or returns null when it is not acceptable. */
function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = DATE_RE.exec(value);
  if (date) return realDate(Number(date[1]), Number(date[2]), Number(date[3])) ? `${value}T00:00:00Z` : null;
  const utc = UTC_RE.exec(value);
  if (!utc) return null;
  const [year, month, day, hour, minute, second] = utc.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  if (!realDate(year, month, day) || hour > 23 || minute > 59 || second > 59) return null;
  return value;
}

/**
 * Pure import of an earlier pack index (L1-L6). Returns the manifest, or
 * every refusal with its path; it does not touch the filesystem.
 */
export function importLegacyV0Pack(value: unknown): LegacyV0PackImportResult {
  const issues: LegacyV0PackIssue[] = [];
  const refuse = (path: string, message: string) => void issues.push({ path, message });

  if (!isRecord(value)) return { ok: false, issues: [{ path: "(root)", message: "expected an object with an items map" }] };
  const source = value.items;
  if (!isRecord(source)) return { ok: false, issues: [{ path: "items", message: "expected an object keyed by item" }] };

  const known = new Set<string>(LEGACY_V0_PACK_ITEMS.map((spec) => spec.key));
  for (const key of Object.keys(source)) {
    if (!known.has(key)) refuse(`items.${key}`, "not an item of the earlier pack index");
  }

  const items: PackItem[] = [];
  for (const spec of LEGACY_V0_PACK_ITEMS) {
    const path = `items.${spec.key}`;
    if (!Object.hasOwn(source, spec.key)) {
      refuse(path, "missing item");
      continue;
    }
    const entry = source[spec.key];
    if (!isRecord(entry)) {
      refuse(path, "expected an object");
      continue;
    }
    const before = issues.length;
    for (const key of Object.keys(entry)) {
      if (!(ITEM_KEYS as readonly string[]).includes(key)) refuse(`${path}.${key}`, "unknown key");
    }

    const status = entry.status;
    const mapped = typeof status === "string" && Object.hasOwn(STATUS_MAP, status) ? STATUS_MAP[status as LegacyV0PackStatus] : null;
    if (mapped === null) refuse(`${path}.status`, "expected draft, delegated or approved");
    if (entry.iteration !== "v0") refuse(`${path}.iteration`, 'expected "v0"');
    if (entry.notes !== undefined && typeof entry.notes !== "string") refuse(`${path}.notes`, "expected a string");

    let updatedAt: string | null = null;
    if (entry.updated !== undefined) {
      updatedAt = normalizeTimestamp(entry.updated);
      if (updatedAt === null) refuse(`${path}.updated`, "expected YYYY-MM-DD or a UTC timestamp");
    }

    let approvedAt: string | null = null;
    if (entry.approvedAt !== undefined) {
      approvedAt = normalizeTimestamp(entry.approvedAt);
      if (approvedAt === null) refuse(`${path}.approvedAt`, "expected YYYY-MM-DD or a UTC timestamp");
      else if (mapped !== null && mapped !== "kept") refuse(`${path}.approvedAt`, "only an approved item may carry approvedAt");
    } else if (mapped === "kept") {
      refuse(`${path}.approvedAt`, "an approved item needs approvedAt");
    }

    if (issues.length > before || mapped === null) continue;
    items.push({
      id: spec.id,
      layer: spec.layer,
      owner: spec.owner,
      visibility: spec.visibility,
      needs: [...spec.needs],
      status: mapped,
      condition: "current",
      version: "v0.1",
      createdAt: null,
      updatedAt,
      approvedAt,
      verifiedAt: null,
      sourcePins: [],
      outputPaths: [],
      publishedTo: [],
      nextAction: null,
    });
  }
  if (issues.length > 0) return { ok: false, issues };

  const result: PackManifest = { schemaVersion: 1, items };
  const keyById = new Map(LEGACY_V0_PACK_ITEMS.map((spec) => [spec.id, spec.key]));
  const findings = validatePackManifest(result).findings;
  if (findings.length > 0) {
    return {
      ok: false,
      issues: findings.map((finding) => ({
        path: keyById.has(finding.itemId) ? `items.${keyById.get(finding.itemId)}` : "(manifest)",
        message: `validatePackManifest: ${finding.rule}`,
      })),
    };
  }
  return { ok: true, manifest: result };
}

/**
 * Imports the earlier index and writes `<rootDir>/clossys/publisher/pack.json`
 * (L7). A refused import, or a file that already exists, writes nothing and
 * returns the issues.
 */
export async function writeLegacyV0PackImport(rootDir: string, value: unknown): Promise<LegacyV0PackWriteResult> {
  const imported = importLegacyV0Pack(value);
  if (!imported.ok) return imported;

  const path = join(rootDir, ...LEGACY_V0_PACK_OUTPUT_PATH.split("/"));
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, `${JSON.stringify(imported.manifest, null, 2)}\n`, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
      return { ok: false, issues: [{ path: LEGACY_V0_PACK_OUTPUT_PATH, message: "already exists; nothing was written" }] };
    }
    throw error;
  }
  return { ok: true, path, manifest: imported.manifest };
}
