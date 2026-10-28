import type { ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { SkipLink } from "../shell/SkipLink.js";

const FRAME_STAMP = dsAttrs("frames", "frames.auth-shell", "foundry/frames.auth-shell");
const MAIN_ID = "main-content";

export interface AuthFrameProps {
  /** Consumer-authored text for the first, focus-visible skip link. */
  skipLabel: string;
  /** Registered Sections supplied by the host route. */
  children: ReactNode;
  className?: string;
}

/** A document-scrolling, centred single column for standalone authentication and error pages. */
export function AuthFrame({ skipLabel, children, className }: AuthFrameProps) {
  if (!skipLabel.trim()) throw new TypeError("AuthFrame: skipLabel must be non-empty text");
  return <div {...FRAME_STAMP} data-frame-root="" className={cx("min-h-dvh bg-surface-base text-ink-primary", className)}
    style={{ paddingInline: "var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))" }}>
    <SkipLink targetId={MAIN_ID}>{skipLabel}</SkipLink>
    <main id={MAIN_ID} tabIndex={-1} className="mx-auto flex min-h-dvh w-full min-w-0 flex-col justify-center gap-lg py-lg"
      style={{ maxWidth: "var(--ui-width-form-max, 38rem)" }}>
      {children}
    </main>
  </div>;
}
