/**
 * The registry `renderWebDocument` uses to answer "what does
 * `SurfaceDocument.template` actually name, and what slots does it have?"
 *
 * A surface template is a plain string so the canonical contract remains
 * data-only. This registry owns the real slot shapes for the generic web
 * views this package ships (`AuthView`, `ErrorView`, `MarketingView`).
 * Canonical callers resolve a `SurfaceDocument` before rendering; the
 * renderer-compatible `ComposeDocument` only exists as that internal
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
import type { FlowLayoutSpec } from "../../core/index.js";
import { RenderError } from "../../internal/errors.js";
import { AuthView, ErrorView, MarketingView } from "../views/index.js";
import type { MarketingFaqItem, MarketingFeatureItem } from "../views/index.js";

/**
 * One resolved item inside a repeating web slot, already turned into
 * paintable React content by `renderWebDocument` — exactly one of
 * `text`/`element`/`node` is set, mirroring whichever source
 * `resolve-surface.ts`'s `ResolvedSurfaceGroupItem` carried (`value` ->
 * `text`, a resolved `assetId` -> a real `<img>` `element`, a caller-owned
 * `node` -> passed through untouched, exactly like `AuthView.form`'s own
 * "rendered as given" treatment). `index` is the item's ordinal position
 * in authored order — see `resolve-surface.ts`'s own doc comment on why
 * this exists independent of array order.
 */
export interface ResolvedWebGroupItem {
  index: number;
  text?: string;
  element?: ReactNode;
  node?: object;
}

/** One repeating slot key a `WebTemplate` expects to receive via `RenderWebOptions.groups`, and whether that slot must be present (not necessarily non-empty — see this file's own top comment). */
export interface RepeatingWebSlotSpec {
  key: string;
  required?: boolean;
}

/**
 * One template this package knows how to render: `layout` is what gets
 * handed to the compatibility renderer, and `build` turns resolved slot content
 * (plain strings — see `renderWebDocument.ts`'s own doc comment for why
 * only plain text ever reaches a slot) into the real `@vespeneventures/ui`
 * element.
 */
export interface WebTemplate {
  /** The exact `SurfaceDocument.template` string this entry answers to. */
  name: string;
  /** Handed to `resolveDocument(doc, flow)` as-is. */
  flow: FlowLayoutSpec;
  /** The repeating slot keys this template expects — see this file's own top comment. Omitted (or empty) for a template with no repeating content, e.g. `AuthView`/`ErrorView`. */
  repeatingSlots?: RepeatingWebSlotSpec[];
  /**
   * Builds the real element from resolved slot content. Missing optional
   * slots are simply absent keys in `content`. `groups` carries every
   * repeating slot's resolved items, keyed by slot — absent for a
   * template with no `repeatingSlots`, or for an optional repeating slot
   * this document never bound. A `build` function for a template with no
   * repeating slots may ignore the second parameter entirely (every
   * existing `WebTemplate.build` implementation does, and TypeScript
   * permits the shorter arity).
   */
  build: (content: Record<string, ReactNode>, groups: Record<string, ResolvedWebGroupItem[]>) => ReactNode;
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

const WEB_TEMPLATES: ReadonlyMap<string, WebTemplate> = new Map(
  [AUTH_VIEW_TEMPLATE, ERROR_VIEW_TEMPLATE, MARKETING_VIEW_TEMPLATE].map((t) => [t.name, t]),
);

/** Every template name this package's web renderer currently knows — `AuthView`, `ErrorView`, `MarketingView`. */
export function listWebTemplateNames(): string[] {
  return [...WEB_TEMPLATES.keys()];
}

/** The `WebTemplate` registered under `name`, or `undefined` if `name` names no known template. */
export function getWebTemplate(name: string): WebTemplate | undefined {
  return WEB_TEMPLATES.get(name);
}
