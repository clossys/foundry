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
 * Target policy: a draft entry resolves only on explicit `"preview"`.
 * An owner-approved entry resolves on both `"preview"` and
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
  CopyRegistryEntry,
  CopyResolution,
  CopyResolutionApproval,
  CopyResolver,
  CopyValue,
} from "./types.js";
import { validateCopyRegistryShape } from "./schema.js";
import { IntlMessageFormat } from "intl-messageformat";
import { canonicalLocale, fallbackChain } from "./locale.js";
import { parseIcuMessage } from "./icu/parse.js";
import type { IcuParseResult } from "./icu/parse.js";
import type { WriterManifest } from "./model/types.js";
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
  | "invalid-message"
  | "formatting-error"
  | "approval-stale"
  | "approval-expired"
  | "delegate-approval-refused";

/** Which audience a resolution is for — see this file's top doc comment for the policy difference. */
export type CopyResolveTarget = "preview" | "production";

/** Options controlling how strictly `resolveCopyRef`/`createCopyResolver` treat an entry's approval record. */
export interface CopyResolveOptions {
  /** Locale declarations and fallback policy. Omitted: available registries, with the first as default. */
  manifest?: Pick<WriterManifest, "defaultLocale" | "locales" | "fallback">;
  /** Additional locale registries; each available locale must be unique, including the first registry. */
  registries?: readonly CopyRegistry[];
  /** Explicit zone for every date/time argument. Defaults to `"UTC"`. */
  timeZone?: string;
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
  resolution?: CopyResolution & { servedLocale: string; chain: string[] };
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
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean";
}

/** The options a call runs with, each read from the caller's object exactly once. */
interface ResolveSettings {
  target: CopyResolveTarget;
  acceptDelegateInProduction: boolean;
  now: Date;
  approvalPlan: Uint8Array | undefined;
  manifest: CopyResolveOptions["manifest"];
  registries: readonly CopyRegistry[];
  timeZone: string;
}

/**
 * Reads a well-formed `CopyResolveOptions`, or returns null — checked before
 * anything else so a malformed caller-supplied options object fails closed
 * rather than silently falling back to defaults. Each property is read
 * exactly once, into a local that is validated and then used, so a getter
 * cannot answer differently at validation and at use.
 */
function readResolveOptions(value: unknown): ResolveSettings | null {
  if (value === undefined) return {
    target: "production", acceptDelegateInProduction: false, now: new Date(), approvalPlan: undefined,
    manifest: undefined, registries: [], timeZone: "UTC",
  };
  if (!isPlainObject(value)) return null;
  const { target, acceptDelegateInProduction, now, approvalPlan, manifest, registries, timeZone } = value;
  if (manifest !== undefined && !isPlainObject(manifest)) return null;
  if (registries !== undefined && !Array.isArray(registries)) return null;
  if (timeZone !== undefined && !isNonEmptyString(timeZone)) return null;
  try { new Intl.DateTimeFormat("en", { timeZone: timeZone ?? "UTC" }); }
  catch { return null; }
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
    manifest: manifest as CopyResolveOptions["manifest"],
    registries: (registries ?? []) as readonly CopyRegistry[],
    timeZone: (timeZone ?? "UTC") as string,
  };
}

function failure(reason: CopyResolveIssueReason, message: string, id?: string): CopyResolveResult {
  return { issues: [{ reason, message, ...(id === undefined ? {} : { id }) }], complete: false };
}

/**
 * Resolves an approved entry along the shared locale fallback chain. Only an
 * absent registry or entry advances the chain; an existing entry's lifecycle,
 * approval, argument, or formatting failure always stops resolution.
 */
export function resolveCopyRef(
  registry: CopyRegistry | unknown,
  ref: CopyRef | unknown,
  options?: CopyResolveOptions | unknown,
): CopyResolveResult {
  let settings: ResolveSettings | null;
  try { settings = readResolveOptions(options); }
  catch { settings = null; }
  if (settings === null) return failure("invalid-options", "CopyResolveOptions is malformed.");
  const { target, acceptDelegateInProduction, now, approvalPlan, timeZone } = settings;

  // Cache the shared parser result for schema compatibility and the eventual
  // formatter. No message is parsed a second time in a resolution call.
  const parsed = new Map<CopyRegistryEntry, IcuParseResult>();
  const parseEntry = (entry: CopyRegistryEntry): IcuParseResult => {
    let result = parsed.get(entry);
    if (result === undefined) { result = parseIcuMessage(entry.text); parsed.set(entry, result); }
    return result;
  };
  const available = new Map<string, CopyRegistry>();
  let firstLocale: string;
  try {
    const registries = [registry, ...settings.registries];
    for (const candidate of registries) {
      const findings = validateCopyRegistryShape(candidate);
      // The legacy shape validator recognizes only literal {name}. Suppress
      // only that finding at its exact declared index when valid ICU confirms
      // the same argument; every other shape/approval finding still refuses.
      const bridged = new Set<string>();
      if (isPlainObject(candidate) && Array.isArray(candidate.entries)) {
        candidate.entries.forEach((entry: unknown, index: number) => {
          if (!isPlainObject(entry) || typeof entry.text !== "string" || !Array.isArray(entry.placeholders)) return;
          const result = parseEntry(entry as unknown as CopyRegistryEntry);
          if (result.issues.length !== 0 || result.formatjsAst === undefined) return;
          const names = new Set(result.arguments.map((argument) => argument.name));
          entry.placeholders.forEach((name: unknown, placeholderIndex: number) => {
            if (typeof name === "string" && names.has(name)) bridged.add(`entries.${index}.placeholders.${placeholderIndex}`);
          });
        });
      }
      if (findings.some((finding) => finding.rule !== "placeholder-missing-from-text" || finding.path === undefined || !bridged.has(finding.path))) {
        return failure("invalid-registry", "CopyRegistry must pass validateCopyRegistryShape before it can resolve CopyRefs.");
      }
      const valid = candidate as CopyRegistry;
      const locale = canonicalLocale(valid.locale);
      if (locale !== valid.locale) return failure("invalid-registry", "Stored registry locales must be canonical.");
      if (available.has(locale)) return failure("invalid-registry", "Available registry locales must be unique.");
      available.set(locale, valid);
    }
    firstLocale = available.keys().next().value!;
  } catch { return failure("invalid-registry", "CopyRegistry is malformed or has an invalid locale."); }

  let defaultLocale: string;
  try { defaultLocale = canonicalLocale(settings.manifest?.defaultLocale ?? firstLocale); }
  catch { return failure("invalid-options", "The locale manifest has an invalid default locale."); }
  let validRef: { id: string; locale?: string; values?: Readonly<Record<string, unknown>> };
  let requested: string;
  try {
    if (!isPlainObject(ref)) return failure("invalid-ref", "CopyRef must be an object.");
    const { id, locale, values } = ref;
    if (!isNonEmptyString(id) || (locale !== undefined && !isNonEmptyString(locale)) || (values !== undefined && !isPlainObject(values))) {
      return failure("invalid-ref", "CopyRef must have a non-empty id and valid locale and values.");
    }
    const valueSnapshot = values === undefined ? undefined : Object.fromEntries(Object.entries(values));
    validRef = { id, ...(locale === undefined ? {} : { locale }), ...(valueSnapshot === undefined ? {} : { values: valueSnapshot }) } as typeof validRef;
    requested = canonicalLocale(locale ?? defaultLocale);
  } catch { return failure("invalid-ref", "CopyRef has an invalid locale or values."); }

  let chain: string[];
  try {
    const manifest = settings.manifest ?? {
      defaultLocale: firstLocale,
      locales: [...available.keys()].map((tag) => ({ tag, dir: "ltr" as const, state: "active" as const })),
      fallback: {},
    };
    chain = fallbackChain(requested, manifest);
  } catch { return failure("invalid-options", "The locale manifest or fallback policy is malformed."); }

  let validRegistry: CopyRegistry | undefined;
  let entry: CopyRegistryEntry | undefined;
  let servedLocale: string | undefined;
  for (const locale of chain) {
    const candidate = available.get(locale);
    const candidateEntry = candidate?.entries.find((item) => item.id === validRef.id);
    if (candidateEntry !== undefined) { validRegistry = candidate; entry = candidateEntry; servedLocale = locale; break; }
  }
  if (entry === undefined || validRegistry === undefined || servedLocale === undefined) {
    return failure("unknown-copy-id", `CopyRef "${validRef.id}" is absent from the available fallback chain.`, validRef.id);
  }

  if (entry.status !== "approved" && !(target === "preview" && entry.status === "draft")) {
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

  const message = parseEntry(entry);
  if (message.issues.length > 0 || message.formatjsAst === undefined) {
    return failure("invalid-message", `CopyRef "${validRef.id}" has invalid or unsupported ICU syntax.`, validRef.id);
  }
  const values = validRef.values ?? {};
  const issues: CopyResolveIssue[] = [];
  const required = new Set(message.arguments.map((argument) => argument.name));
  const declared = entry.placeholders === undefined ? required : new Set(entry.placeholders);
  if ([...required].some((name) => !declared.has(name)) || [...declared].some((name) => !required.has(name))) {
    return failure("invalid-registry", `CopyRef "${validRef.id}" has placeholder declarations inconsistent with its ICU arguments.`, validRef.id);
  }
  const formatValues: Record<string, string | number> = Object.create(null);
  for (const placeholder of required) {
    const value = Object.hasOwn(values, placeholder) ? values[placeholder] : undefined;
    const argumentsForName = message.arguments.filter((argument) => argument.name === placeholder);
    const needsNumber = argumentsForName.some((argument) => argument.type === "number" || argument.type === "plural" || argument.type === "date");
    if (!isCopyValue(value) || (needsNumber && typeof value !== "number")) {
      issues.push({
        reason: "missing-placeholder-value", id: validRef.id, placeholder,
        message: `CopyRef "${validRef.id}" is missing a valid value for required placeholder "${placeholder}".`,
      });
    } else { formatValues[placeholder] = typeof value === "boolean" ? String(value) : value; }
  }
  for (const name of Object.keys(values)) {
    if (!required.has(name)) issues.push({
      reason: "unexpected-placeholder-value", id: validRef.id, placeholder: name,
      message: `CopyRef "${validRef.id}" supplies "${name}", which is not an argument of that copy entry.`,
    });
  }
  if (issues.length > 0) return { issues, complete: false };

  let text: string;
  try {
    const formatter = new IntlMessageFormat(message.formatjsAst, servedLocale, undefined, {
      ignoreTag: true,
      formatters: {
        getNumberFormat: (locales, options) => new Intl.NumberFormat(locales, options as Intl.NumberFormatOptions),
        getDateTimeFormat: (locales, options) => new Intl.DateTimeFormat(locales, { ...options, timeZone }),
        getPluralRules: (locales, options) => new Intl.PluralRules(locales, options),
      },
    });
    const formatted = formatter.format(formatValues);
    if (typeof formatted !== "string") return failure("formatting-error", `CopyRef "${validRef.id}" did not format as text.`, validRef.id);
    text = formatted;
  } catch { return failure("formatting-error", `CopyRef "${validRef.id}" could not be formatted.`, validRef.id); }

  const resolution: NonNullable<CopyResolveResult["resolution"]> = {
    ref: validRef as unknown as CopyRef,
    text,
    recordId: validRegistry.id,
    revision: validRegistry.revision,
    locale: servedLocale,
    servedLocale,
    chain,
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
