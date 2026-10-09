import { PLACEHOLDER_SENTINEL } from "@clossys/writer";
import type { CopyRef, CopyResolution, CopyResolver } from "@clossys/writer";
import type { ResolvedConsentCopy, ResolvedConsentStatusCopy, ResolvedCopyField } from "./types.js";

/** The Writer references for every consent field. Both leads and every status line are required. */
export interface ConsentCopyRefs {
  title: CopyRef;
  promptLead: CopyRef;
  noticeLead: CopyRef;
  acceptLabel: CopyRef;
  rejectLabel: CopyRef;
  privacyLinkLabel: CopyRef;
  status: {
    memoryOnly: CopyRef;
    withdrawalFailed: CopyRef;
    evidenceUnavailable: CopyRef;
    evidenceConflict: CopyRef;
    storageUnavailable: CopyRef;
    gpcInForce: CopyRef;
  };
}

/** The target the host created its resolver with, derived from its build or deployment. */
export type ConsentCopyTarget = "preview" | "production";

export interface ResolveConsentCopyInput {
  /** Writer's resolver, created by the host with `createCopyResolver(registry, { target, now })`. */
  resolveCopy: CopyResolver;
  /** The same target the resolver was created with. */
  target: ConsentCopyTarget;
  refs: ConsentCopyRefs;
  /** The locale every field must resolve in. */
  locale: string;
}

const TOP_FIELDS = ["title", "promptLead", "noticeLead", "acceptLabel", "rejectLabel", "privacyLinkLabel"] as const;
const STATUS_FIELDS = [
  "memoryOnly",
  "withdrawalFailed",
  "evidenceUnavailable",
  "evidenceConflict",
  "storageUnavailable",
  "gpcInForce",
] as const;

const PREFIX = "resolveConsentCopy";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True only when `process.env.NODE_ENV` is `"production"` at call time. The
 * read goes through `globalThis`, so a runtime with no `process` global
 * reads as not production instead of throwing.
 */
function isProductionBuild(): boolean {
  const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return runtime.process?.env?.NODE_ENV === "production";
}

function refuse(field: string, reason: string): never {
  // The message names the field and the reason only; it never echoes copy text.
  throw new Error(`${PREFIX}: consent copy field "${field}" ${reason}.`);
}

function resolveField(
  field: string,
  ref: unknown,
  resolveCopy: CopyResolver,
  locale: string,
  production: boolean,
): ResolvedCopyField {
  if (!isRecord(ref)) refuse(field, "has no copy reference");
  if (ref.locale !== undefined && ref.locale !== locale) refuse(field, "references a locale other than the one requested");
  const resolution: CopyResolution | undefined = resolveCopy({ ...(ref as unknown as CopyRef), locale });
  if (!isRecord(resolution)) refuse(field, "was not resolved; the resolver returned no approved copy for it");
  const { text, recordId, entryId, revision } = resolution;
  if (typeof text !== "string" || text.trim().length === 0) refuse(field, "resolved to blank text");
  if (text.includes(PLACEHOLDER_SENTINEL)) refuse(field, "resolved to text that contains the placeholder sentinel");
  if (resolution.locale !== locale) refuse(field, "resolved in a locale other than the one requested");
  if (typeof recordId !== "string" || typeof entryId !== "string" || typeof revision !== "string") {
    refuse(field, "resolved without its record, entry and revision");
  }
  if (production) {
    if (resolution.approval?.approvedBy !== "owner") refuse(field, "has no owner approval, which production requires");
    const kind = resolution.source?.kind;
    if (kind !== "consumer" && kind !== "imported") refuse(field, "comes from a generated source, which production refuses");
  }
  return { text, recordId, entryId, revision, locale: resolution.locale };
}

/**
 * Resolves every consent field through the host's Writer resolver, on the
 * server, and returns plain strings with their provenance.
 *
 * Throws an error naming the field, never echoing its text, when the
 * resolver returns nothing for a field (unapproved, stale, expired or
 * out-of-scope copy), when the text is blank or contains the placeholder
 * sentinel, and when the resolution's locale differs from `locale`. Under
 * `target: "production"` every field needs an owner approval and a
 * non-generated source. When `process.env.NODE_ENV` is `"production"` at
 * call time, a declared `"preview"` target throws and the production rules
 * apply to every field.
 */
export function resolveConsentCopy(input: ResolveConsentCopyInput): ResolvedConsentCopy {
  if (!isRecord(input)) throw new Error(`${PREFIX}: expected an input object.`);
  const { resolveCopy, target, refs, locale } = input;
  if (typeof resolveCopy !== "function") throw new Error(`${PREFIX}: resolveCopy must be a Writer copy resolver.`);
  if (target !== "preview" && target !== "production") throw new Error(`${PREFIX}: target must be "preview" or "production".`);
  if (typeof locale !== "string" || locale.trim().length === 0) throw new Error(`${PREFIX}: locale must be a non-empty string.`);
  const productionBuild = isProductionBuild();
  if (productionBuild && target === "preview") {
    throw new Error(`${PREFIX}: target "preview" is refused in a production build; declare "production".`);
  }
  const production = productionBuild || target === "production";
  if (!isRecord(refs)) throw new Error(`${PREFIX}: refs must name every consent copy field.`);
  const statusRefs = refs.status;
  if (!isRecord(statusRefs)) refuse("status", "has no copy references");

  const resolved: Partial<Record<(typeof TOP_FIELDS)[number], ResolvedCopyField>> = {};
  for (const field of TOP_FIELDS) {
    resolved[field] = resolveField(field, refs[field], resolveCopy, locale, production);
  }
  const status: Partial<ResolvedConsentStatusCopy> = {};
  for (const field of STATUS_FIELDS) {
    status[field] = resolveField(`status.${field}`, (statusRefs as Record<string, unknown>)[field], resolveCopy, locale, production);
  }
  return { ...(resolved as Omit<ResolvedConsentCopy, "status">), status: status as ResolvedConsentStatusCopy };
}
