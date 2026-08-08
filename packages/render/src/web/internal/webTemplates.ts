/**
 * The registry `renderWebDocument` uses to answer "what does
 * `ComposeDocument.template` actually name, and what slots does it have?"
 *
 * `compose` deliberately has no opinion here — `ComposeDocument.template`
 * is a plain string precisely so this package's own README can say "the
 * `template` seam" without `compose` importing `@vespeneventures/ui`. See
 * `@vespeneventures/compose`'s README, "The `template` seam", and its
 * `resolve.ts` doc comment: "a caller resolving one of those [web/email
 * documents] still needs to supply the real slot list its template
 * defines, from wherever that template's own slot shapes live (a
 * `@vespeneventures/ui` view's props, in practice)." This file is exactly
 * that supply, for the two views `@vespeneventures/ui/views` ships today
 * (`AuthView`, `ErrorView`).
 *
 * EVERY TEMPLATE'S SLOT LIST IS A `SlotSpec[]`, ON PURPOSE
 * ----------------------------------------------------------
 * Reusing `compose`'s own `SlotSpec`/`LayoutSpec` shape here — rather than
 * inventing a parallel "web slot" type — is what lets `renderWebDocument`
 * call `resolveDocument` directly and inherit its exact bookkeeping for
 * free: `missingRequired`, `unknownBindings`, and the "`ok` is only true
 * when something actually resolved" rule (see `resolveDocument`'s own doc
 * comment, and `compose`'s README, "The bar"). Two of `SlotSpec`'s fields
 * are genuinely meaningless for a flowed web page and are set to fixed,
 * arbitrary placeholder values purely so the type checks:
 *
 *   - `frame` — a web page has no coordinate system a `Frame` could
 *     describe (see `compose`'s `LayoutSpec` doc comment, "Why `layout` is
 *     channel-gated"). Every slot below uses the full-canvas placeholder
 *     `{ x: 0, y: 0, w: 1, h: 1 }`; `renderWebDocument` never reads it.
 *   - `element` — `ElementKind`'s closed vocabulary was designed for
 *     visually positioned content (print/slides/image), and has no member
 *     for "an arbitrary composed sub-tree" (`AuthView`'s `form` slot).
 *     Each mapping below picks the closest real member and says why in a
 *     comment; `renderWebDocument` never reads this field either — it
 *     exists solely so `resolveDocument`'s `ResolvedSlot.spec` type-checks.
 *
 * Both fields are carried only because `resolveDocument`'s signature asks
 * for a real `SlotSpec`; a future channel with its own slot shape (email,
 * whose blocks stack the same way web's do) is free to build its own
 * placeholder convention rather than copying this one verbatim.
 */

import type { ReactNode } from "react";
import { createElement } from "react";
import type { LayoutSpec, SlotSpec } from "@vespeneventures/compose";
import { AuthView, ErrorView } from "@vespeneventures/ui/views";

/** The full-canvas placeholder every slot below uses for `frame` — see this file's top comment. */
const WEB_FRAME: SlotSpec["frame"] = { x: 0, y: 0, w: 1, h: 1 };

/**
 * One template this package knows how to render: `layout` is what gets
 * handed to `resolveDocument`, and `build` turns the resolved slot content
 * (plain strings — see `renderWebDocument.ts`'s own doc comment for why
 * only plain text ever reaches a slot) into the real `@vespeneventures/ui`
 * element.
 */
export interface WebTemplate {
  /** The exact `ComposeDocument.template` string this entry answers to — a real `@vespeneventures/ui` view export name. */
  name: string;
  /** Handed to `resolveDocument(doc, layout)` as-is. */
  layout: LayoutSpec;
  /** Builds the real element from resolved slot content. Missing optional slots are simply absent keys in `content`. */
  build: (content: Record<string, ReactNode>) => ReactNode;
}

const AUTH_VIEW_TEMPLATE: WebTemplate = {
  name: "AuthView",
  layout: {
    slots: [
      // "logo" is the closest ElementKind to a brand mark — the only member
      // this vocabulary has for a lockup image/wordmark.
      { key: "brand", element: "logo", frame: WEB_FRAME },
      { key: "heading", element: "heading", frame: WEB_FRAME, required: true },
      { key: "description", element: "body", frame: WEB_FRAME },
      // "fill" is ElementKind's one generic member — the closest match for
      // an arbitrary composed sub-tree (the actual sign-in form), which no
      // more specific ElementKind describes. See this file's top comment.
      { key: "form", element: "fill", frame: WEB_FRAME, required: true },
      { key: "secondaryAction", element: "button", frame: WEB_FRAME },
      { key: "footnote", element: "body", frame: WEB_FRAME },
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
  layout: {
    slots: [
      { key: "status", element: "heading", frame: WEB_FRAME, required: true },
      // "subheading" — ErrorView renders `title` one heading level below
      // its own `status` (an <h1>), through EmptyState's <h2>. See
      // ErrorView's own doc comment in @vespeneventures/ui.
      { key: "title", element: "subheading", frame: WEB_FRAME, required: true },
      { key: "description", element: "body", frame: WEB_FRAME },
      { key: "action", element: "button", frame: WEB_FRAME },
      { key: "details", element: "body", frame: WEB_FRAME },
    ],
  },
  build: (content) =>
    createElement(ErrorView, {
      status: content.status,
      title: content.title,
      description: content.description,
      action: content.action,
      details: content.details,
    }),
};

const WEB_TEMPLATES: ReadonlyMap<string, WebTemplate> = new Map(
  [AUTH_VIEW_TEMPLATE, ERROR_VIEW_TEMPLATE].map((t) => [t.name, t]),
);

/** Every template name this package's web renderer currently knows — `AuthView`, `ErrorView`. */
export function listWebTemplateNames(): string[] {
  return [...WEB_TEMPLATES.keys()];
}

/** The `WebTemplate` registered under `name`, or `undefined` if `name` names no known template. */
export function getWebTemplate(name: string): WebTemplate | undefined {
  return WEB_TEMPLATES.get(name);
}
