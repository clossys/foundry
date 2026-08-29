/**
 * `renderStructuredDocument` — turns a validated `StructuredDocument` into a
 * `ReactNode` tree built entirely from semantic HTML elements (`<section>`,
 * `<h2>`–`<h6>`, `<p>`, `<ul>`/`<ol>`, `<dl>`, `<table>`/`<thead>`/`<tbody>`/
 * `<th>`/`<td>`, `<a>`) — never through a markup-string sink, and never
 * through `dangerouslySetInnerHTML`. Every block and every inline node is a
 * typed, closed-vocabulary primitive this file walks explicitly; there is
 * no `"html"` block kind and no markdown-string field parsed into
 * unrestricted markup anywhere in this package. See this package's README,
 * "document" for the full non-goals list.
 *
 * REFUSES TO RENDER AN INVALID DOCUMENT AT ALL
 * -----------------------------------------------
 * `validateStructuredDocument` runs first; any `severity: "error"` finding
 * throws `RenderError("resolution-failed", ...)` before a single element is
 * built — the same fail-closed discipline `resolveSurfaceDocument` already
 * holds every other unresolved/invalid input in this package to. A
 * document that is only PARTIALLY invalid (one bad table row among ten
 * good sections) never partially renders; the whole call throws.
 *
 * `resolveCopyId`'S TYPE IS `@clossys/writer`'s REF-BASED
 * `CopyResolver`, NOT `surface/web`'s STRING-KEYED ONE
 * -----------------------------------------------------------------
 * The originating proposal for this subpath (issue #176) describes
 * `RenderStructuredDocumentOptions.resolveCopyId` as "the same seam shape
 * as `surface/web`'s existing `CopyResolver`." That is not accurate once
 * the two signatures are compared: `surface/web`'s `CopyResolver` is
 * `(copyId: string) => string | undefined` — it resolves an opaque string
 * id into plain text, with no way to report a `CopyResolution` (registry
 * id, revision, locale, source). Every leaf of `StructuredDocument`
 * content is a `CopyRef`, not a bare `copyId` string, and this subpath's
 * own acceptance bar requires collecting a `CopyResolution[]` for
 * provenance (`collectCopyProvenance`, `surface/core`) exactly the way
 * `resolveSurfaceDocument` already does. Only `@clossys/writer`'s
 * own `CopyResolver` — `(ref: CopyRef) => CopyResolution | undefined`, the
 * same type `resolveSurfaceDocument`'s own `resolver` parameter takes —
 * can satisfy that. This file uses that type, keeping the option's NAME
 * from the proposal (`resolveCopyId`, for continuity with the rest of this
 * package's naming) while correcting its TYPE.
 *
 * `title` IS RESOLVED FOR PROVENANCE, NEVER RENDERED
 * -----------------------------------------------------
 * `doc.title` is resolved (and lands in `resolutions`) so a manifest built
 * from this render's output can account for it, but it never appears in
 * `element` — `h1` stays outside this contract; see `DocumentSection`'s
 * own doc comment.
 *
 * RETURN SHAPE: `{ element, resolutions }`, NOT A BARE `ReactNode`
 * --------------------------------------------------------------------
 * Issue #176's proposed signature returns a bare `ReactNode`. That cannot
 * satisfy its OWN acceptance criterion two paragraphs above ("every
 * `CopyRef` resolved during a render ... is collected into the same
 * `CopyResolution[]` shape `resolveSurfaceDocument` already produces") —
 * there is no way to hand a caller a `CopyResolution[]` through a return
 * value that is only ever a `ReactNode`. This file returns
 * `{ element, resolutions }` instead, the same "resolved value alongside
 * its collected provenance" shape `ResolvedSurfaceDocument` and
 * `RenderWebResult` already use elsewhere in this package.
 */

import type { ReactNode } from "react";
import { createElement, Fragment, version as reactVersion } from "react";
import type { CopyRef, CopyResolution, CopyResolver } from "@clossys/writer";
import { RenderError } from "../internal/errors.js";
import { assertPeerVersion } from "../internal/peer-version.js";
import { validateStructuredDocument } from "./validate.js";
import type { DocumentBlock, DocumentInline, DocumentSection, StructuredDocument } from "./types.js";

/** See `../web/renderWebDocument.ts`'s identical guard for why this reads `react`'s own exported `version` rather than a filesystem-based resolver: this module is reachable from a browser bundle as easily as from a server one. */
export const REACT_DECLARED_RANGE = ">=18";
assertPeerVersion({ peer: "react", declaredRange: REACT_DECLARED_RANGE, foundVersion: reactVersion });

export interface RenderStructuredDocumentOptions {
  /** See this file's own top comment, "`resolveCopyId`'s type", for why this is `@clossys/writer`'s ref-based `CopyResolver`, not `surface/web`'s string-keyed one. Omit only for a document with no sections at all — every other document has at least `title` to resolve. */
  resolveCopyId?: CopyResolver;
}

export interface RenderStructuredDocumentResult {
  /** The rendered document body — see this file's own top comment for the exact element vocabulary. */
  element: ReactNode;
  /** Every `CopyResolution` this render actually used, in resolution order — feed this to `surface/core`'s `collectCopyProvenance` exactly as `ResolvedSurfaceDocument.resolutions` already is. */
  resolutions: CopyResolution[];
}

type TextFn = (ref: CopyRef, path: string) => string;

function headingTag(level: DocumentSection["level"]): "h2" | "h3" | "h4" | "h5" | "h6" {
  return `h${level}` as const;
}

function renderInline(inline: DocumentInline, path: string, text: TextFn): ReactNode {
  if (inline.kind === "text") return text(inline.text, `${path}.text`);
  return createElement("a", { key: path, href: inline.href }, text(inline.text, `${path}.text`));
}

function renderInlineList(inlines: DocumentInline[], path: string, text: TextFn): ReactNode[] {
  return inlines.map((inline, index) => renderInline(inline, `${path}.${index}`, text));
}

function renderBlock(block: DocumentBlock, path: string, text: TextFn): ReactNode {
  switch (block.kind) {
    case "section":
      return renderSection(block, path, text);

    case "paragraph":
      return createElement("p", { key: path }, ...renderInlineList(block.content, `${path}.content`, text));

    case "list": {
      const tag = block.style === "ordered" ? "ol" : "ul";
      return createElement(
        tag,
        { key: path },
        ...block.items.map((item, index) => createElement("li", { key: `${path}.items.${index}` }, ...renderInlineList(item, `${path}.items.${index}`, text))),
      );
    }

    case "definition-list":
      return createElement(
        "dl",
        { key: path },
        ...block.items.flatMap((item, index) => [
          createElement("dt", { key: `${path}.items.${index}.term` }, text(item.term, `${path}.items.${index}.term`)),
          createElement("dd", { key: `${path}.items.${index}.description` }, text(item.description, `${path}.items.${index}.description`)),
        ]),
      );

    case "table":
      return createElement(
        "table",
        { key: path },
        ...(block.caption === undefined ? [] : [createElement("caption", { key: `${path}.caption` }, text(block.caption, `${path}.caption`))]),
        createElement(
          "thead",
          { key: `${path}.thead` },
          createElement("tr", null, ...block.headers.map((header, index) => createElement("th", { scope: "col", key: `${path}.headers.${index}` }, text(header, `${path}.headers.${index}`)))),
        ),
        createElement(
          "tbody",
          { key: `${path}.tbody` },
          ...block.rows.map((row, rowIndex) =>
            createElement(
              "tr",
              { key: `${path}.rows.${rowIndex}` },
              ...row.map((cell, cellIndex) => createElement("td", { key: `${path}.rows.${rowIndex}.${cellIndex}` }, text(cell, `${path}.rows.${rowIndex}.${cellIndex}`))),
            ),
          ),
        ),
      );

    case "callout":
      // `role="note"` plus a `data-callout-tone` attribute naming the
      // closed `tone` vocabulary — a public, documented part of this
      // subpath's own render contract (see the README), not an
      // internal-convention leak. There is no single HTML element for
      // "callout"; `<aside>` is the closest semantic fit for content
      // related to, but separable from, the surrounding section.
      return createElement("aside", { key: path, role: "note", "data-callout-tone": block.tone }, ...renderInlineList(block.content, `${path}.content`, text));
  }
}

function renderSection(section: DocumentSection, path: string, text: TextFn): ReactNode {
  return createElement(
    "section",
    { id: section.id, key: path },
    createElement(headingTag(section.level), { key: `${path}.heading` }, text(section.heading, `${path}.heading`)),
    ...section.blocks.map((block, index) => renderBlock(block, `${path}.blocks.${index}`, text)),
  );
}

/**
 * Validates, resolves, and renders a `StructuredDocument`. See this file's
 * own top comment for the full contract, including the two deliberate
 * corrections to issue #176's originally proposed shape (`resolveCopyId`'s
 * real type, and the `{ element, resolutions }` return shape).
 */
export function renderStructuredDocument(doc: StructuredDocument, options: RenderStructuredDocumentOptions = {}): RenderStructuredDocumentResult {
  const findings = validateStructuredDocument(doc);
  const errors = findings.filter((finding) => finding.severity === "error");
  if (errors.length > 0) {
    throw new RenderError(
      "resolution-failed",
      `renderStructuredDocument refused to render invalid document "${doc?.id ?? "(unknown)"}": ${errors.map((finding) => `${finding.rule} at ${finding.path ?? "(root)"} — ${finding.message}`).join("; ")}`,
    );
  }

  const resolutions: CopyResolution[] = [];
  const text: TextFn = (ref, path) => {
    const resolution = options.resolveCopyId?.(ref);
    if (resolution === undefined || typeof resolution.text !== "string" || resolution.text.trim().length === 0) {
      throw new RenderError(
        "resolution-failed",
        `renderStructuredDocument could not resolve CopyRef "${ref.id}" at ${path} for document "${doc.id}" (missing options.resolveCopyId, an unresolved id, or empty resolved text).`,
      );
    }
    resolutions.push(resolution);
    return resolution.text;
  };

  // Resolved for provenance only — never rendered. See this file's own top comment.
  text(doc.title, "title");

  const element = createElement(Fragment, null, ...doc.sections.map((section, index) => renderSection(section, `sections.${index}`, text)));

  return { element, resolutions };
}
