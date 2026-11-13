import type { ReactElement, ReactNode } from "react";
import { DocumentFrame } from "@clossys/designer/frames";
import { canonicalLocale, directionFor } from "@clossys/writer/locale";
import { formatPageTitle } from "../siteMetadata.js";
import type { GlobalErrorDocumentHeadProps } from "./GlobalErrorDocument.js";

export { FRAME_CRITICAL_STYLE_ATTRIBUTE } from "@clossys/designer/frames";
export type StatusDocumentLocaleManifest = Parameters<typeof directionFor>[1];

export interface StatusDocumentProps {
  /** The public component name, used in error messages. */
  component: "GlobalErrorDocument" | "NotFoundDocument";
  head: GlobalErrorDocumentHeadProps;
  /** Whether the body is `SiteFrame`; only then does the head carry the frame's critical rules. */
  framed: boolean;
  children: ReactNode;
}

/** Resolve Publisher's title and Writer locale authority before rendering the shared document frame. */
export function StatusDocument({ component, head, framed, children }: StatusDocumentProps): ReactElement {
  const lang = canonicalLocale(head.lang);
  const dir = directionFor(lang, head.localeManifest);
  const title = formatPageTitle(head.documentTitle);
  return (
    <DocumentFrame
      lang={lang}
      dir={dir}
      variant="status"
      title={title}
      icon={head.icon}
      htmlClassName={head.htmlClassName}
      stylesheets={head.stylesheets}
      framed={framed}
      componentName={component}
    >
      {children}
    </DocumentFrame>
  );
}
