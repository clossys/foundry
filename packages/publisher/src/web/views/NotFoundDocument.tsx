import type { ReactElement, ReactNode } from "react";
import { SiteFrame } from "@clossys/designer/frames";
import type { SiteFrameInput } from "@clossys/designer/frames";
import type { GlobalErrorDocumentHeadProps } from "./GlobalErrorDocument.js";
import { StatusView } from "./StatusView.js";
import type { StatusViewProps } from "./StatusView.js";
import { StatusDocument } from "./statusDocument.js";

/**
 * `NotFoundDocument`'s props: the document head `GlobalErrorDocument` takes,
 * the frame's inputs, and the `StatusView` props an unmatched address needs.
 */
export interface NotFoundDocumentProps extends GlobalErrorDocumentHeadProps, SiteFrameInput {
  /** The page's one `<h1>`, as on `StatusView`: a status code such as `"404"`, or a short title. */
  status: ReactNode;
  /** One line of supporting copy under the status. */
  subtitle?: ReactNode;
  /** The one primary call to action, such as a link home, on the page background. */
  action?: ReactNode;
  /** A quiet line under the action for a secondary link. */
  notes?: ReactNode;
  /** Caller-labelled destinations forwarded unchanged to StatusView. */
  routes?: StatusViewProps["routes"];
  /** An unmatched address has no diagnostic to show; passing one throws. */
  reference?: never;
  title?: never;
  description?: never;
}

/**
 * A complete document for an unmatched address, rendered where no root layout
 * applies (for example Next's `global-not-found` file, or a site whose root
 * layout sits under a locale segment the unmatched address never reached). It
 * renders its own `<html>`, `<head>` and `<body>`: the same head as
 * `GlobalErrorDocument` (a `formatPageTitle` title, a `noindex, nofollow`
 * robots meta, one icon link, the frame's inline critical rules and any
 * linked `stylesheets`), then `SiteFrame` around a `StatusView`, so the page
 * has one skip link, banner, `<main>`, contentinfo and `<h1>`.
 *
 * It reads no request, header, cookie, router, locale or provider: every
 * word comes from the props, the `lang` is the configured one, and the frame
 * resolves its copy through the `resolveCopy` passed in. It is not a client
 * module and has no hooks, so it renders on the server or the client alike.
 */
export function NotFoundDocument(props: NotFoundDocumentProps): ReactElement {
  const legacy = props as { title?: unknown; description?: unknown; reference?: unknown };
  if (legacy.title !== undefined || legacy.description !== undefined) {
    throw new Error("NotFoundDocument: `title` and `description` belong to the deprecated ErrorView shape; pass `status`, `subtitle`, `action` and `notes`.");
  }
  if (legacy.reference != null) {
    throw new Error("NotFoundDocument: reference is for an error diagnostic; an unmatched address has none.");
  }
  const { lang, localeManifest, documentTitle, icon, htmlClassName, stylesheets, shell, resolveCopy, resolveAsset, status, subtitle, action, notes, routes } = props;
  return (
    <StatusDocument component="NotFoundDocument" head={{ lang, localeManifest, documentTitle, icon, htmlClassName, stylesheets }} framed>
      <SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>
        <StatusView status={status} subtitle={subtitle} action={action} notes={notes} routes={routes} />
      </SiteFrame>
    </StatusDocument>
  );
}
