/**
 * Structural validation for `PublicationEntry` and `Ledger`. Hand-rolled,
 * deliberately, not a schema library — the same discipline
 * `@vespeneventures/policy`'s `validate.ts` and `@vespeneventures/strategy`'s
 * `validation.ts` already hold this whole foundation to: plain type guards
 * over `unknown`, an accumulated `LedgerFinding[]`, never throws. A
 * validator that can crash on the exact malformed input it exists to catch
 * is not one `checkLedgerDrift` or `checkAppendOnly` could call
 * unconditionally before doing real work.
 *
 * This file checks SHAPE only — is `publishedAt` an ISO instant, is
 * `factCitations[i].valueBinding` a well-formed `PolicyBinding`, are entry
 * `id`s unique. It never checks whether a `factRef` names a real fact, or a
 * `strategyRevision` names a real revision — this package cannot know
 * either, by design (see `types.ts`).
 */

import { validateBindingShape } from "@vespeneventures/policy";
import type { FactCitation, LedgerFinding, PublicationEntry } from "./types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// A full ISO 8601 instant, UTC, optionally with fractional seconds —
// exactly what `new Date().toISOString()` produces in every JS runtime.
// Stricter than `@vespeneventures/strategy`'s `ISO_DATE_RE` (a bare
// YYYY-MM-DD) on purpose: a ledger entry records a specific moment an
// action happened, not a calendar day a value described "as of".
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function isValidUrl(value: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a single `FactCitation`: `factRef` is a non-empty string,
 * `valueBinding` passes `@vespeneventures/policy`'s own
 * `validateBindingShape` unchanged (never reimplemented here), and —
 * the one rule this package adds on top — `valueBinding.policyId` must
 * equal `factRef`, by the convention `types.ts`'s `FactCitation` doc
 * comment documents. Findings from `validateBindingShape` are re-pathed
 * under `path` so a caller can tell which citation, in which entry, a
 * finding is about — `validateBindingShape` itself has no idea it is being
 * called from inside a larger structure.
 */
function validateFactCitation(value: unknown, path: string): LedgerFinding[] {
  const findings: LedgerFinding[] = [];
  if (!isPlainObject(value)) {
    findings.push({ rule: "citation-shape", severity: "error", message: `${path} must be an object shaped { factRef, valueBinding }.`, path });
    return findings;
  }

  const factRef = value.factRef;
  if (!isNonEmptyString(factRef)) {
    findings.push({ rule: "citation-fact-ref-shape", severity: "error", message: `${path}.factRef must be a non-empty string, got ${JSON.stringify(factRef)}.`, path: `${path}.factRef` });
  }

  const bindingFindings = validateBindingShape(value.valueBinding);
  for (const f of bindingFindings) {
    findings.push({ rule: `citation-binding-${f.rule}`, severity: f.severity, message: `${path}.valueBinding: ${f.message}`, path: `${path}.valueBinding${f.path && f.path !== "$" ? `.${f.path}` : ""}` });
  }

  // Only checkable once both sides are known-good strings — a malformed
  // factRef or a malformed/absent binding.policyId already produced its own
  // finding above, and comparing two untrustworthy values would just add
  // noise on top of a problem already reported.
  if (
    isNonEmptyString(factRef) &&
    bindingFindings.length === 0 &&
    isPlainObject(value.valueBinding) &&
    value.valueBinding.policyId !== factRef
  ) {
    findings.push({
      rule: "citation-policy-id-mismatch",
      severity: "error",
      message: `${path}.valueBinding.policyId (${JSON.stringify(value.valueBinding.policyId)}) must equal ${path}.factRef (${JSON.stringify(factRef)}).`,
      path: `${path}.valueBinding.policyId`,
    });
  }

  return findings;
}

/**
 * Validates a single `PublicationEntry`. Never throws; an empty return
 * means the entry is well-formed. `path` defaults to `"(root)"` so a
 * standalone call (`validateEntry(candidate)`) reads naturally, and
 * `validateLedger` overrides it per-index (`"[3]"`) when validating a
 * whole `Ledger`.
 */
export function validateEntry(value: unknown, path = "(root)"): LedgerFinding[] {
  const findings: LedgerFinding[] = [];

  if (!isPlainObject(value)) {
    findings.push({ rule: "entry-shape", severity: "error", message: `${path} must be an object.`, path });
    return findings;
  }

  if (!isNonEmptyString(value.id)) {
    findings.push({ rule: "entry-id-shape", severity: "error", message: `${path}.id must be a non-empty string, got ${JSON.stringify(value.id)}.`, path: `${path}.id` });
  }

  if (!isNonEmptyString(value.publishedAt) || !ISO_INSTANT_RE.test(value.publishedAt)) {
    findings.push({
      rule: "entry-published-at-shape",
      severity: "error",
      message: `${path}.publishedAt must be an ISO 8601 UTC instant (e.g. "2026-08-07T14:03:00.000Z"), got ${JSON.stringify(value.publishedAt)}.`,
      path: `${path}.publishedAt`,
    });
  }

  if (!isNonEmptyString(value.channel)) {
    findings.push({ rule: "entry-channel-shape", severity: "error", message: `${path}.channel must be a non-empty string, got ${JSON.stringify(value.channel)}.`, path: `${path}.channel` });
  }

  if (value.url !== undefined && (!isNonEmptyString(value.url) || !isValidUrl(value.url))) {
    findings.push({ rule: "entry-url-shape", severity: "error", message: `${path}.url, when present, must be a non-empty, parseable URL, got ${JSON.stringify(value.url)}.`, path: `${path}.url` });
  }

  if (!isNonEmptyString(value.strategyRevision)) {
    findings.push({
      rule: "entry-strategy-revision-shape",
      severity: "error",
      message: `${path}.strategyRevision must be a non-empty string, got ${JSON.stringify(value.strategyRevision)}.`,
      path: `${path}.strategyRevision`,
    });
  }

  if (!Array.isArray(value.factCitations)) {
    findings.push({
      rule: "entry-fact-citations-shape",
      severity: "error",
      message: `${path}.factCitations must be an array (may be empty), got ${value.factCitations === undefined ? "undefined" : typeof value.factCitations}.`,
      path: `${path}.factCitations`,
    });
  } else {
    const seenRefs = new Map<string, number>();
    value.factCitations.forEach((citation, i) => {
      findings.push(...validateFactCitation(citation, `${path}.factCitations[${i}]`));
      const ref = isPlainObject(citation) && isNonEmptyString(citation.factRef) ? citation.factRef : undefined;
      if (ref !== undefined) {
        const firstIndex = seenRefs.get(ref);
        if (firstIndex !== undefined) {
          findings.push({
            rule: "duplicate-fact-citation",
            severity: "warning",
            message: `${path}.factCitations[${i}] cites "${ref}" again — already cited at index ${firstIndex}. Not an error (a redundant citation is harmless), but worth a look.`,
            path: `${path}.factCitations[${i}].factRef`,
          });
        } else {
          seenRefs.set(ref, i);
        }
      }
    });
  }

  if (value.contentBinding !== undefined) {
    const bindingFindings = validateBindingShape(value.contentBinding);
    for (const f of bindingFindings) {
      findings.push({ rule: `entry-content-binding-${f.rule}`, severity: f.severity, message: `${path}.contentBinding: ${f.message}`, path: `${path}.contentBinding${f.path && f.path !== "$" ? `.${f.path}` : ""}` });
    }
  }

  return findings;
}

/**
 * Validates a whole `Ledger`: must be an array, every element must pass
 * `validateEntry`, and every `id` must be unique across the whole array —
 * a duplicate `id` is exactly what an attempted overwrite of an existing
 * entry would look like, so it is reported as an error here, not treated
 * as two independently-valid entries that happen to share a name. See
 * `append.ts`'s `appendEntry` for the in-process guard against ever
 * creating one; this function is what catches it if a ledger's storage was
 * edited by hand or by anything other than `appendEntry`.
 */
export function validateLedger(value: unknown): LedgerFinding[] {
  if (!Array.isArray(value)) {
    return [{ rule: "ledger-shape", severity: "error", message: `A ledger must be an array of entries, got ${value === null ? "null" : typeof value}.`, path: "(root)" }];
  }

  const findings: LedgerFinding[] = [];
  const seenIds = new Map<string, number>();

  value.forEach((entry, i) => {
    findings.push(...validateEntry(entry, `[${i}]`));
    const id = isPlainObject(entry) && isNonEmptyString(entry.id) ? entry.id : undefined;
    if (id !== undefined) {
      const firstIndex = seenIds.get(id);
      if (firstIndex !== undefined) {
        findings.push({
          rule: "duplicate-entry-id",
          severity: "error",
          message: `Entry id ${JSON.stringify(id)} appears more than once (first at index ${firstIndex}, again at index ${i}). A ledger's ids must be unique — a repeated id is what an attempted overwrite of an existing entry looks like.`,
          path: `[${i}].id`,
        });
      } else {
        seenIds.set(id, i);
      }
    }
  });

  return findings;
}
