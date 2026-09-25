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
 * anything else is read as unknown rather than trusted, exactly as
 * Advisor's own `contextFromBrief()` treats a hand-editable, committed
 * JSON file: permissive per field, never thrown.
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
 * Each field's fixed choice vocabulary, copied from
 * `docs/contracts/engagement-context.json`'s per-field `enum` (kept equal
 * to it by that contract's own test in `@clossys/advisor` — this package
 * does not re-derive the contract, it mirrors the closed vocabulary it
 * already publishes). A known field's value must be one of these; nothing
 * else, including a slugified founder sentence, is ever accepted.
 */
const KNOWN_CHOICES: Record<EngagementContextFieldId, readonly string[]> = {
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
 * when the brief file itself could not be treated as a brief at all (not
 * simply absent, and not simply lacking a `context` yet): the caller
 * relays it once and otherwise behaves exactly as it would with no brief.
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

/**
 * Builds a snapshot from `clossys/brief.json`'s parsed `context` property,
 * defensively: a duplicate id, an id outside the six, or a value outside
 * that field's own fixed choices reads as unknown rather than erroring —
 * the same leniency `@clossys/advisor`'s own `contextFromBrief()` applies
 * to this same committed, hand-editable file.
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
      const entry = rawFields.find((candidate) => isPlainObject(candidate) && candidate.id === id) as { state?: unknown; value?: unknown } | undefined;
      if (entry?.state === "known" && typeof entry.value === "string" && KNOWN_CHOICES[id].includes(entry.value)) {
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
 * staffed): every field reads unknown, with no note — this is not an
 * error. A brief that exists but is not a well-formed object, is not
 * `schemaVersion` 1, or carries a `context` property that does not match
 * the contract's own top-level shape (an object with a `fields` array) is
 * reported once via `note`, and still reads as every field unknown — the
 * caller asks everything, exactly as it would with no brief at all, and
 * relays the note rather than silently guessing. A well-formed brief with
 * no `context` property at all (a brief written before #1178, or before a
 * founder has answered anything) is not an error either — `context` is
 * documented optional and reads as unknown, unremarked.
 */
export function readEngagementContextFromBriefData(rawBrief: unknown): EngagementContextRead {
  if (rawBrief === undefined) return { context: allUnknown() };
  if (!isPlainObject(rawBrief)) {
    return { context: allUnknown(), note: "clossys/brief.json is not a JSON object; asking every engagement-context question as usual." };
  }
  if (rawBrief.schemaVersion !== 1) {
    return {
      context: allUnknown(),
      note: `clossys/brief.json has schemaVersion ${JSON.stringify(rawBrief.schemaVersion)}, not 1; asking every engagement-context question as usual.`,
    };
  }
  if (rawBrief.context === undefined) return { context: allUnknown() };
  const rawContext = rawBrief.context;
  if (!isPlainObject(rawContext) || !Array.isArray(rawContext.fields)) {
    return {
      context: allUnknown(),
      note: "clossys/brief.json's context does not match docs/contracts/engagement-context.json's shape; asking every engagement-context question as usual.",
    };
  }
  return { context: snapshotFromFields(rawContext.fields) };
}

/**
 * Reads `<repositoryRoot>/<briefRelPath>` (default `clossys/brief.json`,
 * the path every staffed repository carries it at) and returns its
 * engagement context. A missing file is the ordinary "no brief" case, not
 * a note; an unreadable or unparseable file is reported the same way a
 * malformed brief is — as a note, with every field read unknown.
 */
export function readEngagementContext(repositoryRoot: string, briefRelPath = "clossys/brief.json"): EngagementContextRead {
  const path = join(repositoryRoot, briefRelPath);
  if (!existsSync(path)) return { context: allUnknown() };
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return { context: allUnknown(), note: `${briefRelPath} could not be read (${error instanceof Error ? error.message : String(error)}); asking every engagement-context question as usual.` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { context: allUnknown(), note: `${briefRelPath} is not valid JSON (${error instanceof Error ? error.message : String(error)}); asking every engagement-context question as usual.` };
  }
  return readEngagementContextFromBriefData(parsed);
}
