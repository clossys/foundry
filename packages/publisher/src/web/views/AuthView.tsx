import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Card, mergeUiClasses } from "@clossys/designer/atoms/server";
import { PageHeader } from "@clossys/designer/blocks/server";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";

export interface AuthViewProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Persistent site identity, rendered in the page banner. Required:
   * `SiteHeader` announces which site this is, and this package ships no
   * brand mark of its own.
   */
  brand: ReactNode;
  /**
   * Optional text-only label naming the surface, such as "admin" or "demo",
   * shown as a non-interactive badge at the trailing end of the page banner.
   * A member host omits it.
   */
  surfaceLabel?: string;
  /**
   * The page's own name - the words for sign-in, account creation,
   * password reset, or verification. Renders as the page's `<h1>` through
   * Designer's `PageHeader`, above the card. Copy is the caller's; this
   * view has no mode that picks a heading.
   */
  heading: ReactNode;
  /**
   * A line of supporting copy under `heading`. Required, so every step
   * decides on a supporting line and sign-in always passes one; a step with
   * nothing to say passes `undefined` or `null` explicitly.
   */
  description: ReactNode;
  /**
   * The form slot. Rendered inside Designer's `Card`, exactly as given -
   * no `<form>` wrapper, no submit handling, no field state, no
   * validation. Fill it with Designer's `Form`, `TextField`, and `Button`.
   * Sign-in, sign-up, and password reset are three fillings of this slot,
   * not three views. The submit handler is the caller's, and that is the
   * only place an auth provider is called.
   */
  form: ReactNode;
  /**
   * Slot for a secondary link below the fields, still inside the card -
   * the alternate step ("Create an account", "Back to sign in").
   */
  secondaryAction?: ReactNode;
  /**
   * Slot for a short legal line under the card and above the site footer.
   */
  footnote?: ReactNode;
  /** Persistent footer content, rendered by Designer's `SiteFooter`. */
  footerSecondary?: ReactNode;
  /** Merged onto the outer element's inline style, after this component's own. */
  style?: CSSProperties;
}

/**
 * One page shell for every authentication step: sign-in, sign-up,
 * password reset, email verification. A view, not a block: a page is an
 * auth page or it isn't - there is no page that reasonably shows two
 * auth forms side by side.
 *
 * The shell is Designer's, in order: `SiteHeader`, `PageHeader`, `Card`
 * around the form slot, `SiteFooter`. There is no `mode` prop. A step
 * differs by the heading, the form slot, and the secondary link the
 * caller passes in.
 *
 * **This component implements no authentication of any kind.** No
 * provider, no form state, no field validation, no submit handling - it
 * renders `form` exactly as given. An auth provider stays behind the
 * caller's submit handler. A shared view that absorbed one provider's
 * field set would immediately need an escape hatch for every other one.
 */
export function AuthView({
  brand,
  surfaceLabel,
  heading,
  description,
  form,
  secondaryAction,
  footnote,
  footerSecondary,
  className,
  style,
  ...rest
}: AuthViewProps) {
  return (
    <div {...rest} className={mergeUiClasses("flex min-h-dvh flex-col", className)} style={style}>
      <SiteHeader brand={brand} surfaceLabel={surfaceLabel} />
      <main
        className="mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-2xl"
        style={{ maxWidth: "var(--ui-width-form-max, none)" }}
      >
        <PageHeader title={heading} description={description} />
        <Card className="flex flex-col gap-lg">
          {form}
          {secondaryAction ? <div className="text-body-s text-ink-secondary">{secondaryAction}</div> : null}
        </Card>
        {footnote ? <p className="text-body-s text-ink-muted">{footnote}</p> : null}
      </main>
      <SiteFooter secondary={footerSecondary} />
    </div>
  );
}
