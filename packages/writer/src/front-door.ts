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
 *   `alt`. This version ships 63 ids; `FRONT_DOOR_COPY_IDS` is
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
import { CANONICAL_IDS, CANONICAL_NOUNS, createDefaultCatalog, prepareFrontDoorCopy } from "./front-door-core.js";
import type { FrontDoorKey, FrontDoorNouns, FrontDoorCopyResolution } from "./front-door-core.js";
export type { FrontDoorKey, FrontDoorNoun, FrontDoorNouns, FrontDoorCopyIssueReason, FrontDoorCopyIssue, FrontDoorCopyResolution } from "./front-door-core.js";

/** Independent mutable legacy catalog objects; private browser defaults never share them. */
export const FRONT_DOOR_COPY_IDS = [...CANONICAL_IDS] as unknown as typeof CANONICAL_IDS;
export const FRONT_DOOR_NOUNS = [...CANONICAL_NOUNS] as unknown as typeof CANONICAL_NOUNS;
export const FRONT_DOOR_COPY_EN = createDefaultCatalog();

export function isFrontDoorCopyId(value: unknown): value is FrontDoorKey {
  return typeof value === "string" && (FRONT_DOOR_COPY_IDS as readonly string[]).includes(value);
}

/** Resolves through the strict registry resolver, preserving approval refusals. */
export function resolveFrontDoorCopy(key: FrontDoorKey, nouns: FrontDoorNouns): FrontDoorCopyResolution {
  const prepared = prepareFrontDoorCopy(key, nouns, FRONT_DOOR_COPY_EN, FRONT_DOOR_COPY_IDS, FRONT_DOOR_NOUNS);
  if (!prepared.complete) return prepared;
  const { values } = prepared;
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
