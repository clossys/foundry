/**
 * The registry `renderWebDocument` uses to answer "what does
 * `SurfaceDocument.template` actually name, and what slots does it have?"
 *
 * A surface template is a plain string so the canonical contract remains
 * data-only. This registry owns the real slot shapes for the generic web
 * views this package ships (`AuthView`, `ErrorView`). Canonical callers
 * resolve a `SurfaceDocument` before rendering; the renderer-compatible
 * `ComposeDocument` only exists as that internal compatibility lowering.
 *
 * Every template uses `FlowLayoutSpec`: flowed slots express only their key,
 * optional requiredness, and optional style. A web page has no canvas, so it
 * must never invent a `Frame` or an `ElementKind` merely to satisfy the
 * resolver.
 */

import type { ReactNode } from "react";
import { createElement } from "react";
import type { FlowLayoutSpec } from "../../core/index.js";
import { AuthView, ErrorView } from "../views/index.js";

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
  /** Builds the real element from resolved slot content. Missing optional slots are simply absent keys in `content`. */
  build: (content: Record<string, ReactNode>) => ReactNode;
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
