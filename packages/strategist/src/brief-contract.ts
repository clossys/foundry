/**
 * The engagement brief (issue #1173, #1475), validated against the shared
 * contracts `docs/contracts/engagement-brief.json` and
 * `engagement-context.json`. This package's build
 * (`scripts/pack-brief-contract.mjs`) packs those two files into
 * `src/generated/` as plain data, with a generated copy of the one contract
 * checker `packages/advisor/src/contract-schema.ts` also implements, so
 * Strategist validates a brief against the same definition
 * `@clossys/advisor` and `@clossys/launcher` do, with no runtime dependency
 * on either. Strategist only reads a brief; it never writes one, and packs
 * only the two contracts it actually validates against -- not
 * `docs/contracts/advisor-plan.json`, which it never reads. All four paths
 * cited above are in the public repository, not shipped in this package.
 */

import { formatContractViolation, validateAgainstContract } from "./generated/contract-schema.generated.js";
import type { ContractSchema } from "./generated/contract-schema.generated.js";
import { BRIEF_CONTRACTS } from "./generated/brief-contracts.generated.js";

export type ValidationResult = { readonly valid: true } | { readonly valid: false; readonly reason: string };

function loadContract(name: string): ContractSchema {
  const contract = Object.hasOwn(BRIEF_CONTRACTS, name) ? BRIEF_CONTRACTS[name] : undefined;
  if (contract === undefined) throw new Error(`no packed contract named ${JSON.stringify(name)}`);
  return contract;
}

/**
 * Validates a brief against `docs/contracts/engagement-brief.json`,
 * including its optional `context` snapshot against
 * `engagement-context.json`: a known context value must be one of that
 * field's fixed choice ids, an unknown field or object key is refused, and
 * a duplicate context field id is refused (the contract's own
 * `contains`/`maxItems` rule leaves no room for one). Never mutates, never
 * re-derives content. `reason` can name a violated field's path, but never
 * echoes a value from the brief -- see `contract-schema.ts`'s own header;
 * this package's own callers (`engagement-context.ts`) do not relay
 * `reason` at all, only a fixed note, so even that path text never reaches
 * a caller. The contract cited above is in the public repository -- not shipped in this package.
 */
export function validateEngagementBrief(value: unknown): ValidationResult {
  const violations = validateAgainstContract(loadContract("engagement-brief.json"), value, loadContract);
  if (violations.length === 0) return { valid: true };
  return { valid: false, reason: violations.map((violation) => formatContractViolation("brief", violation)).join("; ") };
}
