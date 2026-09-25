/**
 * Reads the shared engagement context (issue #1173) out of a consumer's own
 * `clossys/brief.json`, validated against the one shared brief contract
 * (issue #1475): `docs/contracts/engagement-brief.json`, with
 * `engagement-context.json` for its optional `context` property. Both
 * `@clossys/advisor` and `@clossys/launcher` validate a brief against the
 * same two files; this package's own build (`scripts/pack-brief-contract.mjs`)
 * packs a copy of them, and of the one contract checker
 * (`packages/advisor/src/contract-schema.ts`), into `src/generated/` at
 * build time (see `brief-contract.ts`), so Strategist validates against the
 * same definition with no runtime dependency on `@clossys/advisor` (see
 * `package.json` -- no `dependencies` entry at all). This package only
 * reads a brief; it never writes one.
 *
 * All-or-nothing: a brief that does not fully validate against the shared
 * contract is never partially trusted -- every field reads unknown, the
 * same starting point as no brief at all, with a note naming only a fixed
 * reason, an OS error code, or a JSON syntax position, never file text or
 * founder text. A brief that fully validates is a brief `@clossys/launcher`
 * would also accept, so seeding from it never reads a value the shared
 * contract itself refuses -- for example, a duplicate context field id,
 * which the contract's own `contains`/`maxItems` rule refuses outright, so
 * this reader has no separate duplicate-id rule of its own to drift from
 * it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContractDocumentError, readContractDocument } from "./generated/contract-schema.generated.js";
import { validateEngagementBrief } from "./brief-contract.js";
import { isPlainObject } from "./validation.js";

export type EngagementContextFieldId = "business" | "product" | "audience" | "stage" | "intent" | "constraints";

export const ENGAGEMENT_CONTEXT_FIELD_IDS: readonly EngagementContextFieldId[] = [
  "business",
  "product",
  "audience",
  "stage",
  "intent",
  "constraints",
];

export type EngagementContextField =
  | { readonly id: EngagementContextFieldId; readonly state: "known"; readonly value: string }
  | { readonly id: EngagementContextFieldId; readonly state: "unknown" };

export interface EngagementContextSnapshot {
  readonly fields: readonly EngagementContextField[];
}

/**
 * The result of reading `clossys/brief.json`. `context` always has one
 * entry per field id, in the fixed field order. `note` is present only
 * when the brief exists but does not fully validate against the shared
 * contract, or could not be read as a file or as strict JSON at all: the
 * caller relays it once and otherwise reads every field unknown, the same
 * starting point as a repository with no brief yet.
 */
export interface EngagementContextRead {
  readonly context: EngagementContextSnapshot;
  readonly note?: string;
}

function allUnknown(): EngagementContextSnapshot {
  return { fields: ENGAGEMENT_CONTEXT_FIELD_IDS.map((id): EngagementContextField => ({ id, state: "unknown" })) };
}

/** Returns the field with this id, or undefined if the snapshot does not carry it (it always should — see {@link EngagementContextSnapshot}). */
export function fieldById(context: Pick<EngagementContextSnapshot, "fields">, id: EngagementContextFieldId): EngagementContextField | undefined {
  return context.fields.find((field) => field.id === id);
}

/** The known `audience` field value, or undefined when it is unknown. The one field id `packages/strategist/src/audience-intake.ts` currently maps into a Strategist record. */
export function audienceContextValue(context: Pick<EngagementContextSnapshot, "fields">): "consumers" | "businesses" | undefined {
  const field = fieldById(context, "audience");
  if (field?.state === "known" && (field.value === "consumers" || field.value === "businesses")) return field.value;
  return undefined;
}

const NOTE_BRIEF_INVALID = "clossys/brief.json does not match docs/contracts/engagement-brief.json; asking every engagement-context question as usual.";
const NOTE_UNPARSEABLE = "clossys/brief.json is not valid JSON; asking every engagement-context question as usual.";

/**
 * Maps an already-validated context's `fields` array into a snapshot. The
 * contract guarantees, by construction, exactly one entry per field id
 * (`maxItems: 6` plus a `contains` requirement for each of the six ids
 * leaves no room for a duplicate or a missing one) and a known entry's
 * `value` already one of that field's fixed choice ids. The `byId.get(id)
 * ?? {id, state:"unknown"}` fallback below is defensive only, never a
 * second shape check duplicating what validation already enforced.
 */
function snapshotFromValidatedFields(rawFields: readonly unknown[]): EngagementContextSnapshot {
  const byId = new Map<string, EngagementContextField>();
  for (const raw of rawFields) {
    if (!isPlainObject(raw) || typeof raw.id !== "string") continue;
    const id = raw.id as EngagementContextFieldId;
    byId.set(id, raw.state === "known" && typeof raw.value === "string" ? { id, state: "known", value: raw.value } : { id, state: "unknown" });
  }
  return { fields: ENGAGEMENT_CONTEXT_FIELD_IDS.map((id) => byId.get(id) ?? { id, state: "unknown" }) };
}

/**
 * Reads the engagement context out of an already-parsed `clossys/brief.json`
 * value. `rawBrief === undefined` means no brief file exists (the ordinary
 * case before #1178's writer runs, or in a repository Advisor has not
 * staffed): every field reads unknown, with no note. Anything else is
 * validated against the shared brief contract (`validateEngagementBrief`);
 * a brief that does not fully validate reads as every field unknown with a
 * fixed note -- never partially trusted, and the violation detail is never
 * relayed, only the fixed text. A valid brief with no `context` property
 * yet (written before #1178, or before a founder has answered anything) is
 * not an error -- `context` is documented optional and reads as unknown,
 * unremarked.
 */
export function readEngagementContextFromBriefData(rawBrief: unknown): EngagementContextRead {
  if (rawBrief === undefined) return { context: allUnknown() };
  const validation = validateEngagementBrief(rawBrief);
  if (!validation.valid) return { context: allUnknown(), note: NOTE_BRIEF_INVALID };
  const context = (rawBrief as { context?: { fields?: readonly unknown[] } }).context;
  if (context === undefined) return { context: allUnknown() };
  return { context: snapshotFromValidatedFields(context.fields ?? []) };
}

/**
 * The note text for a `clossys/brief.json` that exists but could not be
 * read — the OS error code only (e.g. `"EACCES"`, `"EISDIR"`), never the
 * underlying error message or any filesystem path, either of which could
 * put local machine detail into a note a caller might display verbatim.
 * `"UNKNOWN"` stands in for an error with no `code` at all.
 */
export function unreadableBriefNote(error: unknown): string {
  const code = isPlainObject(error) && typeof error.code === "string" ? error.code : "UNKNOWN";
  return `clossys/brief.json could not be read (${code}); asking every engagement-context question as usual.`;
}

/**
 * The note text for a `clossys/brief.json` that exists but is not strict
 * JSON (`readContractDocument()`'s own rules: valid UTF-8, one JSON value,
 * no object that repeats a key, no leading byte order mark). Reads only
 * `ContractDocumentError`'s own structured `position` field — never the
 * error's `message` string. That matters: a repeated-key message names the
 * key itself, and a brief can name a key that looks like a position (for
 * example a founder-authored `"position 5551234567"`), so parsing the
 * message with a regular expression — this function's own prior
 * implementation — could relay exactly the founder text this note exists
 * to keep out. `position` is set only for a genuine syntax error or a
 * leading BOM, never for a repeated key, so this can never make that
 * mistake.
 */
function unparseableBriefNote(error: unknown): string {
  if (error instanceof ContractDocumentError && error.position !== undefined) {
    return `clossys/brief.json is not valid JSON at position ${error.position}; asking every engagement-context question as usual.`;
  }
  return NOTE_UNPARSEABLE;
}

/**
 * Reads `<repositoryRoot>/<briefRelPath>` (default `clossys/brief.json`,
 * the path every staffed repository carries it at) and returns its
 * engagement context. There is no `existsSync` pre-check: that would turn
 * an error reading a PARENT directory (for example `EACCES` on
 * `clossys/`) into a silent, wrong "no brief" too, the same way it would
 * for the file itself, since `existsSync` swallows every error and
 * returns `false`. Instead this reads directly and distinguishes `ENOENT`
 * (no such file — the ordinary "no brief" case, no note) from every other
 * read failure (a note with only the OS error code, via
 * {@link unreadableBriefNote}). A file that is not strict JSON
 * (`readContractDocument`) reports a position or a fixed note via
 * {@link unparseableBriefNote}; a well-formed JSON value that does not
 * validate against the shared contract reports the same fixed note
 * `readEngagementContextFromBriefData` does. Every field reads unknown in
 * all four cases but the first.
 */
export function readEngagementContext(repositoryRoot: string, briefRelPath = "clossys/brief.json"): EngagementContextRead {
  const path = join(repositoryRoot, briefRelPath);
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    if (isPlainObject(error) && error.code === "ENOENT") return { context: allUnknown() };
    return { context: allUnknown(), note: unreadableBriefNote(error) };
  }
  let parsed: unknown;
  try {
    parsed = readContractDocument(bytes);
  } catch (error) {
    return { context: allUnknown(), note: unparseableBriefNote(error) };
  }
  return readEngagementContextFromBriefData(parsed);
}
