// The hub repository inventory (issues #996, #1334 and #1179), validated
// against the shared contract docs/contracts/repository-inventory.json.
// This package's build packs that file into src/generated/ beside the plan
// and brief contracts, and checks it with the generated copy of the one
// contract checker @clossys/advisor also uses -- so an inventory Launcher
// writes, an inventory Launcher reads back, and a repository id Advisor
// offers on its repository-choice card are all judged by one definition.
//
// Refusals follow the checker's conventions: they name a field by its
// position (for example `repositories[2].id`), never quote a repository id
// or any other value from the document, and report a JSON syntax error by
// position only.

import { readContractDocument, validateAgainstContract } from "./generated/contract-schema.generated.js";
import type { ContractViolation } from "./generated/contract-schema.generated.js";
import { loadContract } from "./plan-contract.js";

/** The contract's file name, as packed. */
export const INVENTORY_CONTRACT = "repository-inventory.json";

/** Points a refusal at the one place the shape is written down. */
export const INVENTORY_CONTRACT_POINTER = "see docs/contracts/repository-inventory.json";

/**
 * The result of checking one inventory document: its repository ids, in
 * document order, or the reason it is refused. `reason` names every field
 * at fault, separated by `; `, and ends with a pointer to the contract.
 */
export type InventoryValidation =
  | { readonly valid: true; readonly ids: readonly string[] }
  | { readonly valid: false; readonly reason: string };

/** One inventory entry, exactly as the contract allows it. */
export interface InventoryEntry {
  readonly id: string;
  readonly packages?: readonly { readonly name: string; readonly version?: string; readonly wiring?: string }[];
}

function describeViolation(violation: ContractViolation): string {
  return violation.path === "" ? violation.message : `${violation.path} ${violation.message}`;
}

/**
 * The one rule the contract states but JSON Schema cannot express: two ids
 * that differ only in letter case name the same repository (GitHub owner and
 * repository names are case-insensitive). Returns the later position and the
 * earlier one it repeats, or undefined.
 */
function firstRepeatedId(ids: readonly string[]): { readonly index: number; readonly earlier: number } | undefined {
  const seen = new Map<string, number>();
  for (const [index, id] of ids.entries()) {
    const key = id.toLowerCase();
    const earlier = seen.get(key);
    if (earlier !== undefined) return { index, earlier };
    seen.set(key, index);
  }
  return undefined;
}

/**
 * Validates an already-parsed value against the inventory contract through
 * the shared checker, then applies the contract's case-insensitive
 * duplicate rule. Never throws for a bad value.
 */
export function validateInventoryValue(value: unknown): InventoryValidation {
  const violations = validateAgainstContract(loadContract(INVENTORY_CONTRACT), value, loadContract);
  if (violations.length > 0) {
    return { valid: false, reason: `${violations.map(describeViolation).join("; ")} (${INVENTORY_CONTRACT_POINTER})` };
  }
  const ids = (value as { readonly repositories: readonly InventoryEntry[] }).repositories.map((entry) => entry.id);
  const repeated = firstRepeatedId(ids);
  if (repeated !== undefined) {
    return {
      valid: false,
      reason: `repositories[${repeated.index}].id names the same repository as repositories[${repeated.earlier}].id (repository ids are compared case-insensitively; ${INVENTORY_CONTRACT_POINTER})`,
    };
  }
  return { valid: true, ids };
}

/**
 * Strictly validates an inventory document's text against
 * docs/contracts/repository-inventory.json. The text is read as strict JSON
 * by the shared reader -- a syntax error (reported by position only), a key
 * repeated in any object, or a leading byte order mark is refused -- and
 * the value is then checked by the shared contract checker. Every read of
 * an inventory document goes through this: `--inventory`, the stored
 * `clossys/.state/inventory.json` on every resume, `readInventoryRepositories()`,
 * and the document `launcher --repositories` writes, before it writes it.
 */
export function validateInventoryDocument(raw: string): InventoryValidation {
  let value: unknown;
  try {
    value = readContractDocument(new TextEncoder().encode(raw));
  } catch (cause) {
    return { valid: false, reason: `${cause instanceof Error ? cause.message : String(cause)} (${INVENTORY_CONTRACT_POINTER})` };
  }
  return validateInventoryValue(value);
}

/**
 * Whether one id satisfies the contract's `definitions/repositoryId` -- a
 * bare repository name or `owner/name`, by the same GitHub owner and
 * repository rules Launcher applies when it resolves a sibling clone.
 */
export function isValidInventoryId(id: string): boolean {
  return validateAgainstContract({ $ref: `${INVENTORY_CONTRACT}#/definitions/repositoryId` }, id, loadContract).length === 0;
}

/** The inventory document text Launcher writes for these entries: two-space JSON and a final newline. */
export function renderInventoryDocument(entries: readonly InventoryEntry[]): string {
  return `${JSON.stringify({ schemaVersion: 1, repositories: entries }, null, 2)}\n`;
}
