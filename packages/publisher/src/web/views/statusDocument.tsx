import type { ReactElement, ReactNode } from "react";
import { SITE_MAIN_ID } from "../frame/types.js";
import { formatPageTitle } from "../siteMetadata.js";
import type { GlobalErrorDocumentHeadProps } from "./GlobalErrorDocument.js";

/**
 * The attribute that marks the inline critical style element in a framed
 * status document's head.
 */
export const FRAME_CRITICAL_STYLE_ATTRIBUTE = "data-publisher-frame-critical";

/**
 * Structural rules for the frame's bands, for a document that replaces the
 * root layout on a host that cannot import the site stylesheet into it. They
 * restate the values of the utility classes the frame already carries (the
 * root's `flex min-h-dvh flex-col`, the main's `flex w-full flex-1 flex-col`,
 * the skip link's `sr-only` while unfocused, and the accent brand mark's
 * `inline-block shrink-0 bg-accent`), so they agree with the site stylesheet
 * when both apply. They sit in their own cascade layer, rendered before any
 * linked stylesheet, so the stylesheet's layers and unlayered rules come
 * after it. No colour literal: the brand mark reads the accent token and falls
 * back to the text colour.
 */
const FRAME_CRITICAL_CSS = [
  "@layer publisher-frame-critical{",
  "[data-frame-root]{display:flex;flex-direction:column;min-height:100dvh}",
  `#${SITE_MAIN_ID}{display:flex;flex:1;flex-direction:column;width:100%}`,
  `a[href="#${SITE_MAIN_ID}"]:not(:focus){position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border-width:0}`,
  '[data-frame-root] header span.bg-accent[aria-hidden="true"]{display:inline-block;flex-shrink:0;background-color:var(--color-accent,currentColor)}',
  "}",
].join("");

/**
 * Whether the value holds an ASCII control character, a space or DEL. The URL
 * parser strips TAB, LF and CR anywhere in its input, so "/<TAB>/host" would
 * otherwise pass the root-relative test below and still resolve to a
 * protocol-relative external URL.
 */
function hasControlOrSpace(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

function isStylesheetHref(href: unknown): href is string {
  if (typeof href !== "string" || href === "" || href.trim() !== href || hasControlOrSpace(href)) return false;
  if (href.startsWith("/")) return !href.startsWith("//") && !href.includes("\\");
  try {
    return new URL(href).protocol === "https:";
  } catch {
    return false;
  }
}

function checkedStylesheets(component: string, stylesheets: unknown): readonly string[] {
  if (stylesheets === undefined) return [];
  if (!Array.isArray(stylesheets)) throw new TypeError(`${component}: stylesheets must be an array.`);
  stylesheets.forEach((href: unknown, index) => {
    // The message names the index only, never the value.
    if (!isStylesheetHref(href)) throw new TypeError(`${component}: stylesheets[${index}] must be a root-relative path or an https URL.`);
  });
  return stylesheets as readonly string[];
}

export interface StatusDocumentProps {
  /** The public component name, used in error messages. */
  component: "GlobalErrorDocument" | "NotFoundDocument";
  head: GlobalErrorDocumentHeadProps;
  /** Whether the body is `SiteFrame`; only then does the head carry the frame's critical rules. */
  framed: boolean;
  children: ReactNode;
}

/**
 * The document both status documents render: `<html>` with the given `lang`,
 * pinned to the light theme and marked `data-brand-bound`; a head with the
 * title, a `noindex, nofollow` robots meta, one icon link, the frame's
 * critical rules (framed only) and any linked stylesheets; then the body.
 */
export function StatusDocument({ component, head, framed, children }: StatusDocumentProps): ReactElement {
  const { lang, documentTitle, icon, htmlClassName } = head;
  const title = formatPageTitle(documentTitle);
  const stylesheets = checkedStylesheets(component, head.stylesheets);
  return (
    <html
      lang={lang}
      className={htmlClassName === undefined || htmlClassName === "" ? undefined : htmlClassName}
      data-theme="light"
      data-brand-bound=""
      style={{ colorScheme: "light" }}
    >
      <head>
        <title>{title}</title>
        <meta name="robots" content="noindex, nofollow" />
        <link rel="icon" href={icon.href} type={icon.type} />
        {framed ? <style data-publisher-frame-critical="">{FRAME_CRITICAL_CSS}</style> : null}
        {stylesheets.map((href, index) => (
          // Keyed by position: the list is the caller's order and never reorders.
          <link key={index} rel="stylesheet" href={href} />
        ))}
      </head>
      <body>{children}</body>
    </html>
  );
}
