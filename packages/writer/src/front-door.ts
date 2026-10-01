/**
 * The front-door copy kind: the words on a sign-in page and the pages around
 * it, as one shipped catalog of reserved ids with English defaults and a
 * noun resolver.
 *
 * Sign-in and boundary pages each used to carry their own copy. This module
 * is a reserved copy kind like the messaging kit, not a second text store or
 * a second approval path: `resolveFrontDoorCopy` asks `resolveCopyRef`, so
 * everything that resolver refuses is refused here for the same reason.
 *
 * Invariants:
 *
 * - F1: an id is `front-door.<state>.<slot>`, where the slot is one of
 *   `title`, `description`, `label`, `primary`, `secondary`, `notice` or
 *   `alt`. This version ships ten sign-in ids; `FRONT_DOOR_COPY_IDS` is
 *   the closed list and `FrontDoorKey` its element union.
 * - F2: a `{token}` in a default text is a noun from `FRONT_DOOR_NOUNS`
 *   and is declared in the entry's `placeholders`. The nouns are a closed
 *   set: a caller cannot invent one.
 * - F3: `resolveFrontDoorCopy` hands `resolveCopyRef` only the nouns the
 *   entry declares. A known noun the entry does not use is dropped, not
 *   an error; a name outside the closed set is `"unknown-noun"`.
 * - F4: a declared noun that is absent or blank (after trimming) is
 *   `"missing-noun"`. A blank noun never renders as an empty gap.
 * - F5: every issue is reported, in order: unknown nouns, then missing
 *   nouns. `text` and `resolution` exist only when `issues` is empty.
 *   Nothing here throws for any input.
 * - F6: a site overrides one entry by registering the same id in its own
 *   registry and resolving it with `resolveCopyRef`; these defaults are
 *   the fallback, not a lock.
 *
 * The defaults are US English, shipped on purpose, and carry no approval
 * record: their `approved` status is the package's own statement, not a
 * consumer's sign-off.
 */

import { resolveCopyRef } from "./resolve.js";
import type { CopyRegistry, CopyRegistryEntry, CopyResolution } from "./types.js";

/** All ten reserved front-door copy ids, in catalog order. */
export const FRONT_DOOR_COPY_IDS = [
  "front-door.sign-in.title",
  "front-door.sign-in.description",
  "front-door.sign-in.label",
  "front-door.sign-in.primary",
  "front-door.password.title",
  "front-door.password.description",
  "front-door.password.label",
  "front-door.password.primary",
  "front-door.password.secondary",
  "front-door.identifier-not-found.notice",
] as const;

/** A reserved front-door copy id. */
export type FrontDoorKey = (typeof FRONT_DOOR_COPY_IDS)[number];

/** The closed set of nouns a front-door text may name as a `{token}`. */
export const FRONT_DOOR_NOUNS = ["brand", "surface", "identifier", "digest", "requestAccessLabel"] as const;

/** One noun a front-door text may name. */
export type FrontDoorNoun = (typeof FRONT_DOOR_NOUNS)[number];

/** The nouns a caller supplies; each is read only when the entry declares it. */
export type FrontDoorNouns = Partial<Record<FrontDoorNoun, string>>;

/** Why a front-door entry could not be resolved. */
export type FrontDoorCopyIssueReason = "unknown-copy-id" | "missing-noun" | "unknown-noun";

/** One reason a front-door entry could not be resolved. */
export interface FrontDoorCopyIssue {
  reason: FrontDoorCopyIssueReason;
  message: string;
  /** The id asked for, on `"unknown-copy-id"`. */
  id?: string;
  /** The noun at fault, on `"missing-noun"` and `"unknown-noun"`. */
  noun?: string;
}

/**
 * The outcome of `resolveFrontDoorCopy`. `text` and `resolution` are
 * present only when `complete` is `true`; `issues` is empty exactly then.
 */
export interface FrontDoorCopyResolution {
  complete: boolean;
  text?: string;
  resolution?: CopyResolution;
  issues: FrontDoorCopyIssue[];
}

const DEFAULTS: Readonly<Record<FrontDoorKey, { text: string; context: string }>> = {
  "front-door.sign-in.title": { text: "Sign in", context: "sign-in page: heading" },
  "front-door.sign-in.description": { text: "Continue to {surface}.", context: "sign-in page: line under the heading" },
  "front-door.sign-in.label": { text: "Email", context: "sign-in page: email field label" },
  "front-door.sign-in.primary": { text: "Continue", context: "sign-in page: main button" },
  "front-door.password.title": { text: "Enter your password", context: "password page: heading" },
  "front-door.password.description": { text: "Signing in as {identifier}.", context: "password page: line under the heading" },
  "front-door.password.label": { text: "Password", context: "password page: password field label" },
  "front-door.password.primary": { text: "Sign in", context: "password page: main button" },
  "front-door.password.secondary": { text: "Use a different email", context: "password page: link back to the email step" },
  "front-door.identifier-not-found.notice": {
    text: "We couldn’t find an account for that email. Check it and try again.",
    context: "sign-in page: notice when no account matches the email",
  },
};

function placeholdersOf(text: string): string[] {
  return [...new Set([...text.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!))];
}

function entryFor(id: FrontDoorKey): CopyRegistryEntry {
  const { text, context } = DEFAULTS[id];
  const placeholders = placeholdersOf(text);
  return {
    id,
    text,
    context,
    status: "approved",
    ...(placeholders.length > 0 ? { placeholders } : {}),
  };
}

/** The shipped English defaults for every id in `FRONT_DOOR_COPY_IDS`. */
export const FRONT_DOOR_COPY_EN: CopyRegistry = {
  id: "front-door",
  locale: "en",
  revision: "1",
  source: { kind: "imported", reference: "@clossys/writer/front-door.en.json" },
  entries: FRONT_DOOR_COPY_IDS.map(entryFor),
};

/** Whether `value` is one of the ten reserved front-door copy ids. */
export function isFrontDoorCopyId(value: unknown): value is FrontDoorKey {
  return typeof value === "string" && (FRONT_DOOR_COPY_IDS as readonly string[]).includes(value);
}

/** Copies the own, enumerable string-keyed values of `nouns`; anything unreadable reads as no nouns at all. */
function readNouns(nouns: unknown): Map<string, unknown> {
  const read = new Map<string, unknown>();
  if (typeof nouns !== "object" || nouns === null || Array.isArray(nouns)) return read;
  try {
    for (const name of Object.keys(nouns)) read.set(name, (nouns as Record<string, unknown>)[name]);
  } catch {
    return new Map();
  }
  return read;
}

/**
 * Resolves one front-door entry from the shipped English defaults, naming
 * the nouns it declares. Only nouns the entry declares reach
 * `resolveCopyRef`; a name outside `FRONT_DOOR_NOUNS` is reported as
 * `"unknown-noun"` and a declared noun that is absent or blank as
 * `"missing-noun"`. An id outside `FRONT_DOOR_COPY_IDS` is
 * `"unknown-copy-id"`. Pure and total: the defaults and `nouns` are not
 * modified and no input makes this throw.
 */
export function resolveFrontDoorCopy(key: FrontDoorKey, nouns: FrontDoorNouns): FrontDoorCopyResolution {
  if (!isFrontDoorCopyId(key)) {
    return {
      complete: false,
      issues: [{ reason: "unknown-copy-id", id: String(key), message: `Front-door copy id "${String(key)}" is not a reserved id.` }],
    };
  }

  const supplied = readNouns(nouns);
  const issues: FrontDoorCopyIssue[] = [];
  for (const name of supplied.keys()) {
    if (!(FRONT_DOOR_NOUNS as readonly string[]).includes(name)) {
      issues.push({ reason: "unknown-noun", noun: name, message: `"${name}" is not a front-door noun.` });
    }
  }

  const entry = FRONT_DOOR_COPY_EN.entries.find((candidate) => candidate.id === key)!;
  const values: Record<string, string> = {};
  for (const name of entry.placeholders ?? []) {
    const value = supplied.get(name);
    if (typeof value !== "string" || value.trim().length === 0) {
      issues.push({ reason: "missing-noun", id: key, noun: name, message: `Front-door copy "${key}" needs the noun "${name}", which is absent or blank.` });
    } else {
      values[name] = value;
    }
  }
  if (issues.length > 0) return { complete: false, issues };

  const result = resolveCopyRef(FRONT_DOOR_COPY_EN, { id: key, values });
  if (!result.complete || !result.resolution) {
    // Unreachable for the shipped catalog (every id resolves, which the tests pin); kept so nothing here can throw or pass silently.
    return {
      complete: false,
      issues: [{ reason: "unknown-copy-id", id: key, message: result.issues[0]?.message ?? `Front-door copy "${key}" could not be resolved.` }],
    };
  }
  return { complete: true, text: result.resolution.text, resolution: result.resolution, issues: [] };
}
