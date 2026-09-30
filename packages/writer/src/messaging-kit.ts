/**
 * The messaging-kit copy kind: a pitch and a boilerplate, each in three
 * lengths, resolved from a `CopyRegistry` under six reserved entry ids.
 *
 * A consumer reuses the same "about us" text in press, footers and email,
 * and needs it to carry the same approval evidence as any other rendered
 * copy. This module is a reserved copy kind, not a second text store or a
 * second approval path: it asks `resolveCopyRef` for each id, so everything
 * that resolver refuses is refused here for the same reason.
 *
 * Invariants:
 *
 * - K1: every `resolveCopyRef` refusal is reported with its own reason,
 *   tagged with the field it belongs to.
 * - K2: `"messaging-placeholder"` when an entry declares placeholders or its
 *   text is one the resolver would rewrite; `"messaging-blank"` when the
 *   resolved text is empty after trimming. These are literal texts, not
 *   templates.
 * - K3: `"messaging-ladder-order"` when `countCopyWords` does not strictly
 *   increase within a ladder (pitch: one-liner, elevator, paragraph; then
 *   boilerplate: short, medium, long). It is reported on the later field,
 *   and only between two fields that both resolved.
 * - K4: all six are attempted on every call. `kit` and `resolutions` exist
 *   only when `issues` is empty, so there is no partial kit. `options.now`
 *   is fixed once per call. Nothing here throws for any input.
 * - K5: no word targets beyond K3. An FAQ and a tagline are out of scope
 *   (`site.tagline` is already a reserved site-identity id).
 *
 * No real copy ships here. The ids are reserved names; the words are the
 * consumer's own.
 */

import { resolveCopyRef } from "./resolve.js";
import type { CopyResolveIssue, CopyResolveIssueReason, CopyResolveOptions } from "./resolve.js";
import { countCopyWords } from "./treatment-word-budget.js";
import type { CopyRegistry, CopyRegistryEntry, CopyResolution } from "./types.js";

/** Reserved copy id for the shortest pitch. */
export const MESSAGING_PITCH_ONE_LINER_COPY_ID = "messaging.pitch.one-liner";

/** Reserved copy id for the elevator pitch. */
export const MESSAGING_PITCH_ELEVATOR_COPY_ID = "messaging.pitch.elevator";

/** Reserved copy id for the paragraph-length pitch. */
export const MESSAGING_PITCH_PARAGRAPH_COPY_ID = "messaging.pitch.paragraph";

/** Reserved copy id for the short boilerplate. */
export const MESSAGING_BOILERPLATE_SHORT_COPY_ID = "messaging.boilerplate.short";

/** Reserved copy id for the medium boilerplate. */
export const MESSAGING_BOILERPLATE_MEDIUM_COPY_ID = "messaging.boilerplate.medium";

/** Reserved copy id for the long boilerplate. */
export const MESSAGING_BOILERPLATE_LONG_COPY_ID = "messaging.boilerplate.long";

/** All six reserved messaging-kit copy ids: the pitch ladder, then the boilerplate ladder. */
export const MESSAGING_KIT_COPY_IDS = [
  MESSAGING_PITCH_ONE_LINER_COPY_ID,
  MESSAGING_PITCH_ELEVATOR_COPY_ID,
  MESSAGING_PITCH_PARAGRAPH_COPY_ID,
  MESSAGING_BOILERPLATE_SHORT_COPY_ID,
  MESSAGING_BOILERPLATE_MEDIUM_COPY_ID,
  MESSAGING_BOILERPLATE_LONG_COPY_ID,
] as const;

/** Which entry of the kit an issue is about. */
export type MessagingKitField =
  | "pitch.oneLiner"
  | "pitch.elevator"
  | "pitch.paragraph"
  | "boilerplate.short"
  | "boilerplate.medium"
  | "boilerplate.long";

/**
 * Every reason `resolveMessagingKit` can report: whatever `resolveCopyRef`
 * refuses, plus the three refusals specific to the kit.
 */
export type MessagingKitIssueReason =
  | CopyResolveIssueReason
  | "messaging-blank"
  | "messaging-placeholder"
  | "messaging-ladder-order";

/** One reason the kit could not be resolved, tagged with its field. */
export interface MessagingKitIssue extends Omit<CopyResolveIssue, "reason"> {
  reason: MessagingKitIssueReason;
  field: MessagingKitField;
}

/** The resolved text of the kit, by ladder. */
export interface MessagingKit {
  pitch: { oneLiner: string; elevator: string; paragraph: string };
  boilerplate: { short: string; medium: string; long: string };
}

/** Each entry's `CopyResolution`, shaped like `MessagingKit`. */
export interface MessagingKitResolutions {
  pitch: { oneLiner: CopyResolution; elevator: CopyResolution; paragraph: CopyResolution };
  boilerplate: { short: CopyResolution; medium: CopyResolution; long: CopyResolution };
}

/**
 * The outcome of `resolveMessagingKit`. `kit` and `resolutions` are present
 * only when `complete` is `true`; `issues` is empty exactly then.
 */
export interface MessagingKitResolution {
  complete: boolean;
  kit?: MessagingKit;
  resolutions?: MessagingKitResolutions;
  issues: MessagingKitIssue[];
}

/** `CopyResolveOptions` plus the requested locale, which is a ref field for the underlying resolver. */
export type MessagingKitOptions = CopyResolveOptions & { locale?: string };

const FIELDS: readonly { field: MessagingKitField; id: string; ladder: "pitch" | "boilerplate" }[] = [
  { field: "pitch.oneLiner", id: MESSAGING_KIT_COPY_IDS[0], ladder: "pitch" },
  { field: "pitch.elevator", id: MESSAGING_KIT_COPY_IDS[1], ladder: "pitch" },
  { field: "pitch.paragraph", id: MESSAGING_KIT_COPY_IDS[2], ladder: "pitch" },
  { field: "boilerplate.short", id: MESSAGING_KIT_COPY_IDS[3], ladder: "boilerplate" },
  { field: "boilerplate.medium", id: MESSAGING_KIT_COPY_IDS[4], ladder: "boilerplate" },
  { field: "boilerplate.long", id: MESSAGING_KIT_COPY_IDS[5], ladder: "boilerplate" },
];

type PreparedOptions =
  | { ok: true; locale: string | undefined; resolveOptions: CopyResolveOptions }
  | { ok: false };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Splits `locale` (a ref field) from the options `resolveCopyRef` reads.
 * Only `target`, `acceptDelegateInProduction` and `now` are forwarded; each
 * property is read once. When `now` is absent it is fixed here once, so all
 * six fields are judged against the same instant. The forwarded values are
 * not validated here — `resolveCopyRef` still does that.
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
  field: MessagingKitField,
  id: string,
  prepared: PreparedOptions,
): { resolution?: CopyResolution; issues: MessagingKitIssue[] } {
  if (!prepared.ok) {
    return { issues: [{ reason: "invalid-options", field, id, message: "Messaging kit options are malformed." }] };
  }
  try {
    const ref = prepared.locale === undefined ? { id } : { id, locale: prepared.locale };
    const result = resolveCopyRef(registry, ref, prepared.resolveOptions);
    if (!result.complete || !result.resolution) {
      const issues: MessagingKitIssue[] = [];
      let placeholderReported = false;
      for (const issue of result.issues) {
        if (issue.reason === "missing-placeholder-value" || issue.reason === "unexpected-placeholder-value") {
          if (placeholderReported) continue;
          placeholderReported = true;
          issues.push({
            reason: "messaging-placeholder",
            field,
            id,
            message: `Messaging kit entry "${id}" must be literal text; an entry that declares placeholders cannot be used.`,
          });
        } else {
          issues.push({ ...issue, field });
        }
      }
      if (issues.length === 0) {
        issues.push({ reason: "invalid-registry", field, id, message: `Messaging kit entry "${id}" could not be resolved.` });
      }
      return { issues };
    }

    const resolution = result.resolution;
    if (resolution.text.trim().length === 0) {
      return { issues: [{ reason: "messaging-blank", field, id, message: `Messaging kit entry "${id}" resolved to blank text.` }] };
    }
    // The registry validated (resolution completed), so `entries` is a real array.
    const entry = (registry as CopyRegistry).entries.find((candidate: CopyRegistryEntry) => candidate.id === id);
    if (entry && ((entry.placeholders?.length ?? 0) > 0 || entry.text !== resolution.text)) {
      return {
        issues: [
          {
            reason: "messaging-placeholder",
            field,
            id,
            message: `Messaging kit entry "${id}" must be literal text; its entry declares placeholders or contains text the resolver would rewrite.`,
          },
        ],
      };
    }
    return { resolution, issues: [] };
  } catch {
    return { issues: [{ reason: "invalid-registry", field, id, message: `Messaging kit entry "${id}" could not be resolved.` }] };
  }
}

/**
 * Resolves the messaging kit from `registry`, under the six ids in
 * `MESSAGING_KIT_COPY_IDS`. All six are attempted on every call and every
 * issue is reported in id order, tagged with its `field`; `kit` and
 * `resolutions` are returned only when there are no issues.
 *
 * `options` are `resolveCopyRef`'s (`target`, `acceptDelegateInProduction`,
 * `now`) plus an optional `locale`, which is forwarded as the ref's locale
 * rather than as an option. Malformed options produce an `"invalid-options"`
 * issue per field. Pure apart from the clock read that `now` defaults to;
 * the registry is not modified and no input makes this throw.
 */
export function resolveMessagingKit(
  registry: CopyRegistry | unknown,
  options?: MessagingKitOptions | unknown,
): MessagingKitResolution {
  const prepared = prepareOptions(options);
  const issues: MessagingKitIssue[] = [];
  const resolved: CopyResolution[] = [];
  const words: (number | undefined)[] = [];
  FIELDS.forEach(({ field, id, ladder }, index) => {
    const outcome = resolveField(registry, field, id, prepared);
    issues.push(...outcome.issues);
    const resolution = outcome.resolution;
    if (resolution) resolved[index] = resolution;
    words[index] = resolution ? countCopyWords(resolution.text) : undefined;

    const previous = index - 1;
    const before = previous >= 0 && FIELDS[previous]!.ladder === ladder ? words[previous] : undefined;
    const current = words[index];
    if (before !== undefined && current !== undefined && !(current > before)) {
      issues.push({
        reason: "messaging-ladder-order",
        field,
        id,
        message: `Messaging kit entry "${id}" has ${current} words, which is not more than the ${before} of "${FIELDS[previous]!.id}".`,
      });
    }
  });

  if (issues.length > 0 || resolved.length !== FIELDS.length) return { complete: false, issues };
  const [oneLiner, elevator, paragraph, short, medium, long] = resolved as [
    CopyResolution,
    CopyResolution,
    CopyResolution,
    CopyResolution,
    CopyResolution,
    CopyResolution,
  ];
  return {
    complete: true,
    kit: {
      pitch: { oneLiner: oneLiner.text, elevator: elevator.text, paragraph: paragraph.text },
      boilerplate: { short: short.text, medium: medium.text, long: long.text },
    },
    resolutions: {
      pitch: { oneLiner, elevator, paragraph },
      boilerplate: { short, medium, long },
    },
    issues: [],
  };
}
