import type { ReactNode } from "react";
import { ShellI18nProvider, ShellLocaleRoot } from "#designer-frame-i18n";
import { cx } from "../components/internal/cx.js";
import { GROUND_PAINT } from "../components/Card.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";

import { SkipLink } from "../shell/SkipLink.js";

import { componentLeaf } from "../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

const FRAME_STAMP = dsAttrs("frames", "frames.auth-shell", "foundry/frames.auth-shell");
const MAIN_ID = "main-content";

export interface AuthFrameProps {
  /** Canonical page locale supplied by the host through Writer. */
  locale?: string;
  /** Consumer-authored text for the first, focus-visible skip link. */
  skipLabel: string;
  /** Registered Sections supplied by the host route. */
  children: ReactNode;
  className?: string;
}

/** A document-scrolling, centred single column for standalone authentication and error pages. */
export function AuthFrame({ skipLabel, children, className, locale }: AuthFrameProps) {
  if (!skipLabel.trim()) throw new TypeError("AuthFrame: skipLabel must be non-empty text");
  return <ShellI18nProvider locale={locale}><ShellLocaleRoot><SemanticContent as="div" {...FRAME_STAMP} data-frame-root="" className={cx("min-h-dvh page-inset-x", GROUND_PAINT.page.surface, GROUND_PAINT.page.primary, className)}>
    <SkipLink targetId={MAIN_ID}>{skipLabel}</SkipLink>
    <SemanticContent as="main" id={MAIN_ID} tabIndex={-1} className="mx-auto flex min-h-dvh w-full min-w-0 flex-col justify-center auth-main measure-form">
      {children}
    </SemanticContent>
  </SemanticContent></ShellLocaleRoot></ShellI18nProvider>;
}
