/**
 * The migration manifest, `<consumer>/evidence/migrations.json` (clossys.migrations/1): one
 * `migrated` event per file a format-only codemod rewrote in place. It stands in for the slot
 * ledger's provenance events until the ledger lands (W2-B).
 *
 * Constitution R08.2 (a candidate's bytes never change after the commit that added it) accepts a
 * later change to a candidate only when an event here explains it: the same file, and the git blob
 * ids before and after that change equal the event's `from.blob` and `to.blob`. Any other edit,
 * before or after the migration, still fails. Only the codemods named in FORMAT_MIGRATIONS may
 * explain a change.
 *
 * Written only through the one writer (records/slot-write.ts `appendMigrationEvents`).
 */
import { createHash } from "node:crypto";
import { sha256Hex } from "./hash.js";

export const MIGRATIONS_SCHEMA = "clossys.migrations/1";
/** The manifest's path under the consumer folder. */
export const MIGRATIONS_FILE = "evidence/migrations.json";
/** Format-only codemods whose recorded rewrites R08.2 accepts. Never a content change. */
export const FORMAT_MIGRATIONS = ["citations-to-slots", "recut"] as const;
export type FormatMigration = (typeof FORMAT_MIGRATIONS)[number];

export interface FileState {
  /** sha256 of the file bytes. */
  readonly sha256: string;
  /** git blob id of the file bytes (sha1 over `blob <length>\0<bytes>`), what `git log --raw` prints. */
  readonly blob: string;
}
export interface MigratedEvent {
  readonly type: "migrated";
  readonly migration: FormatMigration;
  /** The file, relative to the consumer folder (`agents/<agent>/<slot>/candidates/<name>`). */
  readonly file: string;
  readonly from: FileState;
  readonly to: FileState;
  readonly by: string;
  readonly at: string;
}
export interface MigrationsDoc {
  readonly schema: typeof MIGRATIONS_SCHEMA;
  readonly events: readonly MigratedEvent[];
}

/** The git blob id of some bytes: sha1 over `blob <byte length>\0<bytes>`. */
export function gitBlobId(bytes: Uint8Array | string): string {
  const body = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes);
  return createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
}

/** Both ids of some bytes. */
export function fileState(bytes: Uint8Array | string): FileState {
  return { sha256: sha256Hex(bytes), blob: gitBlobId(bytes) };
}

const HEX = (length: number) => new RegExp(`^[a-f0-9]{${length}}$`);
const SHA256 = HEX(64), BLOB = HEX(40);
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const EVENT_KEYS = ["type", "migration", "file", "from", "to", "by", "at"];

/** Issues of a manifest document; empty when it is valid. */
export function validateMigrations(value: unknown): string[] {
  if (!object(value)) return ["not a JSON object"];
  const issues: string[] = [];
  if (value.schema !== MIGRATIONS_SCHEMA) issues.push(`schema is not ${MIGRATIONS_SCHEMA}`);
  const extra = Object.keys(value).filter(key => key !== "schema" && key !== "events");
  if (extra.length) issues.push(`unknown keys ${extra.join(", ")}`);
  if (!Array.isArray(value.events)) return [...issues, "events is not an array"];
  value.events.forEach((event: unknown, index: number) => {
    const at = `events[${index}]`;
    if (!object(event)) { issues.push(`${at} is not an object`); return; }
    const unknown = Object.keys(event).filter(key => !EVENT_KEYS.includes(key));
    if (unknown.length) issues.push(`${at} has unknown keys ${unknown.join(", ")}`);
    if (event.type !== "migrated") issues.push(`${at}.type is not migrated`);
    if (!(FORMAT_MIGRATIONS as readonly unknown[]).includes(event.migration)) issues.push(`${at}.migration is not one of ${FORMAT_MIGRATIONS.join(", ")}`);
    if (typeof event.file !== "string" || !/^agents\/[a-z]+\/[^/]+\/(?:candidates\/[^/]+|pin\.json)$/.test(event.file)) issues.push(`${at}.file is not agents/<agent>/<slot>/candidates/<name> or .../pin.json`);
    for (const side of ["from", "to"] as const) {
      const state = event[side];
      if (!object(state) || typeof state.sha256 !== "string" || !SHA256.test(state.sha256) || typeof state.blob !== "string" || !BLOB.test(state.blob)) issues.push(`${at}.${side} is not {sha256, blob}`);
    }
    if (object(event.from) && object(event.to) && event.from.blob === event.to.blob) issues.push(`${at} changes nothing`);
    if (typeof event.by !== "string" || !event.by.trim()) issues.push(`${at}.by is empty`);
    if (typeof event.at !== "string" || Number.isNaN(Date.parse(event.at))) issues.push(`${at}.at is not a timestamp`);
  });
  return issues;
}
