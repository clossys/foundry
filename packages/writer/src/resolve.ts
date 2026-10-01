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
 * `acceptDelegateInProduction: true`, or passes `approvalPlan`, the bytes of
 * a plan whose latest approval names that plan's own digest and which
 * declares `delegatedCopyApproval` covering the entry — a delegate's sign-off
 * is not, by itself, sufficient evidence to publish, only to preview.
 */

import type {
  CopyRef,
  CopyRegistry,
  CopyResolution,
  CopyResolutionApproval,
  CopyResolver,
  CopyValue,
} from "./types.js";
import { validateCopyRegistryShape } from "./schema.js";
import { isApprovalExpired, isApprovalStale, isEntryInDelegateScope } from "./approval.js";
import { isPlanBytes, planDelegateCopyAuthority } from "./plan-authority.js";
import type { PlanDelegateCopyRefusal } from "./plan-authority.js";

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
  /**
   * The bytes of an Advisor plan record (a `Uint8Array`; Node's `Buffer` is
   * one), read by the caller. Consulted only for a delegate-approved entry on
   * `"production"` when `acceptDelegateInProduction` is not `true`: see
   * `planDelegateCopyAuthority()`. Not a `Uint8Array`, or given together with
   * `acceptDelegateInProduction: true`, is `"invalid-options"`.
   */
  approvalPlan?: Uint8Array;
}

/** Why an `approvalPlan` did not authorize an entry: the plan's own refusal, or that the entry is outside the scopes the plan declares. */
export type CopyResolvePlanRefusal = PlanDelegateCopyRefusal | "entry-outside-plan-scopes";

export interface CopyResolveIssue {
  reason: CopyResolveIssueReason;
  message: string;
  id?: string;
  placeholder?: string;
  /** Only on `"delegate-approval-refused"` when an `approvalPlan` was given: why it did not authorize this entry. */
  planRefusal?: CopyResolvePlanRefusal;
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

/** The options a call runs with, each read from the caller's object exactly once. */
interface ResolveSettings {
  target: CopyResolveTarget;
  acceptDelegateInProduction: boolean;
  now: Date;
  approvalPlan: Uint8Array | undefined;
}

/**
 * Reads a well-formed `CopyResolveOptions`, or returns null — checked before
 * anything else so a malformed caller-supplied options object fails closed
 * rather than silently falling back to defaults. Each property is read
 * exactly once, into a local that is validated and then used, so a getter
 * cannot answer differently at validation and at use.
 */
function readResolveOptions(value: unknown): ResolveSettings | null {
  if (value === undefined) return { target: "production", acceptDelegateInProduction: false, now: new Date(), approvalPlan: undefined };
  if (!isPlainObject(value)) return null;
  const { target, acceptDelegateInProduction, now, approvalPlan } = value;
  if (target !== undefined && target !== "preview" && target !== "production") return null;
  if (acceptDelegateInProduction !== undefined && typeof acceptDelegateInProduction !== "boolean") return null;
  if (now !== undefined && !(now instanceof Date && Number.isFinite(now.getTime()))) return null;
  if (approvalPlan !== undefined && !isPlanBytes(approvalPlan)) return null;
  // Two authorities for one decision is an ambiguity, so it is refused: no precedence needs defining.
  if (approvalPlan !== undefined && acceptDelegateInProduction === true) return null;
  return {
    target: target ?? "production",
    acceptDelegateInProduction: acceptDelegateInProduction ?? false,
    now: now ?? new Date(),
    approvalPlan,
  };
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
  const settings = readResolveOptions(options);
  if (settings === null) {
    return {
      issues: [{ reason: "invalid-options", message: "CopyResolveOptions is malformed." }],
      complete: false,
    };
  }
  const { target, acceptDelegateInProduction, now, approvalPlan } = settings;

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
  // Set only when an approvalPlan, not the flag, authorized a delegate entry on production.
  let authorizingPlanDigest: string | undefined;
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
      // The flag did not authorize this entry, so only a plan can. The plan is
      // read here and nowhere else: never for preview, an owner entry, a
      // record-less entry, or once the flag is true, and never before the
      // entry's own staleness and expiry, which outrank it.
      if (approvalPlan === undefined) {
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
      const planRefused = (code: CopyResolvePlanRefusal): CopyResolveResult => ({
        issues: [
          {
            reason: "delegate-approval-refused",
            id: validRef.id,
            planRefusal: code,
            message: `CopyRef "${validRef.id}" was approved by a delegate; the approvalPlan given does not authorize it on production (${code}).`,
          },
        ],
        complete: false,
      });
      const authority = planDelegateCopyAuthority(approvalPlan);
      if (!authority.authorized) return planRefused(authority.refusal);
      if (authority.scopes !== undefined && !isEntryInDelegateScope(entry.id, authority.scopes)) return planRefused("entry-outside-plan-scopes");
      authorizingPlanDigest = authority.planDigest;
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
    // Built explicitly, so the digest key exists only when a plan authorized the entry.
    const facts: CopyResolutionApproval =
      approval.approvedBy === "owner"
        ? { approvedBy: "owner", pendingOwnerReview: false }
        : {
            approvedBy: "delegate",
            pendingOwnerReview: approval.pendingOwnerReview === true,
            ...(authorizingPlanDigest === undefined ? {} : { authorizingPlanDigest }),
          };
    resolution.approval = facts;
  }

  return { resolution, issues: [], complete: true };
}

/** Creates the narrow resolver callback for presentation code. */
export function createCopyResolver(registry: CopyRegistry | unknown, options?: CopyResolveOptions | unknown): CopyResolver {
  return (ref) => resolveCopyRef(registry, ref, options).resolution;
}
