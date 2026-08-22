/**
 * Compile-time proof that `StandingAuditEvent` (`./schema.ts`) carries no
 * raw personal-data field — no email, name, phone, address, or IP — only
 * the opaque `subjectId` and the separately-opaque `actorId`.
 *
 * Named `*.check.ts`, not `*.test.ts`, so it is part of the REAL `tsc` run
 * (`npm run typecheck`) rather than only being transpiled, never
 * type-checked, by vitest — see this repository's own contribution
 * guide, "Type-level assertions live in `.check.ts(x)` files" entry, and
 * `scripts/check-typechecked-assertions.mjs` for the gate that enforces it.
 * Nothing here is ever imported by `index.ts` or any runtime code; its only
 * job is to fail `tsc` if the contract regresses.
 *
 * `ExactKeys` fails to compile unless `Keys` is EXACTLY the allowed set —
 * neither a subset (a required field silently dropped) nor a superset (a
 * new field silently added, personal-data-shaped or not, without a human
 * deciding it belongs here).
 *
 * `subjectId` and `actorId` are both in the allowed set, deliberately and
 * separately. Merging them into one id would still pass a personal-data
 * scan and would still be wrong: the whole point of this package is
 * telling "the person asked for this" apart from "something acted on its
 * own reading", and a single conflated identifier makes that distinction
 * unrecoverable after the fact.
 */
import type { StandingAuditEvent } from "./schema.js";

type ExactKeys<Keys extends string, Allowed extends string> = [Allowed] extends [Keys] ? ([Keys] extends [Allowed] ? true : never) : never;

const ALLOWED_KEYS = ["subjectId", "actorId", "topic", "type", "policyVersion", "occurredAt", "previousPolicyVersion"] as const;
type AllowedKey = (typeof ALLOWED_KEYS)[number];

// If `StandingAuditEvent` ever gains or loses a key relative to
// `ALLOWED_KEYS` above, this assignment stops compiling — including if
// someone adds an `email`, `name`, `ip`, `phone`, or `address`-shaped
// field, and including if `actorId` is ever folded into `subjectId`.
export const auditEventKeysAreExactlyTheAllowedSet: ExactKeys<keyof StandingAuditEvent, AllowedKey> = true;
