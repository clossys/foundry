import type { ReactElement, ReactNode } from "react";
import { SiteFrame } from "../frame/SiteFrame.js";
import type { SiteFrameInput } from "../frame/types.js";
import { formatPageTitle } from "../siteMetadata.js";
import { ErrorViewBody } from "./ErrorView.js";
import type { ErrorViewProps } from "./ErrorView.js";
import { StatusView } from "./StatusView.js";

/** The document-level props both shapes share: the root `<html>` and the `<head>`. */
export interface GlobalErrorDocumentHeadProps {
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
 * The framed shape: the document, then `SiteFrame` (skip link, banner, the
 * page's one `<main>`, contentinfo) built from `shell`, `resolveCopy` and
 * `resolveAsset`, then `StatusView` inside that `<main>`.
 */
export interface GlobalErrorDocumentFramedProps extends GlobalErrorDocumentHeadProps, SiteFrameInput {
  /** The page's one `<h1>`, as on `StatusView`: a status code such as `"500"`, or a short title. */
  status: ReactNode;
  /** One line of supporting copy under the status. A diagnostic reference (`Error: <digest>.`) belongs here as caller copy. */
  subtitle?: ReactNode;
  /** The one primary call to action, such as a retry button, on the page background. */
  action?: ReactNode;
  /** A quiet line under the action for a secondary link. */
  notes?: ReactNode;
  title?: never;
  description?: never;
}

/**
 * The earlier shape: an `ErrorView` as the whole `<body>`, with no frame and
 * no `<main>`.
 *
 * @deprecated Pass `shell`, `resolveCopy` and `resolveAsset` and use the
 * `StatusView` props (`status`, `subtitle`, `action`, `notes`) instead: the
 * document then renders `SiteFrame` and `StatusView`, with one `<main>`.
 * `title` has no equivalent; fold it into `subtitle`. This shape is kept for
 * one release.
 */
export interface GlobalErrorDocumentErrorViewProps extends GlobalErrorDocumentHeadProps, Omit<ErrorViewProps, "lang"> {
  shell?: never;
  resolveCopy?: never;
  resolveAsset?: never;
  subtitle?: never;
  notes?: never;
}

/**
 * `GlobalErrorDocument`'s props: the framed shape (selected by `shell`), or
 * the deprecated `ErrorView` shape (selected by its absence).
 */
export type GlobalErrorDocumentProps = GlobalErrorDocumentFramedProps | GlobalErrorDocumentErrorViewProps;

function isFramed(props: GlobalErrorDocumentProps): props is GlobalErrorDocumentFramedProps {
  return props.shell !== undefined;
}

/**
 * A complete error document for a framework's global-error boundary, which
 * replaces the root layout and so must render its own `<html>`, `<head>` and
 * `<body>` without the layout's stylesheet, theme script or copy.
 *
 * The head carries a title (`formatPageTitle`), a `noindex, nofollow` robots
 * meta and one icon link. With `shell`, the body is the same page every other
 * route gets: `SiteFrame` (skip link, banner, the page's one `<main>`,
 * contentinfo) around a `StatusView`, so the document has one `<main>`, one
 * `<h1>` and no card. A diagnostic reference such as a digest belongs in
 * `subtitle` as caller copy (`Error: <digest>.`); there is no digest prop.
 *
 * Without `shell` it renders the deprecated earlier shape: an `ErrorView` as
 * the whole body, with no frame and no `<main>`. Passing `shell` together with
 * `title` or `description` throws, so a half-migrated call site does not drop
 * copy silently.
 *
 * No theme script runs here, so the document is pinned to the light theme with
 * `color-scheme: light`. Brand tokens come from the stylesheet the consumer
 * imports in its own global-error file; this component imports none.
 *
 * A component, not a template: it takes no router, framework, hook or
 * `metadata` export, and is not a client module.
 */
export function GlobalErrorDocument(props: GlobalErrorDocumentProps): ReactElement {
  const { lang, documentTitle, icon, htmlClassName } = props;
  let body: ReactElement;
  if (isFramed(props)) {
    const legacy = props as { title?: unknown; description?: unknown };
    if (legacy.title !== undefined || legacy.description !== undefined) {
      throw new Error(
        "GlobalErrorDocument: `title` and `description` belong to the deprecated ErrorView shape; with `shell`, pass `status`, `subtitle`, `action` and `notes`.",
      );
    }
    const { shell, resolveCopy, resolveAsset, status, subtitle, action, notes } = props;
    body = (
      <SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>
        <StatusView status={status} subtitle={subtitle} action={action} notes={notes} />
      </SiteFrame>
    );
  } else {
    const {
      lang: _lang,
      documentTitle: _documentTitle,
      icon: _icon,
      htmlClassName: _htmlClassName,
      shell: _shell,
      resolveCopy: _resolveCopy,
      resolveAsset: _resolveAsset,
      subtitle: _subtitle,
      notes: _notes,
      ...errorViewProps
    } = props;
    body = <ErrorViewBody {...errorViewProps} />;
  }
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
      <body>{body}</body>
    </html>
  );
}
