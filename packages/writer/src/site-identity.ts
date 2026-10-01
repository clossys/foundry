/**
 * The site-identity copy kind: a site's name and tagline, resolved from a
 * `CopyRegistry` under two reserved entry ids.
 *
 * A page-metadata consumer needs exactly two short strings — what the site
 * is called and one line about it — and needs them to carry the same
 * approval evidence as any other rendered copy. This module does not add a
 * second approval path for them. It asks `resolveCopyRef` for
 * `"site.name"` and `"site.tagline"`, so whatever that resolver refuses
 * (a draft entry, an approval record that no longer matches its text, an
 * expired delegate approval, a delegate approval on `"production"` without
 * the caller's opt-in, a locale mismatch, an unknown id, an invalid
 * registry or options object) is refused here for the same reason.
 *
 * On top of that resolver this module adds two refusals of its own,
 * because a name and a tagline are literal text rather than templates: an
 * entry that declares placeholders (or whose text the resolver would
 * rewrite), and a resolved text that is blank after trimming.
 *
 * The result is all-or-nothing. Both fields are always attempted so a
 * caller sees every problem at once, but `identity` and `resolutions` are
 * present only when both fields resolved — there is no partial identity.
 * Nothing here throws for any input; malformed input yields a result with
 * `complete: false` and an issue. Nothing here reads a brand-facts record
 * or consumes the result; wiring it into a page-metadata builder is a
 * separate change.
 *
 * No real copy ships here. The ids are reserved names; the words are the
 * consumer's own.
 */

import { resolveCopyRef } from "./resolve.js";
import type { CopyResolveIssue, CopyResolveIssueReason, CopyResolveOptions } from "./resolve.js";
import type { CopyRegistry, CopyRegistryEntry, CopyResolution } from "./types.js";

/** Reserved copy id for the site's name. */
export const SITE_NAME_COPY_ID = "site.name";

/** Reserved copy id for the site's tagline. */
export const SITE_TAGLINE_COPY_ID = "site.tagline";

/** Both reserved site-identity copy ids, name first. */
export const SITE_IDENTITY_COPY_IDS = [SITE_NAME_COPY_ID, SITE_TAGLINE_COPY_ID] as const;

/** Which half of the site identity an issue is about. */
export type SiteIdentityField = "name" | "tagline";

/**
 * Every reason `resolveSiteIdentity` can report: whatever `resolveCopyRef`
 * refuses, plus the two refusals specific to site identity.
 * `"site-identity-blank"` means the resolved text was empty after trimming;
 * `"site-identity-placeholder"` means the entry declares placeholders or
 * its text is one the resolver would rewrite.
 */
export type SiteIdentityIssueReason = CopyResolveIssueReason | "site-identity-blank" | "site-identity-placeholder";

/** One reason a site identity could not be resolved, tagged with its field. */
export interface SiteIdentityIssue extends Omit<CopyResolveIssue, "reason"> {
  reason: SiteIdentityIssueReason;
  field: SiteIdentityField;
}

/**
 * The outcome of `resolveSiteIdentity`. `identity` and `resolutions` are
 * present only when `complete` is `true`; `issues` is empty exactly then.
 */
export interface SiteIdentityResolution {
  complete: boolean;
  identity?: { name: string; tagline: string };
  resolutions?: { name: CopyResolution; tagline: CopyResolution };
  issues: SiteIdentityIssue[];
}

/** `CopyResolveOptions` plus the requested locale, which is a ref field for the underlying resolver. */
export type SiteIdentityOptions = CopyResolveOptions & { locale?: string };

const FIELDS: readonly { field: SiteIdentityField; id: string }[] = [
  { field: "name", id: SITE_NAME_COPY_ID },
  { field: "tagline", id: SITE_TAGLINE_COPY_ID },
];

type PreparedOptions =
  | { ok: true; locale: string | undefined; resolveOptions: CopyResolveOptions }
  | { ok: false };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Splits `locale` (a ref field) from the options `resolveCopyRef` reads.
 * `resolveCopyRef` only looks at `target`, `acceptDelegateInProduction`
 * and `now`, so only those are forwarded; each property is read once.
 * When `now` is absent it is fixed here once, so both fields are judged
 * against the same instant. The forwarded values are not validated here —
 * `resolveCopyRef` still does that, and refuses a malformed one.
 */
function prepareOptions(options: unknown): PreparedOptions {
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

function resolveField(
  registry: unknown,
  field: SiteIdentityField,
  id: string,
  prepared: PreparedOptions,
): { resolution?: CopyResolution; issues: SiteIdentityIssue[] } {
  if (!prepared.ok) {
    return { issues: [{ reason: "invalid-options", field, id, message: "Site identity options are malformed." }] };
  }
  try {
    const ref = prepared.locale === undefined ? { id } : { id, locale: prepared.locale };
    const result = resolveCopyRef(registry, ref, prepared.resolveOptions);
    if (!result.complete || !result.resolution) {
      const issues: SiteIdentityIssue[] = [];
      let placeholderReported = false;
      for (const issue of result.issues) {
        if (issue.reason === "missing-placeholder-value" || issue.reason === "unexpected-placeholder-value") {
          if (placeholderReported) continue;
          placeholderReported = true;
          issues.push({
            reason: "site-identity-placeholder",
            field,
            id,
            message: `Site identity "${id}" must be literal text; an entry that declares placeholders cannot be used.`,
          });
        } else {
          issues.push({ ...issue, field });
        }
      }
      if (issues.length === 0) {
        issues.push({ reason: "invalid-registry", field, id, message: `Site identity "${id}" could not be resolved.` });
      }
      return { issues };
    }

    const resolution = result.resolution;
    if (resolution.text.trim().length === 0) {
      return { issues: [{ reason: "site-identity-blank", field, id, message: `Site identity "${id}" resolved to blank text.` }] };
    }
    // The registry validated (resolution completed), so `entries` is a real array.
    const entry = (registry as CopyRegistry).entries.find((candidate: CopyRegistryEntry) => candidate.id === id);
    if (entry && ((entry.placeholders?.length ?? 0) > 0 || entry.text !== resolution.text)) {
      return {
        issues: [
          {
            reason: "site-identity-placeholder",
            field,
            id,
            message: `Site identity "${id}" must be literal text; its entry declares placeholders or contains text the resolver would rewrite.`,
          },
        ],
      };
    }
    return { resolution, issues: [] };
  } catch {
    return { issues: [{ reason: "invalid-registry", field, id, message: `Site identity "${id}" could not be resolved.` }] };
  }
}

/**
 * Resolves the site's name and tagline from `registry`, under
 * `"site.name"` and `"site.tagline"`. Both are attempted on every call and
 * every issue is reported, tagged with its `field`; `identity` and
 * `resolutions` are returned only when both resolved.
 *
 * `options` are `resolveCopyRef`'s (`target`, `acceptDelegateInProduction`,
 * `now`) plus an optional `locale`, which is forwarded as the ref's locale
 * rather than as an option. Malformed options (including a blank or
 * non-string `locale`) produce an `"invalid-options"` issue per field. Pure
 * apart from the clock read that `now` defaults to; the registry is not
 * modified and no input makes this throw.
 */
export function resolveSiteIdentity(
  registry: CopyRegistry | unknown,
  options?: SiteIdentityOptions | unknown,
): SiteIdentityResolution {
  const prepared = prepareOptions(options);
  const issues: SiteIdentityIssue[] = [];
  const resolved: Partial<Record<SiteIdentityField, CopyResolution>> = {};
  for (const { field, id } of FIELDS) {
    const outcome = resolveField(registry, field, id, prepared);
    issues.push(...outcome.issues);
    if (outcome.resolution) resolved[field] = outcome.resolution;
  }

  const name = resolved.name;
  const tagline = resolved.tagline;
  if (issues.length > 0 || !name || !tagline) return { complete: false, issues };
  return {
    complete: true,
    identity: { name: name.text, tagline: tagline.text },
    resolutions: { name, tagline },
    issues: [],
  };
}
