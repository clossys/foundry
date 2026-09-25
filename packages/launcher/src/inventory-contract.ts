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
 * The one identity of a repository id, and the only way Launcher compares
 * two ids: a bare id is qualified with the hub's owner when that owner is
 * known (a bare id means "this repository under the hub's own account", as
 * Launcher's sibling resolution reads it), and the result is lowercased,
 * because GitHub owner and repository names are case-insensitive. Without
 * an owner, a bare id stays bare and only letter case is folded.
 */
export function inventoryKey(id: string, hubOwner?: string): string {
  return (hubOwner !== undefined && !id.includes("/") ? `${hubOwner}/${id}` : id).toLowerCase();
}

/**
 * The first id, if any, that names the same repository as an earlier one
 * under `inventoryKey()`: its position and the earlier position.
 */
export function firstRepeatedRepository(
  ids: readonly string[],
  hubOwner?: string,
): { readonly index: number; readonly earlier: number } | undefined {
  const seen = new Map<string, number>();
  for (const [index, id] of ids.entries()) {
    const key = inventoryKey(id, hubOwner);
    const earlier = seen.get(key);
    if (earlier !== undefined) return { index, earlier };
    seen.set(key, index);
  }
  return undefined;
}

/** Options for reading an inventory document. */
export interface InventoryReadOptions {
  /**
   * The hub's owner, whenever the caller knows it. A bare id and
   * `<hubOwner>/<id>` then name the same repository, so a document listing
   * both is refused instead of carrying two entries for one repository.
   */
  readonly hubOwner?: string;
}

/** A valid document's entries, as internal readers need them; `InventoryValidation` exposes only the ids. */
export type InventoryRead =
  | { readonly valid: true; readonly ids: readonly string[]; readonly entries: readonly InventoryEntry[] }
  | { readonly valid: false; readonly reason: string };

function checkInventoryValue(value: unknown, options: InventoryReadOptions): InventoryRead {
  const violations = validateAgainstContract(loadContract(INVENTORY_CONTRACT), value, loadContract);
  if (violations.length > 0) {
    return { valid: false, reason: `${violations.map(describeViolation).join("; ")} (${INVENTORY_CONTRACT_POINTER})` };
  }
  const entries = (value as { readonly repositories: readonly InventoryEntry[] }).repositories;
  const ids = entries.map((entry) => entry.id);
  const repeated = firstRepeatedRepository(ids, options.hubOwner);
  if (repeated !== undefined) {
    const rule =
      options.hubOwner === undefined
        ? "repository ids are compared case-insensitively"
        : "repository ids are compared case-insensitively, and a bare id names a repository of the hub's own owner";
    return {
      valid: false,
      reason: `repositories[${repeated.index}].id names the same repository as repositories[${repeated.earlier}].id (${rule}; ${INVENTORY_CONTRACT_POINTER})`,
    };
  }
  return { valid: true, ids, entries };
}

function withoutEntries(read: InventoryRead): InventoryValidation {
  return read.valid ? { valid: true, ids: read.ids } : read;
}

/**
 * Validates an already-parsed value against the inventory contract through
 * the shared checker, then applies the duplicate rule. Never throws for a
 * bad value.
 */
export function validateInventoryValue(value: unknown, options: InventoryReadOptions = {}): InventoryValidation {
  return withoutEntries(checkInventoryValue(value, options));
}

/** A lone surrogate in a JS string, which has no UTF-8 encoding; TextEncoder would silently replace it. */
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

/**
 * Reads and checks one inventory document. Bytes -- as every file read
 * passes them, from `WorkspaceHost.readBytes()` -- go straight to the
 * shared strict reader, so bytes that are not valid UTF-8 are refused
 * rather than silently replaced. Text is accepted for a document built in
 * memory, and one holding a lone surrogate is refused before encoding.
 */
export function readInventoryDocument(raw: string | Uint8Array, options: InventoryReadOptions = {}): InventoryRead {
  if (typeof raw === "string" && LONE_SURROGATE.test(raw)) {
    return { valid: false, reason: `is not well-formed Unicode: it contains a lone surrogate, which has no UTF-8 encoding (${INVENTORY_CONTRACT_POINTER})` };
  }
  let value: unknown;
  try {
    value = readContractDocument(typeof raw === "string" ? new TextEncoder().encode(raw) : raw);
  } catch (cause) {
    return { valid: false, reason: `${cause instanceof Error ? cause.message : String(cause)} (${INVENTORY_CONTRACT_POINTER})` };
  }
  return checkInventoryValue(value, options);
}

/**
 * Strictly validates an inventory document against
 * docs/contracts/repository-inventory.json. It is read as strict JSON by the
 * shared reader -- bytes that are not valid UTF-8, a syntax error (reported
 * by position only), a key repeated in any object, or a leading byte order
 * mark is refused -- and the value is then checked by the shared contract
 * checker and the duplicate rule. Every read of an inventory file passes
 * its exact bytes: `--inventory`, the stored `clossys/.state/inventory.json`
 * on every run, `readInventoryRepositories()`, and the document
 * `launcher --repositories` writes, before it writes it.
 */
export function validateInventoryDocument(raw: string | Uint8Array, options: InventoryReadOptions = {}): InventoryValidation {
  return withoutEntries(readInventoryDocument(raw, options));
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
