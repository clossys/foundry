/**
 * Strict, deterministic `CopyRef` resolution for rendered surfaces.
 *
 * This is intentionally separate from the source scanner's `CopyRecord`
 * support. A scanner can compare a local sentence against an unversioned
 * record; publishing a page needs stronger evidence: a locale, revision,
 * source provenance, and an approved entry. The result exposes every one of
 * those inputs so `@example/surface` can place them in its output
 * manifest without knowing how a consumer stores copy.
 *
 * Target policy: an owner-approved entry resolves on both `"preview"` and
 * `"production"` (the default target). A delegate-approved entry resolves
 * freely on `"preview"`, but on `"production"` is refused
 * (`delegate-approval-refused`) unless the caller opts in with
 * `acceptDelegateInProduction: true` — a delegate's sign-off is not, by
 * itself, sufficient evidence to publish, only to preview.
 */

import type {
  CopyRef,
  CopyRegistry,
  CopyResolution,
  CopyResolver,
  CopyValue,
} from "./types.js";
import { validateCopyRegistryShape } from "./schema.js";
import { isApprovalExpired, isApprovalStale } from "./approval.js";

export type CopyResolveIssueReason =
  | "invalid-registry"
  | "invalid-ref"
  | "locale-mismatch"
  | "unknown-copy-id"
  | "copy-not-approved"
  | "missing-placeholder-value"
  | "unexpected-placeholder-value"
  | "invalid-options"
  | "approval-stale"
  | "approval-expired"
  | "delegate-approval-refused";

/** Which audience a resolution is for — see this file's top doc comment for the policy difference. */
export type CopyResolveTarget = "preview" | "production";

/** Options controlling how strictly `resolveCopyRef`/`createCopyResolver` treat an entry's approval record. */
export interface CopyResolveOptions {
  /** Defaults to `"production"`. */
  target?: CopyResolveTarget;
  /** Defaults to `false`. Only meaningful when `target` is `"production"`. */
  acceptDelegateInProduction?: boolean;
  /** Defaults to `new Date()`, evaluated per call. */
  now?: Date;
}

export interface CopyResolveIssue {
  reason: CopyResolveIssueReason;
  message: string;
  id?: string;
  placeholder?: string;
}

export interface CopyResolveResult {
  resolution?: CopyResolution;
  issues: CopyResolveIssue[];
  complete: boolean;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCopyValue(value: unknown): value is CopyValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function interpolate(text: string, values: Readonly<Record<string, CopyValue>>): string {
  return text.replace(/\{([^{}]+)\}/g, (_match, name: string) => String(values[name]!));
}

/**
 * True when `value` is a well-formed `CopyResolveOptions` — checked before
 * anything else so a malformed caller-supplied options object fails closed
 * rather than silently falling back to defaults.
 */
function isValidResolveOptions(value: unknown): value is CopyResolveOptions {
  if (value === undefined) return true;
  if (!isPlainObject(value)) return false;
  const { target, acceptDelegateInProduction, now } = value;
  if (target !== undefined && target !== "preview" && target !== "production") return false;
  if (acceptDelegateInProduction !== undefined && typeof acceptDelegateInProduction !== "boolean") return false;
  if (now !== undefined && !(now instanceof Date && Number.isFinite(now.getTime()))) return false;
  return true;
}

/**
 * Resolves a `CopyRef` against one locale-specific registry. Any absence,
 * lifecycle failure, locale mismatch, staleness/expiry, delegate-in-production
 * refusal, or placeholder mismatch produces no text and a non-complete
 * result. Consumers may log `issues`; renderers must treat a missing
 * `resolution` as an unresolved required input.
 */
export function resolveCopyRef(
  registry: CopyRegistry | unknown,
  ref: CopyRef | unknown,
  options?: CopyResolveOptions | unknown,
): CopyResolveResult {
  if (!isValidResolveOptions(options)) {
    return {
      issues: [{ reason: "invalid-options", message: "CopyResolveOptions is malformed." }],
      complete: false,
    };
  }
  const target: CopyResolveTarget = options?.target ?? "production";
  const acceptDelegateInProduction = options?.acceptDelegateInProduction ?? false;
  const now = options?.now ?? new Date();

  const registryFindings = validateCopyRegistryShape(registry);
  if (registryFindings.length > 0) {
    return {
      issues: [{ reason: "invalid-registry", message: "CopyRegistry must pass validateCopyRegistryShape before it can resolve CopyRefs." }],
      complete: false,
    };
  }
  // Safe after the validator's complete structural check. The public
  // signature still accepts unknown because JavaScript callers can bypass
  // TypeScript and resolution must fail closed rather than throw.
  const validRegistry = registry as CopyRegistry;

  if (!isPlainObject(ref) || !isNonEmptyString(ref.id) || (ref.locale !== undefined && !isNonEmptyString(ref.locale)) || (ref.values !== undefined && !isPlainObject(ref.values))) {
    return {
      issues: [{ reason: "invalid-ref", message: "CopyRef.id must be a non-empty string." }],
      complete: false,
    };
  }
  const validRef = ref as { id: string; locale?: string; values?: Readonly<Record<string, unknown>> };

  if (validRef.locale !== undefined && validRef.locale !== validRegistry.locale) {
    return {
      issues: [
        {
          reason: "locale-mismatch",
          id: validRef.id,
          message: `CopyRef "${validRef.id}" requests locale "${validRef.locale}", but this registry provides "${validRegistry.locale}".`,
        },
      ],
      complete: false,
    };
  }

  const entry = validRegistry.entries.find((candidate) => candidate.id === validRef.id);
  if (!entry) {
    return {
      issues: [
        { reason: "unknown-copy-id", id: validRef.id, message: `CopyRef "${validRef.id}" is not present in registry "${validRegistry.id}".` },
      ],
      complete: false,
    };
  }

  if (entry.status !== "approved") {
    return {
      issues: [
        {
          reason: "copy-not-approved",
          id: validRef.id,
          message: `CopyRef "${validRef.id}" is ${entry.status} and cannot be rendered until it is approved.`,
        },
      ],
      complete: false,
    };
  }

  const approval = entry.approval;
  if (approval) {
    if (isApprovalStale(entry)) {
      return {
        issues: [
          {
            reason: "approval-stale",
            id: validRef.id,
            message: `CopyRef "${validRef.id}"'s approval record no longer matches its current text.`,
          },
        ],
        complete: false,
      };
    }
    if (isApprovalExpired(approval, now)) {
      return {
        issues: [
          {
            reason: "approval-expired",
            id: validRef.id,
            message: `CopyRef "${validRef.id}"'s approval expired at ${approval.expiresAt}.`,
          },
        ],
        complete: false,
      };
    }
    if (approval.approvedBy === "delegate" && target === "production" && acceptDelegateInProduction !== true) {
      return {
        issues: [
          {
            reason: "delegate-approval-refused",
            id: validRef.id,
            message: `CopyRef "${validRef.id}" was approved by a delegate; production resolution requires acceptDelegateInProduction: true.`,
          },
        ],
        complete: false,
      };
    }
  }

  const values = validRef.values ?? {};
  const issues: CopyResolveIssue[] = [];
  const declared = new Set(entry.placeholders ?? []);
  for (const placeholder of declared) {
    if (!Object.hasOwn(values, placeholder)) {
      issues.push({
        reason: "missing-placeholder-value",
        id: validRef.id,
        placeholder,
        message: `CopyRef "${validRef.id}" is missing a value for required placeholder "${placeholder}".`,
      });
    } else if (!isCopyValue(values[placeholder])) {
      issues.push({
        reason: "missing-placeholder-value",
        id: validRef.id,
        placeholder,
        message: `CopyRef "${validRef.id}" has an invalid value for placeholder "${placeholder}".`,
      });
    }
  }
  for (const name of Object.keys(values)) {
    if (!declared.has(name)) {
      issues.push({
        reason: "unexpected-placeholder-value",
        id: validRef.id,
        placeholder: name,
        message: `CopyRef "${validRef.id}" supplies "${name}", which is not declared by that copy entry.`,
      });
    }
  }
  if (issues.length > 0) return { issues, complete: false };

  const resolution: CopyResolution = {
    ref: validRef as unknown as CopyRef,
    text: interpolate(entry.text, values as Readonly<Record<string, CopyValue>>),
    recordId: validRegistry.id,
    revision: validRegistry.revision,
    locale: validRegistry.locale,
    source: validRegistry.source,
    entryId: entry.id,
  };
  // Only set when the entry actually carries a record — an approved entry
  // with no record resolves exactly as it did before this field existed,
  // with no `approval` key on the resolution at all.
  if (approval) {
    resolution.approval = { approvedBy: approval.approvedBy, pendingOwnerReview: approval.pendingOwnerReview === true };
  }

  return { resolution, issues: [], complete: true };
}

/** Creates the narrow resolver callback for presentation code. */
export function createCopyResolver(registry: CopyRegistry | unknown, options?: CopyResolveOptions | unknown): CopyResolver {
  return (ref) => resolveCopyRef(registry, ref, options).resolution;
}
