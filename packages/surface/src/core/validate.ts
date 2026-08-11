/**
 * Structural validation for a candidate `ComposeDocument`, hand-rolled in
 * the same plain-type-guard, accumulate-and-keep-going style as
 * `@vespeneventures/strategy`'s `validation.ts`, `@vespeneventures/policy`'s
 * `validate.ts`, and `@vespeneventures/copy`'s `schema.ts` — no schema
 * library, for the same reason all three give: this package's entire job
 * is dependency-free data validation, and a public package four other
 * packages will depend on should not force every one of them onto one
 * schema library's major version for the sake of shape-checking a document.
 *
 * Every check here is a REAL check, not decoration. Two are worth calling
 * out because they are easy to mistake for pedantry:
 *
 *   - **`layout-required`/`layout-forbidden`.** Email cannot do absolute
 *     positioning — every client forces an ordered block stack — and a web
 *     page flows the same way. A `layout` on either is not "extra
 *     information a renderer can ignore"; it is a claim about a coordinate
 *     system that channel does not have, and silently ignoring it would
 *     let a document ship that a print/slides/image renderer could
 *     misread as intentional. See `types.ts`'s `LayoutSpec` doc comment.
 *   - **`frame-out-of-bounds`.** The frozen contract's own text says
 *     "Frames are fractions of the canvas, 0..1" — literally, each of
 *     `x`/`y`/`w`/`h` individually within `[0, 1]`. This file checks that
 *     AND that `x + w <= 1` / `y + h <= 1`, i.e. that the frame actually
 *     fits inside the canvas once placed, not just that each of its four
 *     numbers happens to be in range in isolation (`x: 0.9, w: 0.5` passes
 *     the narrower reading and still runs a slot off the edge of every
 *     renderer's canvas). This is flagged explicitly in this package's
 *     delivery report as a validation-only strengthening, not a change to
 *     the contract's own field shapes — a renderer author who disagrees
 *     should say so before four renderers are built assuming it holds.
 */

import type {
  Channel,
  ChannelMeta,
  ComposeFinding,
  ElementKind,
  Frame,
  LayoutSpec,
  SlotBinding,
  SlotSpec,
  StyleBinding,
} from "./types.js";
import { CHANNELS, ELEMENT_KINDS } from "./types.js";

// --------------------------------------------------------------- helpers

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Stricter than `isNonEmptyString`: also rejects a string that is
 * non-empty but entirely whitespace (`"   "`, `"\n\t"`). Used only for
 * `SlotBinding.value` (see `binding-value-shape` below) — a whitespace-only
 * `value` satisfies `isNonEmptyString` (`.length > 0`) but is not real
 * copy: it renders as blank text while looking, to `isNonEmptyString`
 * alone, exactly like a real one-word value. This is the gap issue #43
 * was filed against for `resolveDocument`; the same gap existed here, one
 * layer up, in the validator `resolveDocument` is being taught to reuse.
 */
function isNonEmptyNonWhitespaceString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOneOf<T extends string | number>(value: unknown, list: readonly T[]): value is T {
  return (list as readonly unknown[]).includes(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A short, readable description of an arbitrary value for an error message — mirrors `@vespeneventures/strategy`'s `validation.ts`'s `describeValue`. */
function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return `an array (${value.length} item(s))`;
  const t = typeof value;
  if (t === "object") return "an object";
  if (t === "string") return JSON.stringify(value);
  return String(value);
}

const CHANNELS_REQUIRING_LAYOUT: readonly Channel[] = ["print", "slides", "image"];
const CHANNELS_FORBIDDING_LAYOUT: readonly Channel[] = ["web", "email"];

const TWITTER_CARDS = ["summary", "summary_large_image"] as const;
const PAGE_SIZES = ["A4", "Letter", "Custom"] as const;
const ORIENTATIONS = ["portrait", "landscape"] as const;
const ASPECTS = ["16:9", "4:3"] as const;
const IMAGE_FORMATS = ["png", "jpeg", "webp", "svg"] as const;
const IMAGE_SCALES = [1, 2] as const;
const ALIGNS = ["start", "center", "end"] as const;
const V_ALIGNS = ["top", "middle", "bottom"] as const;
const EMAIL_PREHEADER_MAX_LENGTH = 140;

// --------------------------------------------------------------- StyleBinding

// Rule: style-binding-shape, style-binding-field-shape
function validateStyleBindingShape(value: unknown, path: string): ComposeFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "style-binding-shape", severity: "error", message: `${path} must be an object.`, path }];
  }
  const findings: ComposeFinding[] = [];
  const fields: Array<keyof StyleBinding> = ["typography", "color", "background", "border", "weight"];
  for (const key of fields) {
    const v = value[key];
    if (v !== undefined && !isNonEmptyString(v)) {
      findings.push({
        rule: "style-binding-field-shape",
        severity: "error",
        message: `${path}.${key} must be a non-empty string (a token role name) when present, got ${describe(v)}.`,
        path: `${path}.${key}`,
      });
    }
  }
  return findings;
}

// --------------------------------------------------------------- Frame

// Rule: frame-shape, frame-field-shape, frame-field-range, frame-zero-area, frame-out-of-bounds
function validateFrameShape(value: unknown, path: string): ComposeFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "frame-shape", severity: "error", message: `${path} must be an object.`, path }];
  }

  // Snapshot every field once — mirrors @vespeneventures/policy's
  // validateBindingShape and @vespeneventures/copy's schema.ts, both of
  // which document why: a hostile or badly-behaved `value` (a getter, a
  // Proxy) could otherwise return a different result on each read.
  const x = value.x;
  const y = value.y;
  const w = value.w;
  const h = value.h;

  const findings: ComposeFinding[] = [];
  const fields: Array<["x" | "y" | "w" | "h", unknown]> = [
    ["x", x],
    ["y", y],
    ["w", w],
    ["h", h],
  ];

  let allNumeric = true;
  for (const [name, v] of fields) {
    if (!isFiniteNumber(v)) {
      allNumeric = false;
      findings.push({
        rule: "frame-field-shape",
        severity: "error",
        message: `${path}.${name} must be a finite number, got ${describe(v)}.`,
        path: `${path}.${name}`,
      });
    } else if (v < 0 || v > 1) {
      findings.push({
        rule: "frame-field-range",
        severity: "error",
        message: `${path}.${name} must be within 0..1 (a fraction of the canvas), got ${v}.`,
        path: `${path}.${name}`,
      });
    }
  }

  // Only checkable once every field is individually a finite number — see
  // this file's own reasoning above for why area and bounds are checked
  // separately from, and in addition to, per-field range.
  if (allNumeric) {
    const xN = x as number;
    const yN = y as number;
    const wN = w as number;
    const hN = h as number;

    if (wN * hN <= 0) {
      findings.push({
        rule: "frame-zero-area",
        severity: "error",
        message: `${path} must have nonzero area (w * h > 0), got w=${wN}, h=${hN}.`,
        path,
      });
    }
    if (xN + wN > 1) {
      findings.push({
        rule: "frame-out-of-bounds",
        severity: "error",
        message: `${path}.x + ${path}.w must not exceed 1 (the frame must fit within the canvas), got x=${xN}, w=${wN}, x+w=${xN + wN}.`,
        path,
      });
    }
    if (yN + hN > 1) {
      findings.push({
        rule: "frame-out-of-bounds",
        severity: "error",
        message: `${path}.y + ${path}.h must not exceed 1 (the frame must fit within the canvas), got y=${yN}, h=${hN}, y+h=${yN + hN}.`,
        path,
      });
    }
  }

  return findings;
}

// --------------------------------------------------------------- SlotBinding

/**
 * Rule: binding-shape, binding-slot-shape, binding-source-exclusive,
 * binding-copy-id-shape, binding-value-shape, binding-asset-id-shape.
 *
 * Exported (not just used internally by `validateComposeDocument`)
 * because `resolve.ts`'s `resolveDocument` reuses this exact function to
 * check the shape of each binding it is about to resolve — see its own
 * doc comment and issue #43. `resolveDocument` deliberately does not
 * hand-roll a second, drifting copy of "exactly one of copyId/value/
 * assetId, whichever is present non-empty" — this is the one place that
 * rule lives.
 *
 * `binding-source-exclusive` — EXACTLY ONE OF THREE, as of 0.3.0.
 * -----------------------------------------------------------------
 * Before 0.3.0 this was exactly-one-of-two (`copyId`/`value`). Adding
 * `assetId` (`types.ts`'s `SlotBinding.assetId`, the seam into a
 * `@vespeneventures/surface/media` `AssetRecord`) turned it into
 * exactly-one-of-three, which is a strictly harder rule to get right: the
 * "both present" / "neither present" binary check above no longer covers
 * every bad combination once there are three fields, not two, to be
 * present or absent. The full truth table this function is built against
 * (P = present, meaning `!== undefined`; a present-but-empty string still
 * counts as "present" here — emptiness is `binding-copy-id-shape`/
 * `binding-value-shape`/`binding-asset-id-shape`'s job, not this rule's):
 *
 *   copyId  value  assetId  | count | binding-source-exclusive fires?
 *   ------  -----  -------  | ----- | --------------------------------
 *     P       -       -     |   1   | no  (exactly one — copyId)
 *     -       P       -     |   1   | no  (exactly one — value)
 *     -       -       P     |   1   | no  (exactly one — assetId)
 *     P       P       -     |   2   | yes (two present)
 *     P       -       P     |   2   | yes (two present)
 *     -       P       P     |   2   | yes (two present)
 *     P       P       P     |   3   | yes (three present)
 *     -       -       -     |   0   | yes (none present)
 *
 * Implemented by counting how many of the three are present, rather than
 * three separate pairwise comparisons — a pairwise reading (`copyId ===
 * value`, `value === assetId`, ...) is exactly the kind of hand-rolled
 * logic that gets one combination wrong when a third field is added to a
 * rule that was written for two; counting sidesteps that class of bug
 * entirely and reads directly as "the rule this file's own name says it
 * enforces".
 */
export function validateSlotBindingShape(value: unknown, path: string): ComposeFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "binding-shape", severity: "error", message: `${path} must be an object.`, path }];
  }

  const slot = value.slot;
  const copyId = value.copyId;
  const val = value.value;
  const assetId = value.assetId;

  const findings: ComposeFinding[] = [];

  if (!isNonEmptyString(slot)) {
    findings.push({
      rule: "binding-slot-shape",
      severity: "error",
      message: `${path}.slot must be a non-empty string, got ${describe(slot)}.`,
      path: `${path}.slot`,
    });
  }

  const copyIdPresent = copyId !== undefined;
  const valuePresent = val !== undefined;
  const assetIdPresent = assetId !== undefined;
  const presentCount = [copyIdPresent, valuePresent, assetIdPresent].filter(Boolean).length;

  if (presentCount !== 1) {
    findings.push({
      rule: "binding-source-exclusive",
      severity: "error",
      message:
        presentCount === 0
          ? `${path} must set exactly one of copyId/value/assetId, but none are present.`
          : `${path} must set exactly one of copyId/value/assetId, but ${presentCount} are present.`,
      path,
    });
  }

  if (copyIdPresent && !isNonEmptyString(copyId)) {
    findings.push({
      rule: "binding-copy-id-shape",
      severity: "error",
      message: `${path}.copyId must be a non-empty string when present, got ${describe(copyId)}.`,
      path: `${path}.copyId`,
    });
  }

  if (valuePresent && !isNonEmptyNonWhitespaceString(val)) {
    findings.push({
      rule: "binding-value-shape",
      severity: "error",
      message: `${path}.value must be a non-empty, non-whitespace-only string when present, got ${describe(val)}.`,
      path: `${path}.value`,
    });
  }

  if (assetIdPresent && !isNonEmptyString(assetId)) {
    findings.push({
      rule: "binding-asset-id-shape",
      severity: "error",
      message: `${path}.assetId must be a non-empty string when present, got ${describe(assetId)}.`,
      path: `${path}.assetId`,
    });
  }

  return findings;
}

// --------------------------------------------------------------- SlotSpec / LayoutSpec

// Rule: slot-shape, slot-key-shape, slot-element-known, slot-required-shape, slot-align-known, slot-valign-known
function validateSlotSpecShape(value: unknown, path: string): ComposeFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "slot-shape", severity: "error", message: `${path} must be an object.`, path }];
  }

  const key = value.key;
  const element = value.element;
  const frame = value.frame;
  const style = value.style;
  const required = value.required;
  const align = value.align;
  const vAlign = value.vAlign;

  const findings: ComposeFinding[] = [];

  if (!isNonEmptyString(key)) {
    findings.push({
      rule: "slot-key-shape",
      severity: "error",
      message: `${path}.key must be a non-empty string, got ${describe(key)}.`,
      path: `${path}.key`,
    });
  }

  if (!isOneOf<ElementKind>(element, ELEMENT_KINDS)) {
    findings.push({
      rule: "slot-element-known",
      severity: "error",
      message: `${path}.element must be one of ${ELEMENT_KINDS.join(", ")}, got ${describe(element)}.`,
      path: `${path}.element`,
    });
  }

  findings.push(...validateFrameShape(frame, `${path}.frame`));

  if (style !== undefined) {
    findings.push(...validateStyleBindingShape(style, `${path}.style`));
  }

  if (required !== undefined && typeof required !== "boolean") {
    findings.push({
      rule: "slot-required-shape",
      severity: "error",
      message: `${path}.required must be a boolean when present, got ${describe(required)}.`,
      path: `${path}.required`,
    });
  }

  if (align !== undefined && !isOneOf(align, ALIGNS)) {
    findings.push({
      rule: "slot-align-known",
      severity: "error",
      message: `${path}.align must be one of ${ALIGNS.join(", ")} when present, got ${describe(align)}.`,
      path: `${path}.align`,
    });
  }

  if (vAlign !== undefined && !isOneOf(vAlign, V_ALIGNS)) {
    findings.push({
      rule: "slot-valign-known",
      severity: "error",
      message: `${path}.vAlign must be one of ${V_ALIGNS.join(", ")} when present, got ${describe(vAlign)}.`,
      path: `${path}.vAlign`,
    });
  }

  return findings;
}

// Rule: layout-shape, slots-shape, slot-key-unique
function validateLayoutSpecShape(value: unknown, path: string): ComposeFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "layout-shape", severity: "error", message: `${path} must be an object.`, path }];
  }

  const background = value.background;
  const slots = value.slots;

  const findings: ComposeFinding[] = [];

  if (background !== undefined) {
    findings.push(...validateStyleBindingShape(background, `${path}.background`));
  }

  if (!Array.isArray(slots)) {
    findings.push({
      rule: "slots-shape",
      severity: "error",
      message: `${path}.slots must be an array, got ${describe(slots)}.`,
      path: `${path}.slots`,
    });
    return findings;
  }

  slots.forEach((slot, i) => findings.push(...validateSlotSpecShape(slot, `${path}.slots.${i}`)));

  // Uniqueness is a whole-layout property, not a per-slot one — mirrors
  // @vespeneventures/copy's schema.ts id-uniqueness check exactly. Only
  // slots that already passed their own key-shape check contribute a value
  // to compare.
  const seen = new Map<string, number>();
  slots.forEach((slot, i) => {
    if (!isPlainObject(slot)) return;
    const key = slot.key;
    if (typeof key !== "string" || key.length === 0) return;
    const firstIndex = seen.get(key);
    if (firstIndex === undefined) {
      seen.set(key, i);
    } else {
      findings.push({
        rule: "slot-key-unique",
        severity: "error",
        message: `${path}.slots.${i}.key "${key}" duplicates ${path}.slots.${firstIndex}.key — every slot key must be unique within a LayoutSpec.`,
        path: `${path}.slots.${i}.key`,
      });
    }
  });

  return findings;
}

// --------------------------------------------------------------- ChannelMeta

// Rule: web-title-shape, web-description-shape, web-canonical-shape, web-robots-shape,
// web-keywords-shape, web-og-shape, web-og-field-shape, web-twitter-shape,
// web-twitter-card-known, web-twitter-site-shape, web-json-ld-shape
function validateWebMetaShape(meta: Record<string, unknown>, path: string): ComposeFinding[] {
  const findings: ComposeFinding[] = [];

  const title = meta.title;
  const description = meta.description;
  const canonical = meta.canonical;
  const robots = meta.robots;
  const keywords = meta.keywords;
  const og = meta.og;
  const twitter = meta.twitter;
  const jsonLd = meta.jsonLd;

  if (!isNonEmptyString(title)) {
    findings.push({ rule: "web-title-shape", severity: "error", message: `${path}.title must be a non-empty string, got ${describe(title)}.`, path: `${path}.title` });
  }
  if (!isNonEmptyString(description)) {
    findings.push({ rule: "web-description-shape", severity: "error", message: `${path}.description must be a non-empty string, got ${describe(description)}.`, path: `${path}.description` });
  }
  if (canonical !== undefined && !isNonEmptyString(canonical)) {
    findings.push({ rule: "web-canonical-shape", severity: "error", message: `${path}.canonical must be a non-empty string when present, got ${describe(canonical)}.`, path: `${path}.canonical` });
  }
  if (robots !== undefined && !isNonEmptyString(robots)) {
    findings.push({ rule: "web-robots-shape", severity: "error", message: `${path}.robots must be a non-empty string when present, got ${describe(robots)}.`, path: `${path}.robots` });
  }
  if (keywords !== undefined && (!Array.isArray(keywords) || keywords.some((k) => typeof k !== "string" || k.length === 0))) {
    findings.push({ rule: "web-keywords-shape", severity: "error", message: `${path}.keywords must be an array of non-empty strings when present, got ${describe(keywords)}.`, path: `${path}.keywords` });
  }

  if (og !== undefined) {
    if (!isPlainObject(og)) {
      findings.push({ rule: "web-og-shape", severity: "error", message: `${path}.og must be an object when present, got ${describe(og)}.`, path: `${path}.og` });
    } else {
      for (const key of ["title", "description", "image", "type"] as const) {
        const v = og[key];
        if (v !== undefined && !isNonEmptyString(v)) {
          findings.push({ rule: "web-og-field-shape", severity: "error", message: `${path}.og.${key} must be a non-empty string when present, got ${describe(v)}.`, path: `${path}.og.${key}` });
        }
      }
    }
  }

  if (twitter !== undefined) {
    if (!isPlainObject(twitter)) {
      findings.push({ rule: "web-twitter-shape", severity: "error", message: `${path}.twitter must be an object when present, got ${describe(twitter)}.`, path: `${path}.twitter` });
    } else {
      const card = twitter.card;
      if (card !== undefined && !isOneOf(card, TWITTER_CARDS)) {
        findings.push({ rule: "web-twitter-card-known", severity: "error", message: `${path}.twitter.card must be one of ${TWITTER_CARDS.join(", ")} when present, got ${describe(card)}.`, path: `${path}.twitter.card` });
      }
      const site = twitter.site;
      if (site !== undefined && !isNonEmptyString(site)) {
        findings.push({ rule: "web-twitter-site-shape", severity: "error", message: `${path}.twitter.site must be a non-empty string when present, got ${describe(site)}.`, path: `${path}.twitter.site` });
      }
    }
  }

  if (jsonLd !== undefined && (!Array.isArray(jsonLd) || jsonLd.some((entry) => !isPlainObject(entry)))) {
    findings.push({ rule: "web-json-ld-shape", severity: "error", message: `${path}.jsonLd must be an array of objects when present, got ${describe(jsonLd)}.`, path: `${path}.jsonLd` });
  }

  return findings;
}

// Rule: email-subject-shape, email-preheader-shape, email-preheader-length, email-reply-to-shape, email-list-unsubscribe-shape
function validateEmailMetaShape(meta: Record<string, unknown>, path: string): ComposeFinding[] {
  const findings: ComposeFinding[] = [];

  const subject = meta.subject;
  const preheader = meta.preheader;
  const replyTo = meta.replyTo;
  const listUnsubscribe = meta.listUnsubscribe;

  if (!isNonEmptyString(subject)) {
    findings.push({ rule: "email-subject-shape", severity: "error", message: `${path}.subject must be a non-empty string, got ${describe(subject)}.`, path: `${path}.subject` });
  }

  if (!isNonEmptyString(preheader)) {
    findings.push({ rule: "email-preheader-shape", severity: "error", message: `${path}.preheader must be a non-empty string, got ${describe(preheader)}.`, path: `${path}.preheader` });
  } else if (preheader.length > EMAIL_PREHEADER_MAX_LENGTH) {
    findings.push({
      rule: "email-preheader-length",
      severity: "error",
      message: `${path}.preheader must be at most ${EMAIL_PREHEADER_MAX_LENGTH} characters, got ${preheader.length}.`,
      path: `${path}.preheader`,
    });
  }

  if (replyTo !== undefined && !isNonEmptyString(replyTo)) {
    findings.push({ rule: "email-reply-to-shape", severity: "error", message: `${path}.replyTo must be a non-empty string when present, got ${describe(replyTo)}.`, path: `${path}.replyTo` });
  }
  if (listUnsubscribe !== undefined && !isNonEmptyString(listUnsubscribe)) {
    findings.push({ rule: "email-list-unsubscribe-shape", severity: "error", message: `${path}.listUnsubscribe must be a non-empty string when present, got ${describe(listUnsubscribe)}.`, path: `${path}.listUnsubscribe` });
  }

  return findings;
}

// Rule: print-page-size-known, print-orientation-known, print-margins-shape,
// print-margin-field-shape, print-bleed-shape, print-crop-marks-shape, print-dpi-shape
function validatePrintMetaShape(meta: Record<string, unknown>, path: string): ComposeFinding[] {
  const findings: ComposeFinding[] = [];

  const pageSize = meta.pageSize;
  const orientation = meta.orientation;
  const margins = meta.margins;
  const bleed = meta.bleed;
  const cropMarks = meta.cropMarks;
  const dpi = meta.dpi;

  if (!isOneOf(pageSize, PAGE_SIZES)) {
    findings.push({ rule: "print-page-size-known", severity: "error", message: `${path}.pageSize must be one of ${PAGE_SIZES.join(", ")}, got ${describe(pageSize)}.`, path: `${path}.pageSize` });
  }
  if (!isOneOf(orientation, ORIENTATIONS)) {
    findings.push({ rule: "print-orientation-known", severity: "error", message: `${path}.orientation must be one of ${ORIENTATIONS.join(", ")}, got ${describe(orientation)}.`, path: `${path}.orientation` });
  }

  if (!isPlainObject(margins)) {
    findings.push({ rule: "print-margins-shape", severity: "error", message: `${path}.margins must be an object, got ${describe(margins)}.`, path: `${path}.margins` });
  } else {
    for (const key of ["top", "right", "bottom", "left"] as const) {
      const v = margins[key];
      if (!isNonEmptyString(v)) {
        findings.push({ rule: "print-margin-field-shape", severity: "error", message: `${path}.margins.${key} must be a non-empty string, got ${describe(v)}.`, path: `${path}.margins.${key}` });
      }
    }
  }

  if (bleed !== undefined && !isNonEmptyString(bleed)) {
    findings.push({ rule: "print-bleed-shape", severity: "error", message: `${path}.bleed must be a non-empty string when present, got ${describe(bleed)}.`, path: `${path}.bleed` });
  }
  if (cropMarks !== undefined && typeof cropMarks !== "boolean") {
    findings.push({ rule: "print-crop-marks-shape", severity: "error", message: `${path}.cropMarks must be a boolean when present, got ${describe(cropMarks)}.`, path: `${path}.cropMarks` });
  }
  if (dpi !== undefined && !(isFiniteNumber(dpi) && dpi > 0)) {
    findings.push({ rule: "print-dpi-shape", severity: "error", message: `${path}.dpi must be a positive number when present, got ${describe(dpi)}.`, path: `${path}.dpi` });
  }

  return findings;
}

// Rule: slides-aspect-known, slides-notes-shape
function validateSlidesMetaShape(meta: Record<string, unknown>, path: string): ComposeFinding[] {
  const findings: ComposeFinding[] = [];

  const aspect = meta.aspect;
  const notes = meta.notes;

  if (!isOneOf(aspect, ASPECTS)) {
    findings.push({ rule: "slides-aspect-known", severity: "error", message: `${path}.aspect must be one of ${ASPECTS.join(", ")}, got ${describe(aspect)}.`, path: `${path}.aspect` });
  }

  if (notes !== undefined && (!isPlainObject(notes) || Object.values(notes).some((v) => typeof v !== "string"))) {
    findings.push({ rule: "slides-notes-shape", severity: "error", message: `${path}.notes must be an object of string values when present, got ${describe(notes)}.`, path: `${path}.notes` });
  }

  return findings;
}

// Rule: image-width-positive, image-height-positive, image-format-known, image-scale-known, image-alt-shape
function validateImageMetaShape(meta: Record<string, unknown>, path: string): ComposeFinding[] {
  const findings: ComposeFinding[] = [];

  const width = meta.width;
  const height = meta.height;
  const format = meta.format;
  const scale = meta.scale;
  const alt = meta.alt;

  if (!(isFiniteNumber(width) && width > 0)) {
    findings.push({ rule: "image-width-positive", severity: "error", message: `${path}.width must be a positive number, got ${describe(width)}.`, path: `${path}.width` });
  }
  if (!(isFiniteNumber(height) && height > 0)) {
    findings.push({ rule: "image-height-positive", severity: "error", message: `${path}.height must be a positive number, got ${describe(height)}.`, path: `${path}.height` });
  }
  if (!isOneOf(format, IMAGE_FORMATS)) {
    findings.push({ rule: "image-format-known", severity: "error", message: `${path}.format must be one of ${IMAGE_FORMATS.join(", ")}, got ${describe(format)}.`, path: `${path}.format` });
  }
  if (scale !== undefined && !isOneOf(scale, IMAGE_SCALES)) {
    findings.push({ rule: "image-scale-known", severity: "error", message: `${path}.scale must be 1 or 2 when present, got ${describe(scale)}.`, path: `${path}.scale` });
  }
  if (!isNonEmptyString(alt)) {
    findings.push({ rule: "image-alt-shape", severity: "error", message: `${path}.alt must be a non-empty string, got ${describe(alt)}.`, path: `${path}.alt` });
  }

  return findings;
}

function validateMetaFieldsForChannel(meta: Record<string, unknown>, channel: Channel, path: string): ComposeFinding[] {
  switch (channel) {
    case "web":
      return validateWebMetaShape(meta, path);
    case "email":
      return validateEmailMetaShape(meta, path);
    case "print":
      return validatePrintMetaShape(meta, path);
    case "slides":
      return validateSlidesMetaShape(meta, path);
    case "image":
      return validateImageMetaShape(meta, path);
  }
}

// --------------------------------------------------------------- ComposeDocument

/**
 * Validates that `value` conforms to the `ComposeDocument` shape. Returns a
 * `ComposeFinding[]`; empty means `value` is a well-formed
 * `ComposeDocument`. Never throws — any input, including `null`, a string,
 * or a wildly malformed object, produces findings rather than an
 * exception, the same discipline every sibling validator in this
 * ecosystem holds to.
 *
 * Checks, in full: `id` non-empty; `channel` one of the five known
 * channels; `template` non-empty; `bindings` an array, each entry's own
 * shape (`slot` non-empty, exactly one of `copyId`/`value`/`assetId`,
 * whichever is present non-empty); `meta`'s `channel` field agrees with the document's
 * own `channel` AND `meta`'s own fields match whichever channel `meta`
 * itself claims to be (so a document with a `channel`/`meta.channel`
 * mismatch gets two distinct findings — one for the mismatch, one for
 * whatever `meta`'s actual shape is or isn't — rather than one swallowing
 * the other); `layout` present exactly when `channel` requires it
 * (`print`/`slides`/`image`) and absent exactly when it's forbidden
 * (`web`/`email`), and, when present, every `SlotSpec`'s own shape
 * (`key` non-empty and unique within the layout, `element` a known kind,
 * `frame` within 0..1 with nonzero area and not extending past the
 * canvas — see this file's top comment — `style` fields, when present,
 * non-empty token role names, `required`/`align`/`vAlign` well-formed when
 * present).
 */
export function validateComposeDocument(value: unknown): ComposeFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "document-shape", severity: "error", message: "A compose document must be an object.", path: "$" }];
  }

  // Snapshot every field this function reads off `value`, exactly ONCE,
  // before any check runs — see validateFrameShape's comment above for why.
  const id = value.id;
  const channel = value.channel;
  const meta = value.meta;
  const template = value.template;
  const bindings = value.bindings;
  const layout = value.layout;

  const findings: ComposeFinding[] = [];

  if (!isNonEmptyString(id)) {
    findings.push({ rule: "id-shape", severity: "error", message: `id must be a non-empty string, got ${describe(id)}.`, path: "id" });
  }

  const knownChannel: Channel | undefined = isOneOf<Channel>(channel, CHANNELS) ? channel : undefined;
  if (knownChannel === undefined) {
    findings.push({ rule: "channel-known", severity: "error", message: `channel must be one of ${CHANNELS.join(", ")}, got ${describe(channel)}.`, path: "channel" });
  }

  if (!isNonEmptyString(template)) {
    findings.push({ rule: "template-shape", severity: "error", message: `template must be a non-empty string, got ${describe(template)}.`, path: "template" });
  }

  if (!Array.isArray(bindings)) {
    findings.push({ rule: "bindings-shape", severity: "error", message: `bindings must be an array, got ${describe(bindings)}.`, path: "bindings" });
  } else {
    bindings.forEach((b, i) => findings.push(...validateSlotBindingShape(b, `bindings.${i}`)));
  }

  // meta — the channel/meta discriminant, then the fields for whichever
  // channel meta.channel itself claims (which may differ from the
  // document's own `channel`; both are checked, independently).
  if (!isPlainObject(meta)) {
    findings.push({ rule: "meta-shape", severity: "error", message: `meta must be an object, got ${describe(meta)}.`, path: "meta" });
  } else {
    const metaChannel = meta.channel;

    if (knownChannel !== undefined && metaChannel !== knownChannel) {
      findings.push({
        rule: "meta-channel-mismatch",
        severity: "error",
        message: `meta.channel (${describe(metaChannel)}) must equal channel (${describe(knownChannel)}).`,
        path: "meta.channel",
      });
    }

    if (isOneOf<Channel>(metaChannel, CHANNELS)) {
      findings.push(...validateMetaFieldsForChannel(meta, metaChannel, "meta"));
    } else {
      findings.push({
        rule: "meta-channel-known",
        severity: "error",
        message: `meta.channel must be one of ${CHANNELS.join(", ")}, got ${describe(metaChannel)}.`,
        path: "meta.channel",
      });
    }
  }

  // layout — channel-gated: required for print/slides/image, forbidden for web/email.
  const layoutPresent = layout !== undefined;
  if (knownChannel !== undefined) {
    if (CHANNELS_FORBIDDING_LAYOUT.includes(knownChannel) && layoutPresent) {
      findings.push({
        rule: "layout-forbidden",
        severity: "error",
        message: `layout must be absent for channel "${knownChannel}" — ${knownChannel} is a flowed channel with no absolute positioning.`,
        path: "layout",
      });
    }
    if (CHANNELS_REQUIRING_LAYOUT.includes(knownChannel) && !layoutPresent) {
      findings.push({
        rule: "layout-required",
        severity: "error",
        message: `layout is required for channel "${knownChannel}".`,
        path: "layout",
      });
    }
  }
  if (layoutPresent) {
    findings.push(...validateLayoutSpecShape(layout, "layout"));
  }

  return findings;
}

// --------------------------------------------------------------- SurfaceDocument

function isCopyRef(value: unknown): value is { id: string; locale?: string; values?: Record<string, string | number | boolean> } {
  if (!isPlainObject(value) || !isNonEmptyString(value.id)) return false;
  if (value.locale !== undefined && !isNonEmptyString(value.locale)) return false;
  if (value.values !== undefined) {
    if (!isPlainObject(value.values)) return false;
    if (Object.values(value.values).some((entry) => !["string", "number", "boolean"].includes(typeof entry))) return false;
  }
  return true;
}

function validateCopyRef(value: unknown, path: string, findings: ComposeFinding[]): void {
  if (!isCopyRef(value)) {
    findings.push({ rule: "copy-ref-shape", severity: "error", message: `${path} must be a CopyRef with a non-empty id.`, path });
  }
}

/**
 * Validates the canonical `SurfaceDocument` contract. Unlike the deprecated
 * `ComposeDocument` validator, this rejects literal audience-facing copy:
 * slots, web/email metadata, image alt text, and slide notes must all be
 * addressable `CopyRef`s.
 */
export function validateSurfaceDocument(value: unknown): ComposeFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "surface-document-shape", severity: "error", message: "A surface document must be an object.", path: "$" }];
  }

  const findings: ComposeFinding[] = [];
  const channel = isOneOf<Channel>(value.channel, CHANNELS) ? value.channel : undefined;
  if (!isNonEmptyString(value.id)) findings.push({ rule: "id-shape", severity: "error", message: "id must be a non-empty string.", path: "id" });
  if (channel === undefined) findings.push({ rule: "channel-known", severity: "error", message: `channel must be one of ${CHANNELS.join(", ")}.`, path: "channel" });
  if (!isNonEmptyString(value.template)) findings.push({ rule: "template-shape", severity: "error", message: "template must be a non-empty string.", path: "template" });

  if (!Array.isArray(value.bindings)) {
    findings.push({ rule: "bindings-shape", severity: "error", message: "bindings must be an array.", path: "bindings" });
  } else {
    value.bindings.forEach((binding, index) => {
      const path = `bindings.${index}`;
      if (!isPlainObject(binding)) {
        findings.push({ rule: "binding-shape", severity: "error", message: `${path} must be an object.`, path });
        return;
      }
      if (!isNonEmptyString(binding.slot)) findings.push({ rule: "binding-slot-shape", severity: "error", message: `${path}.slot must be a non-empty string.`, path: `${path}.slot` });
      const sources = [binding.copy !== undefined, binding.node !== undefined, binding.assetId !== undefined];
      if (sources.filter(Boolean).length !== 1) findings.push({ rule: "surface-binding-source-exclusive", severity: "error", message: `${path} must set exactly one of copy/node/assetId.`, path });
      if (binding.copy !== undefined) validateCopyRef(binding.copy, `${path}.copy`, findings);
      if (binding.node !== undefined && (typeof binding.node !== "object" || binding.node === null)) {
        findings.push({ rule: "surface-node-shape", severity: "error", message: `${path}.node must be a non-null object; use copy for audience-facing text.`, path: `${path}.node` });
      }
      if (binding.assetId !== undefined && !isNonEmptyString(binding.assetId)) findings.push({ rule: "binding-asset-id-shape", severity: "error", message: `${path}.assetId must be a non-empty string when present.`, path: `${path}.assetId` });
    });
  }

  if (!isPlainObject(value.meta)) {
    findings.push({ rule: "meta-shape", severity: "error", message: "meta must be an object.", path: "meta" });
  } else if (channel !== undefined) {
    if (value.meta.channel !== channel) findings.push({ rule: "meta-channel-mismatch", severity: "error", message: "meta.channel must equal channel.", path: "meta.channel" });
    if (channel === "web") {
      validateCopyRef(value.meta.title, "meta.title", findings);
      validateCopyRef(value.meta.description, "meta.description", findings);
      if (value.meta.keywords !== undefined) {
        if (!Array.isArray(value.meta.keywords)) findings.push({ rule: "web-keywords-shape", severity: "error", message: "meta.keywords must be a CopyRef array when present.", path: "meta.keywords" });
        else value.meta.keywords.forEach((ref, index) => validateCopyRef(ref, `meta.keywords.${index}`, findings));
      }
      if (value.meta.og !== undefined) {
        if (!isPlainObject(value.meta.og)) findings.push({ rule: "web-og-shape", severity: "error", message: "meta.og must be an object when present.", path: "meta.og" });
        else {
          if (value.meta.og.title !== undefined) validateCopyRef(value.meta.og.title, "meta.og.title", findings);
          if (value.meta.og.description !== undefined) validateCopyRef(value.meta.og.description, "meta.og.description", findings);
        }
      }
    } else if (channel === "email") {
      validateCopyRef(value.meta.subject, "meta.subject", findings);
      validateCopyRef(value.meta.preheader, "meta.preheader", findings);
    } else if (channel === "image") {
      validateCopyRef(value.meta.alt, "meta.alt", findings);
    } else if (channel === "slides" && value.meta.notes !== undefined) {
      if (!isPlainObject(value.meta.notes)) findings.push({ rule: "slides-notes-shape", severity: "error", message: "meta.notes must be a CopyRef map when present.", path: "meta.notes" });
      else Object.entries(value.meta.notes).forEach(([key, ref]) => validateCopyRef(ref, `meta.notes.${key}`, findings));
    }
  }

  const layoutPresent = value.layout !== undefined;
  if (channel === "web" || channel === "email") {
    if (layoutPresent) findings.push({ rule: "layout-forbidden", severity: "error", message: `layout must be absent for flowed channel "${channel}".`, path: "layout" });
  } else if (channel !== undefined && !layoutPresent) {
    findings.push({ rule: "layout-required", severity: "error", message: `layout is required for canvas channel "${channel}".`, path: "layout" });
  }
  if (layoutPresent) findings.push(...validateLayoutSpecShape(value.layout, "layout"));

  return findings;
}
