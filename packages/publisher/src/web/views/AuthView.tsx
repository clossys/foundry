import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Badge, Card, mergeUiClasses } from "@clossys/designer/atoms/server";
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
   * The form slot. Rendered inside Designer's `Card`, exactly as given (the one exception is `isDisabled`) -
   * no `<form>` wrapper, no submit handling, no field state, no
   * validation. Fill it with Designer's `Form`, `TextField`, and `Button`.
   * Sign-in, sign-up, and password reset are three fillings of this slot,
   * not three views. The submit handler is the caller's, and that is the
   * only place an auth provider is called.
   */
  form: ReactNode;
  /**
   * Keeps the form on screen but disabled, for when the sign-in provider is
   * unavailable. When true, `form` renders inside a native
   * `<fieldset disabled>`, which disables every control in it while each keeps
   * its displayed value, so an identifier the site keeps (state or
   * `defaultValue`) stays visible; the controls are not focusable or
   * submitted. The notice that explains why is the form's own `submitError`,
   * the one banner region: this view adds no banner. A retry link goes in
   * `secondaryAction`, which sits outside the fieldset and stays enabled.
   * When false or absent, `form` renders as given with no wrapper.
   */
  isDisabled?: boolean;
  /**
   * Slot for the alternate-step lines, rendered below the card and above the
   * footnote - "No account? Join the waitlist", "Forgot password?", "Already
   * set up? Sign in". Pass one line or several; they stack, each child on its
   * own line, so wrap each line in one element: text plus a link in one
   * fragment splits onto two lines. The card holds
   * only the form and its one primary action. The text is always the site's
   * copy: this view has no `requestAccess` prop and no built-in link. An
   * invitation or activation step never offers request-access or sign-up -
   * the view has no mode and cannot tell it from sign-in, so the site keeps
   * that rule, and its activation-page test should assert there is no
   * request-access link.
   */
  secondaryAction?: ReactNode;
  /**
   * Slot for a short legal line under the card and above the site footer.
   */
  footnote?: ReactNode;
  /**
   * An optional development-only note under the footnote - which test
   * sign-in to use, which environment this is. `label` is the caller's copy
   * (for example "Internal"), rendered in a neutral Designer `Badge`, then
   * `message`. The view cannot know it runs in development, so the site
   * passes this prop only there; nothing renders when it is absent. Keep it
   * out of `footnote`, which is the legal line.
   */
  internalNote?: { label: string; message: ReactNode };
  /**
   * Persistent footer content, rendered by Designer's `SiteFooter`. On an
   * auth page this holds a legal row only (for example `SiteFooter.Legal`),
   * never a locale switcher: auth pages are single-locale. This view renders
   * no picker itself, so the rule is the caller's to keep.
   */
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
 * around the form slot, the `secondaryAction` lines below the card, the
 * footnote, the internal note, `SiteFooter`. There is no `mode` prop. A step
 * differs by the heading, the form slot, and the alternate-step lines the
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
  isDisabled,
  internalNote,
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
          {isDisabled ? (
            <fieldset disabled className="m-0 min-w-0 border-0 p-0">
              {form}
            </fieldset>
          ) : (
            form
          )}
        </Card>
        {secondaryAction ? (
          <div className="flex flex-col gap-xs text-body-s text-ink-secondary">{secondaryAction}</div>
        ) : null}
        {footnote ? <p className="text-body-s text-ink-muted">{footnote}</p> : null}
        {internalNote ? (
          <p className="flex items-center gap-xs text-body-s text-ink-muted">
            <Badge variant="neutral">{internalNote.label}</Badge>
            {internalNote.message}
          </p>
        ) : null}
      </main>
      <SiteFooter secondary={footerSecondary} />
    </div>
  );
}
