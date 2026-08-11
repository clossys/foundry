/**
 * Strict, deterministic `CopyRef` resolution for rendered surfaces.
 *
 * This is intentionally separate from the source scanner's `CopyRecord`
 * support. A scanner can compare a local sentence against an unversioned
 * record; publishing a page needs stronger evidence: a locale, revision,
 * source provenance, and an approved entry. The result exposes every one of
 * those inputs so `@vespeneventures/surface` can place them in its output
 * manifest without knowing how a consumer stores copy.
 */

import type {
  CopyRef,
  CopyRegistry,
  CopyResolution,
  CopyResolver,
  CopyValue,
} from "./types.js";
import { validateCopyRegistryShape } from "./schema.js";

export type CopyResolveIssueReason =
  | "invalid-registry"
  | "invalid-ref"
  | "locale-mismatch"
  | "unknown-copy-id"
  | "copy-not-approved"
  | "missing-placeholder-value"
  | "unexpected-placeholder-value";

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
 * Resolves a `CopyRef` against one locale-specific registry. Any absence,
 * lifecycle failure, locale mismatch, or placeholder mismatch produces no
 * text and a non-complete result. Consumers may log `issues`; renderers must
 * treat a missing `resolution` as an unresolved required input.
 */
export function resolveCopyRef(registry: CopyRegistry | unknown, ref: CopyRef | unknown): CopyResolveResult {
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

  return {
    resolution: {
      ref: validRef as unknown as CopyRef,
      text: interpolate(entry.text, values as Readonly<Record<string, CopyValue>>),
      recordId: validRegistry.id,
      revision: validRegistry.revision,
      locale: validRegistry.locale,
      source: validRegistry.source,
      entryId: entry.id,
    },
    issues: [],
    complete: true,
  };
}

/** Creates the narrow resolver callback for presentation code. */
export function createCopyResolver(registry: CopyRegistry | unknown): CopyResolver {
  return (ref) => resolveCopyRef(registry, ref).resolution;
}
