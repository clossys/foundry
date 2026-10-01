/**
 * The option handling and per-field resolution shared by the two reserved
 * copy kinds that resolve literal text from a `CopyRegistry`: the site
 * identity (`site-identity.ts`) and the messaging kit (`messaging-kit.ts`).
 *
 * Both asked the same two questions of every field — are the options
 * well-formed, and does `resolveCopyRef` return literal, non-blank text —
 * and used to answer them with two copies of the same code. They differ only
 * in the words of their messages and in the names of their two own reasons,
 * which the caller passes in as `FieldLabels`.
 *
 * Internal: not exported from the package index.
 */

import { resolveCopyRef } from "./resolve.js";
import type { CopyResolveIssue, CopyResolveIssueReason, CopyResolveOptions } from "./resolve.js";
import type { CopyRegistry, CopyRegistryEntry, CopyResolution } from "./types.js";

export type PreparedOptions =
  | { ok: true; locale: string | undefined; resolveOptions: CopyResolveOptions }
  | { ok: false };

/** The words and reasons a caller contributes to the shared resolution. */
export interface FieldLabels<Reason extends string> {
  /** Subject of the "options are malformed" message, e.g. `"Site identity"`. */
  optionsSubject: string;
  /** Subject of an entry's messages, e.g. `Site identity "site.name"`. */
  entrySubject: (id: string) => string;
  /** Reason reported when an entry declares placeholders or its text would be rewritten. */
  placeholderReason: Reason;
  /** Reason reported when the resolved text is blank after trimming. */
  blankReason: Reason;
}

/** One reason a field could not be resolved, tagged with the caller's field name. */
export interface FieldIssue<Field extends string, Reason extends string> extends Omit<CopyResolveIssue, "reason"> {
  reason: CopyResolveIssueReason | Reason;
  field: Field;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Splits `locale` (a ref field) from the options `resolveCopyRef` reads.
 * `resolveCopyRef` only looks at `target`, `acceptDelegateInProduction`
 * and `now`, so only those are forwarded; each property is read once.
 * When `now` is absent it is fixed here once, so every field is judged
 * against the same instant. The forwarded values are not validated here —
 * `resolveCopyRef` still does that, and refuses a malformed one.
 */
export function prepareOptions(options: unknown): PreparedOptions {
  if (options === undefined) return { ok: true, locale: undefined, resolveOptions: { now: new Date() } };
  if (!isPlainObject(options)) return { ok: false };
  try {
    const { locale, target, acceptDelegateInProduction, now } = options;
    if (locale !== undefined && (typeof locale !== "string" || locale.trim().length === 0)) return { ok: false };
    const resolveOptions: Record<string, unknown> = { now: now === undefined ? new Date() : now };
    if (target !== undefined) resolveOptions.target = target;
    if (acceptDelegateInProduction !== undefined) resolveOptions.acceptDelegateInProduction = acceptDelegateInProduction;
    return { ok: true, locale, resolveOptions: resolveOptions as CopyResolveOptions };
  } catch {
    return { ok: false };
  }
}

/**
 * Resolves one reserved id as literal text. Every `resolveCopyRef` refusal is
 * kept with its own reason, except that the placeholder-value reasons surface
 * as `labels.placeholderReason`, once per field. Text that is blank after
 * trimming, or an entry that declares placeholders or whose text the
 * resolver would rewrite, is refused too. Never throws.
 */
export function resolveField<Field extends string, Reason extends string>(
  registry: unknown,
  field: Field,
  id: string,
  prepared: PreparedOptions,
  labels: FieldLabels<Reason>,
): { resolution?: CopyResolution; issues: FieldIssue<Field, Reason>[] } {
  const subject = labels.entrySubject(id);
  if (!prepared.ok) {
    return { issues: [{ reason: "invalid-options", field, id, message: `${labels.optionsSubject} options are malformed.` }] };
  }
  try {
    const ref = prepared.locale === undefined ? { id } : { id, locale: prepared.locale };
    const result = resolveCopyRef(registry, ref, prepared.resolveOptions);
    if (!result.complete || !result.resolution) {
      const issues: FieldIssue<Field, Reason>[] = [];
      let placeholderReported = false;
      for (const issue of result.issues) {
        if (issue.reason === "missing-placeholder-value" || issue.reason === "unexpected-placeholder-value") {
          if (placeholderReported) continue;
          placeholderReported = true;
          issues.push({
            reason: labels.placeholderReason,
            field,
            id,
            message: `${subject} must be literal text; an entry that declares placeholders cannot be used.`,
          });
        } else {
          issues.push({ ...issue, field });
        }
      }
      if (issues.length === 0) {
        issues.push({ reason: "invalid-registry", field, id, message: `${subject} could not be resolved.` });
      }
      return { issues };
    }

    const resolution = result.resolution;
    if (resolution.text.trim().length === 0) {
      return { issues: [{ reason: labels.blankReason, field, id, message: `${subject} resolved to blank text.` }] };
    }
    // The registry validated (resolution completed), so `entries` is a real array.
    const entry = (registry as CopyRegistry).entries.find((candidate: CopyRegistryEntry) => candidate.id === id);
    if (entry && ((entry.placeholders?.length ?? 0) > 0 || entry.text !== resolution.text)) {
      return {
        issues: [
          {
            reason: labels.placeholderReason,
            field,
            id,
            message: `${subject} must be literal text; its entry declares placeholders or contains text the resolver would rewrite.`,
          },
        ],
      };
    }
    return { resolution, issues: [] };
  } catch {
    return { issues: [{ reason: "invalid-registry", field, id, message: `${subject} could not be resolved.` }] };
  }
}
