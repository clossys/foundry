import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { mergeUiClasses } from "@clossys/designer/atoms/server";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import type { SiteFooterLegalProps } from "@clossys/designer/shell/server";

export interface LandingViewProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Persistent site identity, rendered in the page banner. A slot: consumers typically pass a `Brandmark`. */
  brand: ReactNode;
  /** The page's call to action, rendered in the banner. */
  headerAction?: ReactNode;
  /** A short line above the heading. */
  eyebrow?: ReactNode;
  /** The page's only `<h1>`. */
  heading: ReactNode;
  /** A line of supporting copy under the heading. */
  description?: ReactNode;
  /**
   * A call to action inside the hero. Absent by default: the page's call to
   * action lives in the banner alone, so a hero action is an explicit choice.
   */
  heroAction?: ReactNode;
  /** Media shown after the description. */
  media?: ReactNode;
  /**
   * How the hero's content aligns.
   * @default "center"
   */
  align?: "center" | "start";
  /**
   * Decoration behind the page. Rendered first, absolutely positioned,
   * `aria-hidden` and non-interactive; absent from the markup when omitted.
   */
  backdrop?: ReactNode;
  /** The legal row, passed straight to `SiteFooter.Legal`. Every visible word in it comes from these props. */
  legal: SiteFooterLegalProps;
  style?: CSSProperties;
}

/**
 * A single-screen landing page: a transparent banner, one centred hero and a
 * transparent legal footer over an optional backdrop.
 *
 * What it guarantees: one banner, one main and one contentinfo landmark; the
 * `heading` as the page's only `<h1>`; a call to action in the banner alone
 * unless `heroAction` is supplied; a backdrop that is inert to assistive
 * technology and to the pointer; header, footer and legal row that carry no
 * background, border or width cap, so chrome content runs the full viewport
 * width; and copy that comes only from props (there is no built-in wording).
 *
 * What it does not do: check the contrast of the page ink over the backdrop,
 * and it does not make anything a consumer places inside the backdrop
 * unfocusable. Both belong to the consumer's backdrop.
 */
export function LandingView({
  brand,
  headerAction,
  eyebrow,
  heading,
  description,
  heroAction,
  media,
  align = "center",
  backdrop,
  legal,
  className,
  style,
  ...rest
}: LandingViewProps) {
  const centred = align === "center";
  return (
    <div
      {...rest}
      className={mergeUiClasses("relative flex min-h-dvh flex-col text-ink-primary", className)}
      style={style}
    >
      {backdrop ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          {backdrop}
        </div>
      ) : null}
      <SiteHeader ground="transparent" brand={brand} actions={headerAction} />
      <main className="relative flex flex-1 flex-col items-center justify-center px-lg py-2xl">
        <div className={mergeUiClasses("flex w-full flex-col gap-md", centred ? "items-center text-center" : "items-start text-start")}>
          {eyebrow ? <p className="text-caption uppercase tracking-label text-ink-muted">{eyebrow}</p> : null}
          <h1 className="text-display-l font-display text-ink-primary">{heading}</h1>
          {description ? <p className="text-body-l max-w-display text-ink-secondary">{description}</p> : null}
          {heroAction ? <div className="flex flex-wrap items-center gap-sm">{heroAction}</div> : null}
          {media ? <div className="w-full max-w-display">{media}</div> : null}
        </div>
      </main>
      <SiteFooter ground="transparent" secondary={<SiteFooter.Legal {...legal} />} />
    </div>
  );
}
