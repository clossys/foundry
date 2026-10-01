import type { ReactElement } from "react";
import { formatPageTitle } from "../siteMetadata.js";
import { ErrorView } from "./ErrorView.js";
import type { ErrorViewProps } from "./ErrorView.js";

export interface GlobalErrorDocumentProps extends Omit<ErrorViewProps, "lang"> {
  /** The document language, set on the root `<html>`. Required because this document replaces the root layout that normally sets it. */
  lang: string;
  /**
   * The two parts of the `<title>`, joined and validated by `formatPageTitle`
   * (`<page> · <brand>`). A part with leading or trailing whitespace, or an
   * empty one, throws `SiteMetadataError`.
   */
  documentTitle: { page: string; brand: string };
  /** The favicon `<link rel="icon">`: a root-relative or absolute `href`, and an optional MIME `type`. */
  icon: { href: string; type?: string };
  /**
   * An optional class name set on the root `<html>`, rendered only when it is a
   * non-empty string. Use it for a class a framework font loader needs on the
   * root element to expose its CSS variables, so brand tokens that reference
   * those variables still resolve in a document that replaces the root layout.
   */
  htmlClassName?: string;
}

/**
 * A complete error document for a framework's global-error boundary, which
 * replaces the root layout and so must render its own `<html>`, `<head>` and
 * `<body>` without the layout's stylesheet, theme script or copy.
 *
 * The head carries a title (`formatPageTitle`), a `noindex, nofollow` robots
 * meta and one icon link. The body is an `ErrorView` receiving every prop
 * other than `lang`, `documentTitle`, `icon` and `htmlClassName`. A diagnostic reference such as
 * a digest belongs in `description` as caller copy
 * (`Error: <digest>.`); there is no digest prop.
 *
 * No theme script runs here, so the document is pinned to the light theme with
 * `color-scheme: light`. Brand tokens come from the stylesheet the consumer
 * imports in its own global-error file; this component imports none.
 *
 * A component, not a template: it takes no router, framework, hook or
 * `metadata` export, and is not a client module.
 */
export function GlobalErrorDocument({
  lang,
  documentTitle,
  icon,
  htmlClassName,
  ...errorViewProps
}: GlobalErrorDocumentProps): ReactElement {
  return (
    <html
      lang={lang}
      className={htmlClassName === undefined || htmlClassName === "" ? undefined : htmlClassName}
      data-theme="light"
      data-brand-bound=""
      style={{ colorScheme: "light" }}
    >
      <head>
        <title>{formatPageTitle(documentTitle)}</title>
        <meta name="robots" content="noindex, nofollow" />
        <link rel="icon" href={icon.href} type={icon.type} />
      </head>
      <body>
        <ErrorView {...errorViewProps} />
      </body>
    </html>
  );
}
