/**
 * Compile-time proof that `ConsentAuditEvent` (`./types.ts`) carries no
 * raw personal-data field — no email, name, phone, address, or IP — only
 * the opaque `subjectId`, matching the `recipientId` precedent in
 * `packages/comms/src/types.ts`.
 *
 * Named `*.check.ts`, not `*.test.ts`, so it is part of the REAL `tsc` run
 * (`npm run typecheck`) rather than only being transpiled, never
 * type-checked, by vitest — see this repository's own contribution guide's
 * "Type-level assertions live in `.check.ts(x)` files" entry and
 * `packages/ui/src/atoms/internal/icon-contract.check.tsx` for the same
 * pattern. Nothing here is ever imported by `index.ts` or any runtime
 * code; its only job is to fail `tsc` if the contract regresses.
 *
 * `ExactKeys` fails to compile unless `Keys` is EXACTLY the allowed set —
 * neither a subset (a required field silently dropped) nor a superset (a
 * new field silently added, personal-data-shaped or not, without a human
 * deciding it belongs here).
 */
import type { ConsentAuditEvent } from "./types.js";

type ExactKeys<Keys extends string, Allowed extends string> = [Allowed] extends [Keys] ? ([Keys] extends [Allowed] ? true : never) : never;

const ALLOWED_KEYS = ["subjectId", "category", "type", "policyVersion", "occurredAt", "gpcSignal", "previousPolicyVersion"] as const;
type AllowedKey = (typeof ALLOWED_KEYS)[number];

// If `ConsentAuditEvent` ever gains or loses a key relative to `ALLOWED_KEYS`
// above, this assignment stops compiling — including if someone adds an
// `email`, `name`, `ip`, `phone`, or `address`-shaped field.
export const auditEventKeysAreExactlyTheAllowedSet: ExactKeys<keyof ConsentAuditEvent, AllowedKey> = true;
