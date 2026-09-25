/**
 * Reads the shared engagement context (issue #1173) out of a consumer's own
 * `clossys/brief.json`, as data. This package stays dependency-free of
 * `@clossys/advisor` at runtime (see `package.json` — no `dependencies`
 * entry at all): it never imports Advisor's `EngagementContext` type or
 * `contextFromBrief()`, it re-derives the same read defensively against
 * this repository's own contracts (`docs/contracts/engagement-brief.json`,
 * `docs/contracts/engagement-context.json`, `docs/DECISIONS.md` decision
 * 28), the same "read the file as data, not as a typed import" split
 * `packages/launcher/src/apply-plan.ts` already draws for the rest of the
 * brief.
 *
 * A founder answers each engagement-context question once, through
 * Advisor's own cards (`business`, `product`, `audience`, `stage`,
 * `intent`, `constraints`); the brief in every staffed repository carries
 * a snapshot so a role running there — with no hub checkout — can read
 * what is already known instead of asking again. A known field's value is
 * always one of that field's own fixed choice ids (never founder prose);
 * anything that does not exactly match both contracts' shape is read as
 * unknown rather than trusted — stricter than Advisor's own
 * `contextFromBrief()`, which is permissive about a hand-edited file, but
 * consistent with never accepting what the contract itself refuses: a
 * field object carrying any key beyond `{id, state, value}` (or
 * `{id, state}` when unknown), a `context` envelope with the wrong
 * `schemaVersion`, an unexpected top-level key, or more than six fields,
 * all read as unknown, with a note when the whole envelope is at fault.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

/**
 * Each field's fixed choice vocabulary, mirroring
 * `docs/contracts/engagement-context.json`'s `definitions.field.oneOf` per
 * field `value.enum` (kept equal to it by this package's own
 * `engagement-context.test.ts`, which reads that contract file directly —
 * this package does not import it as code). A known field's value must be
 * one of these; nothing else, including a slugified founder sentence, is
 * ever accepted.
 */
export const ENGAGEMENT_CONTEXT_KNOWN_CHOICES: Readonly<Record<EngagementContextFieldId, readonly string[]>> = {
  business: ["product-or-service", "agency-or-services"],
  product: ["software", "physical-or-in-person"],
  audience: ["consumers", "businesses"],
  stage: ["building", "established"],
  intent: ["validate", "grow"],
  constraints: ["none-known", "tight-budget-or-time"],
};

export type EngagementContextField =
  | { readonly id: EngagementContextFieldId; readonly state: "known"; readonly value: string }
  | { readonly id: EngagementContextFieldId; readonly state: "unknown" };

export interface EngagementContextSnapshot {
  readonly fields: readonly EngagementContextField[];
}

/**
 * The result of reading `clossys/brief.json`. `context` always has one
 * entry per field id, in the fixed field order — a missing brief, a
 * missing `context` property, and an individually malformed field all
 * degrade to `unknown`, never an invented value. `note` is present only
 * when the brief file itself could not be treated as a well-formed brief
 * (or its `context` as a well-formed context) at all: the caller relays
 * it once and otherwise reads every field unknown, the same starting
 * point as a repository with no brief yet.
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

/** `docs/contracts/engagement-brief.json`'s own top-level `required`/`additionalProperties: false` — the keys a well-formed brief may and must have. `context` is the one optional member. */
const BRIEF_REQUIRED_KEYS = ["schemaVersion", "problem", "roles", "sequence", "deliverables"] as const;
const BRIEF_ALLOWED_KEYS = new Set<string>([...BRIEF_REQUIRED_KEYS, "context"]);
/** `docs/contracts/engagement-context.json`'s own top-level `additionalProperties: false` — no key besides these two. */
const CONTEXT_ALLOWED_KEYS = new Set<string>(["schemaVersion", "fields"]);
/** A known field's `oneOf` branch in the contract is `additionalProperties: false` over exactly these three keys. */
const KNOWN_FIELD_KEYS = new Set<string>(["id", "state", "value"]);
/** The contract's `fields` array is `maxItems: 6` — one entry per field id, no more. */
const MAX_CONTEXT_FIELDS = 6;

const NOTE_BRIEF_SHAPE = "clossys/brief.json does not match docs/contracts/engagement-brief.json's shape; asking every engagement-context question as usual.";
const NOTE_CONTEXT_SHAPE = "clossys/brief.json's context does not match docs/contracts/engagement-context.json's shape; asking every engagement-context question as usual.";
const NOTE_UNPARSEABLE = "clossys/brief.json is not valid JSON; asking every engagement-context question as usual.";

/** Every required key present, no key beyond the contract's allowed set, and `schemaVersion` exactly `1`. */
function isWellFormedBriefEnvelope(rawBrief: Record<string, unknown>): boolean {
  for (const key of BRIEF_REQUIRED_KEYS) {
    if (!(key in rawBrief)) return false;
  }
  for (const key of Object.keys(rawBrief)) {
    if (!BRIEF_ALLOWED_KEYS.has(key)) return false;
  }
  return rawBrief.schemaVersion === 1;
}

/** No key beyond `{schemaVersion, fields}`, `schemaVersion` exactly `1`, and `fields` an array of at most six entries. */
function isWellFormedContextEnvelope(rawContext: Record<string, unknown>): rawContext is { schemaVersion: 1; fields: readonly unknown[] } {
  for (const key of Object.keys(rawContext)) {
    if (!CONTEXT_ALLOWED_KEYS.has(key)) return false;
  }
  if (rawContext.schemaVersion !== 1) return false;
  if (!Array.isArray(rawContext.fields)) return false;
  return rawContext.fields.length <= MAX_CONTEXT_FIELDS;
}

/**
 * Builds a snapshot from an already-envelope-checked `context.fields`
 * array. A duplicate id reads as unknown (the same per-field leniency
 * `@clossys/advisor`'s own `contextFromBrief()` applies for a duplicate,
 * which this package's own envelope checks above do not otherwise catch).
 * A known-state entry reads as unknown unless its own object has exactly
 * `{id, state, value}` — nothing more — and `value` is one of that
 * field's fixed choices: this is what keeps founder prose, or any other
 * extra data riding alongside a field, out.
 */
function snapshotFromFields(rawFields: readonly unknown[]): EngagementContextSnapshot {
  const occurrences = new Map<string, number>();
  for (const entry of rawFields) {
    const id = isPlainObject(entry) ? entry.id : undefined;
    if (typeof id === "string") occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
  }
  return {
    fields: ENGAGEMENT_CONTEXT_FIELD_IDS.map((id): EngagementContextField => {
      if (occurrences.get(id) !== 1) return { id, state: "unknown" };
      const entry = rawFields.find((candidate) => isPlainObject(candidate) && candidate.id === id) as Record<string, unknown> | undefined;
      if (entry === undefined || entry.state !== "known") return { id, state: "unknown" };
      const keys = Object.keys(entry);
      const exactlyKnownShape = keys.length === KNOWN_FIELD_KEYS.size && keys.every((key) => KNOWN_FIELD_KEYS.has(key));
      if (exactlyKnownShape && typeof entry.value === "string" && ENGAGEMENT_CONTEXT_KNOWN_CHOICES[id].includes(entry.value)) {
        return { id, state: "known", value: entry.value };
      }
      return { id, state: "unknown" };
    }),
  };
}

/**
 * Reads the engagement context out of an already-parsed `clossys/brief.json`
 * value. `rawBrief === undefined` means no brief file exists (the ordinary
 * case before #1178's writer runs, or in a repository Advisor has not
 * staffed): every field reads unknown, with no note. A brief that is not a
 * well-formed object matching `docs/contracts/engagement-brief.json`'s own
 * required keys, allowed keys, and `schemaVersion` is reported once via
 * `note`, and still reads as every field unknown. A well-formed brief with
 * no `context` property at all (written before #1178, or before a founder
 * has answered anything) is not an error — `context` is documented
 * optional and reads as unknown, unremarked. A `context` that does not
 * match `docs/contracts/engagement-context.json`'s own envelope (wrong or
 * missing `schemaVersion`, an unexpected key, or more than six fields) is
 * reported the same way as a malformed brief.
 */
export function readEngagementContextFromBriefData(rawBrief: unknown): EngagementContextRead {
  if (rawBrief === undefined) return { context: allUnknown() };
  if (!isPlainObject(rawBrief) || !isWellFormedBriefEnvelope(rawBrief)) {
    return { context: allUnknown(), note: NOTE_BRIEF_SHAPE };
  }
  if (rawBrief.context === undefined) return { context: allUnknown() };
  const rawContext = rawBrief.context;
  if (!isPlainObject(rawContext) || !isWellFormedContextEnvelope(rawContext)) {
    return { context: allUnknown(), note: NOTE_CONTEXT_SHAPE };
  }
  return { context: snapshotFromFields(rawContext.fields) };
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
 * Reads `<repositoryRoot>/<briefRelPath>` (default `clossys/brief.json`,
 * the path every staffed repository carries it at) and returns its
 * engagement context. A missing file is the ordinary "no brief" case, not
 * a note; an unreadable file reports its OS error code via
 * {@link unreadableBriefNote}, and an unparseable one a fixed note — in
 * both cases every field reads unknown.
 */
export function readEngagementContext(repositoryRoot: string, briefRelPath = "clossys/brief.json"): EngagementContextRead {
  const path = join(repositoryRoot, briefRelPath);
  if (!existsSync(path)) return { context: allUnknown() };
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return { context: allUnknown(), note: unreadableBriefNote(error) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { context: allUnknown(), note: NOTE_UNPARSEABLE };
  }
  return readEngagementContextFromBriefData(parsed);
}
