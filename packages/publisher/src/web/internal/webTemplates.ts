/**
 * The registry `renderWebDocument` uses to answer "what does
 * `SurfaceDocument.template` actually name, and what slots does it have?"
 *
 * A surface template is a plain string so the canonical contract remains
 * data-only. This file owns the real slot shapes for the generic web views
 * this package ships (`AuthView`, `ErrorView`, `MarketingView`) — see
 * `BUILTIN_WEB_TEMPLATES` below — plus the shared helpers a
 * caller-registered template (built via `defineWebTemplate`, in the
 * sibling `defineWebTemplate.ts`) and the module-level sugar renderer both
 * need. Canonical callers resolve a `SurfaceDocument` before rendering;
 * the renderer-compatible `ComposeDocument` only exists as that internal
 * compatibility lowering.
 *
 * Every template uses `FlowLayoutSpec`: flowed slots express only their key,
 * optional requiredness, and optional style. A web page has no canvas, so it
 * must never invent a `Frame` or an `ElementKind` merely to satisfy the
 * resolver.
 *
 * REPEATING SLOTS LIVE OUTSIDE `flow` — SEE `repeatingSlots` BELOW
 * -------------------------------------------------------------------
 * `resolveSurfaceDocument` never lowers a `SurfaceRepeatingSlotBinding`
 * into `ComposeDocument.bindings` — it can't: `SlotBinding` has no way to
 * carry more than one source per slot (see that file's own doc comment).
 * A repeating slot's resolved content instead arrives at
 * `renderWebDocument` as `RenderWebOptions.groups`, entirely separate from
 * `doc.bindings`. So a repeating slot's key must never appear in
 * `flow.slots` — `resolveDocument` would report it `missingRequired`
 * (there is never a matching binding) even when the caller genuinely
 * authored it as a repeating group. `repeatingSlots` is this registry's
 * own parallel list of the slot keys a template expects to receive via
 * `groups` instead, each with its own independent `required` flag that
 * `renderWebDocument` checks against `options.groups` directly — see that
 * file's own doc comment for the exact fail-closed rule (and, symmetric
 * with `SurfaceRepeatingSlotBinding.items` itself, why a required
 * repeating slot with zero resolved items is NOT a failure — only a
 * repeating slot missing entirely is).
 */

import type { ReactNode } from "react";
import { createElement } from "react";
import { RenderError } from "../../internal/errors.js";
import { AuthView, ErrorView, MarketingView } from "#publisher-web-views";
import type { MarketingFaqItem, MarketingFeatureItem } from "../views/index.js";
import type { ResolvedWebGroupItem, WebSlotContentKind, WebTemplate } from "../types.js";

export type { RepeatingWebSlotSpec, ResolvedWebGroupItem, WebTemplate } from "../types.js";

/**
 * The two content sources every flowed web slot has always accepted —
 * `AuthView`/`ErrorView`/`MarketingView` never declare `slotKinds` at all,
 * so every one of their slots falls back to this default. See
 * `WebSlotContentKind`'s own doc comment (`../types.ts`) for the full
 * three-member vocabulary this is a subset of.
 */
export const DEFAULT_WEB_SLOT_KINDS: readonly WebSlotContentKind[] = ["copy", "asset"];

/** The content kinds `template` declares slot `key` may be filled with — `template.slotKinds[key]` when present, else `DEFAULT_WEB_SLOT_KINDS`. */
export function slotKindsFor(template: WebTemplate, key: string): readonly WebSlotContentKind[] {
  return template.slotKinds?.[key] ?? DEFAULT_WEB_SLOT_KINDS;
}

/** Every flowed slot key `template` declares `"node"`-kind, in `flow.slots` order — the set `resolveSurfaceDocument`'s own `nodeSlots` option should be built from for this template (see `core/resolve-surface.ts`). */
export function nodeSlotKeys(template: WebTemplate): string[] {
  return template.flow.slots.filter((slot) => slotKindsFor(template, slot.key).includes("node")).map((slot) => slot.key);
}

const AUTH_VIEW_TEMPLATE: WebTemplate = {
  name: "AuthView",
  flow: {
    slots: [
      { key: "brand" },
      { key: "heading", required: true },
      { key: "description" },
      { key: "form", required: true },
      { key: "secondaryAction" },
      { key: "footnote" },
    ],
  },
  // AuthView's `heading`/`form` props are required (non-optional keys) even
  // though their VALUE type, ReactNode, already includes `undefined` — so
  // `content.heading`/`content.form` (typed `ReactNode | undefined` under
  // `noUncheckedIndexedAccess`) need no cast to satisfy them. Real
  // undefined-at-runtime for either is impossible by the time `build` runs:
  // `renderWebDocument` refuses to call it unless every required slot
  // resolved to non-empty text first (see that file's own doc comment).
  build: (content) =>
    createElement(AuthView, {
      brand: content.brand,
      heading: content.heading,
      description: content.description,
      form: content.form,
      secondaryAction: content.secondaryAction,
      footnote: content.footnote,
    }),
};

const ERROR_VIEW_TEMPLATE: WebTemplate = {
  name: "ErrorView",
  flow: {
    slots: [
      { key: "status", required: true },
      { key: "title", required: true },
      { key: "description" },
      { key: "action" },
      { key: "details" },
      { key: "detailsLabel" },
    ],
  },
  build: (content) =>
    createElement(ErrorView, {
      status: content.status,
      title: content.title,
      description: content.description,
      action: content.action,
      details: content.details,
      detailsLabel: content.detailsLabel,
    }),
};

/**
 * Picks the one resolved value a `ResolvedWebGroupItem` actually carries
 * (`text`, an asset `element`, or a raw caller-owned `node`, in that
 * order — the three are mutually exclusive by construction, see that
 * type's own doc comment, so the order never matters in practice). Used
 * for `features`, whose items are single-value content — never for `faq`,
 * whose items need the two-field `{ question, answer }` shape checked by
 * `isFaqItemNode` below instead.
 */
function firstResolvedValue(item: ResolvedWebGroupItem): ReactNode | undefined {
  if (item.text !== undefined) return item.text;
  if (item.element !== undefined) return item.element;
  if (item.node !== undefined) return item.node as ReactNode;
  return undefined;
}

/**
 * `true` when `value` is a plain object exposing both `question` and
 * `answer` — the shape a repeating `faq` item's `node` MUST carry. A
 * single repeating-group item resolves to exactly one value (`copy`,
 * `node`, or `assetId` — see `SurfaceSlotBindingItem`'s own doc comment),
 * but one `Faq` entry genuinely needs two independent pieces of copy
 * (`question` and `answer`). `node`'s own doc comment already frames it as
 * "the explicit escape hatch for a caller-owned interactive or rich UI
 * node" — a plain `{ question, answer }` object is exactly that escape
 * hatch used for its stated purpose, the same way `AuthView.form` is a
 * `node`-shaped escape hatch for content plain text cannot carry. A
 * `faq` item authored via `copy`/`assetId` instead (one value, not two)
 * cannot satisfy this shape and is refused — see `MARKETING_VIEW_TEMPLATE`
 * 's own `build`, below.
 */
function isFaqItemNode(value: unknown): value is { question: ReactNode; answer: ReactNode } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.question !== undefined && candidate.answer !== undefined;
}

const MARKETING_VIEW_TEMPLATE: WebTemplate = {
  name: "MarketingView",
  flow: {
    slots: [
      { key: "brand", required: true },
      { key: "heroEyebrow" },
      { key: "heroHeading", required: true },
      { key: "heroDescription" },
      { key: "heroActions" },
      { key: "heroMedia" },
      { key: "featuresHeading" },
      { key: "featuresDescription" },
      { key: "faqHeading" },
      { key: "faqDescription" },
      { key: "ctaHeading", required: true },
      { key: "ctaDescription" },
      { key: "ctaAction" },
      { key: "footerSecondary" },
    ],
  },
  // "features" is required — every marketing page built from this
  // template commits to having a feature grid, even an explicitly empty
  // one (zero items renders cleanly; see MarketingView's own doc comment
  // and this package's README). "faq" is optional — a marketing page with
  // no FAQ section at all is common and legitimate; see the distinction
  // between an ABSENT group (section omitted) and an EMPTY one (section
  // rendered with zero entries) in MarketingView.tsx's own `faq` doc
  // comment.
  repeatingSlots: [
    { key: "features", required: true },
    { key: "faq" },
  ],
  build: (content, groups) => {
    const features: MarketingFeatureItem[] = (groups.features ?? []).map((item) => ({
      id: `feature-${item.index}`,
      heading: firstResolvedValue(item),
    }));

    const faqGroup = groups.faq;
    const faq: MarketingFaqItem[] | undefined =
      faqGroup === undefined
        ? undefined
        : faqGroup.map((item) => {
            if (item.node !== undefined && isFaqItemNode(item.node)) {
              return { id: `faq-${item.index}`, question: item.node.question, answer: item.node.answer };
            }
            throw new RenderError(
              "empty-output",
              `renderWebDocument could not use MarketingView's "faq" repeating slot item ${item.index}: a FAQ entry needs both a question and an answer, which a single copy/assetId value cannot supply. Author that item as a repeating "node" binding shaped { question, answer } instead.`,
            );
          });

    return createElement(MarketingView, {
      brand: content.brand,
      heroEyebrow: content.heroEyebrow,
      heroHeading: content.heroHeading,
      heroDescription: content.heroDescription,
      heroActions: content.heroActions,
      heroMedia: content.heroMedia,
      featuresHeading: content.featuresHeading,
      featuresDescription: content.featuresDescription,
      features,
      faqHeading: content.faqHeading,
      faqDescription: content.faqDescription,
      faq,
      ctaHeading: content.ctaHeading,
      ctaDescription: content.ctaDescription,
      ctaAction: content.ctaAction,
      footerSecondary: content.footerSecondary,
    });
  },
};

/** This package's three shipped web templates, in the fixed order they've always been declared in. Used both to build the module-level sugar registry below, and as `createWebRenderer`'s `includeBuiltins: true` source. */
export const BUILTIN_WEB_TEMPLATES: readonly WebTemplate[] = [AUTH_VIEW_TEMPLATE, ERROR_VIEW_TEMPLATE, MARKETING_VIEW_TEMPLATE];

/**
 * Builds a `name -> WebTemplate` map from `templates`, refusing rather than
 * silently keeping the last one when two entries share a `name` — the
 * single place this check lives, reused by both the module-level built-in
 * registry below (where a collision is structurally impossible, since the
 * three built-in names are fixed and distinct) and `createWebRenderer`
 * (`./createWebRenderer.ts`, where a consumer's own `templates` — plus
 * the built-ins, when `includeBuiltins` is `true` — genuinely can
 * collide). One check, one behavior, everywhere a `WebTemplate[]` becomes
 * a lookup map in this package.
 */
export function buildTemplateMap(templates: readonly WebTemplate[]): ReadonlyMap<string, WebTemplate> {
  const map = new Map<string, WebTemplate>();
  for (const template of templates) {
    if (map.has(template.name)) {
      throw new RenderError(
        "duplicate-template",
        `createWebRenderer refused: template name "${template.name}" is registered more than once. Every WebTemplate.name must be unique within one renderer instance — rename one of the two, or register only one of them.`,
      );
    }
    map.set(template.name, template);
  }
  return map;
}

const WEB_TEMPLATES: ReadonlyMap<string, WebTemplate> = buildTemplateMap(BUILTIN_WEB_TEMPLATES);

/** Every template name this package's module-level web renderer currently knows — `AuthView`, `ErrorView`, `MarketingView`. For a renderer scoped to a consumer's OWN templates, see `createWebRenderer`. */
export function listWebTemplateNames(): string[] {
  return [...WEB_TEMPLATES.keys()];
}

/** The `WebTemplate` registered under `name` on the module-level built-in registry, or `undefined` if `name` names no known template. For a renderer scoped to a consumer's OWN templates, see `createWebRenderer`. */
export function getWebTemplate(name: string): WebTemplate | undefined {
  return WEB_TEMPLATES.get(name);
}

/** The module-level built-in template registry — what the sugar `renderWebDocument`/`listWebTemplateNames`/`getWebTemplate` exports resolve against. Exported for `renderWebDocument.ts` and `createWebRenderer.ts` to share, never mutated after this module first evaluates. */
export function defaultWebTemplateMap(): ReadonlyMap<string, WebTemplate> {
  return WEB_TEMPLATES;
}
