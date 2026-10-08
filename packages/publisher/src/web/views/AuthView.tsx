import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { mergeUiClasses } from "@clossys/designer/atoms/server";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import { PAGE_COLUMN_CLASSES, PageLayout, pageColumnStyle } from "../internal/PageLayout.js";
import type { SiteChromeGround } from "../internal/viewChromeGround.js";
import { assertViewContentRoot, usesLegacyChrome } from "../internal/viewContentRoot.js";

export interface AuthViewProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * @deprecated Page chrome belongs to `SiteFrame`. Render the view inside a
   * `SiteFrame` and pass no chrome props: the view is then chrome-free.
   *
   * Persistent site identity, rendered in the page banner. Passing it (or any
   * other deprecated chrome prop below) selects the legacy page, in which the
   * view renders its own header, `<main>` and footer as before.
   */
  brand?: ReactNode;
  /**
   * @deprecated Chrome belongs to `SiteFrame`; see `brand`.
   * The page's own banner, replacing Designer's `SiteHeader` entirely, for a
   * consumer that carries its own site chrome. When given (including `null`,
   * which renders no banner) it is rendered as-is in place of the header: it
   * should hold the page's one banner landmark, and `brand`, `nav`,
   * `headerAction`, `headerSecondaryAction` and `ground` are not used for the header.
   * `brand` is not rendered while `header` is given.
   * When `undefined`, the Designer header renders as before.
   */
  header?: ReactNode;
  /**
   * @deprecated Chrome belongs to `SiteFrame`; see `brand`.
   * The page's own footer, replacing Designer's `SiteFooter` entirely. When
   * given (including `null`, which renders no footer) it is rendered as-is
   * and should hold the page's one contentinfo landmark; `footerSecondary`
   * is not used. When `undefined`, the Designer footer renders as before.
   */
  footer?: ReactNode;
  /**
   * @deprecated Chrome belongs to `SiteFrame`; see `brand`.
   * The `id` of the page's `<main>`, so a skip link rendered by the host (its
   * own chrome) can target it. When set to a non-empty string, `<main>` gets
   * that `id` and `tabIndex={-1}` so the link can move focus there. When
   * `undefined` (or empty) the markup is unchanged: no `id`, no `tabindex`.
   */
  mainId?: string;
  /**
   * @deprecated Chrome belongs to `SiteFrame`; see `brand`.
   * Optional text-only label naming the surface, such as "admin" or "demo",
   * shown as a non-interactive badge at the trailing end of the page banner.
   * A member host omits it. Superseded by environment links: pass one
   * Designer `SiteHeader.ActionLink` per environment in `headerAction`, with
   * `isCurrent` on this page's environment. Kept for existing callers.
   */
  surfaceLabel?: string;
  /** @deprecated Chrome belongs to `SiteFrame`; see `brand`. The primary navigation, rendered in the banner beside the brand. Absent from the markup when omitted. */
  nav?: ReactNode;
  /**
   * @deprecated Chrome belongs to `SiteFrame`; see `brand`.
   * The banner's call to action (`SiteHeader`'s `actions`), such as one
   * `SiteHeader.ActionLink` per environment. Absent from the markup when
   * omitted.
   */
  headerAction?: ReactNode;
  /**
   * @deprecated Chrome belongs to `SiteFrame`; see `brand`.
   * A secondary call to action in the banner, rendered just before
   * `headerAction` (`SiteHeader`'s `secondaryAction`). Named apart from
   * `secondaryAction`, which on this view has always been the lines below
   * the card. Absent from the markup when omitted.
   */
  headerSecondaryAction?: ReactNode;
  /**
   * @deprecated Chrome belongs to `SiteFrame`; see `brand`.
   * The plate of the header and footer, passed to both `SiteHeader` and
   * `SiteFooter`.
   * @default "base"
   */
  ground?: SiteChromeGround;
  /**
   * The page's own name - the words for sign-in, account creation,
   * password reset, or verification. Renders as the page's `<h1>` in the
   * shared page layout's title block (`PageLayoutHeader`), above the card.
   * Copy is the caller's; this view has no mode that picks a heading.
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
   * `notes` (`secondaryAction` is its deprecated alias), which sits outside the
   * fieldset and stays enabled.
   * When false or absent, `form` renders as given with no wrapper, so
   * switching the prop remounts the form: keep what the person typed in the
   * site's own state, not inside the form's uncontrolled inputs.
   */
  isDisabled?: boolean;
  /**
   * The notes block below the card: the alternate-step lines, rendered below the card and above the
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
  notes?: ReactNode;
  /**
   * @deprecated Use `notes`. The same slot under its earlier name, rendered
   * in the same place; passing both throws.
   */
  secondaryAction?: ReactNode;
  /**
   * Slot for a short legal line under the card and above the site footer.
   */
  footnote?: ReactNode;
  /**
   * @deprecated Chrome belongs to `SiteFrame`; see `brand`.
   * Persistent footer content, rendered by Designer's `SiteFooter`. On an
   * auth page this holds a legal row only - Designer's `SiteFooter.Legal`,
   * copyright at one end and legal links at the other - never a locale
   * switcher: auth pages are single-locale. The minimum links are privacy and
   * terms, as same-host routes (for example `/privacy` and `/terms`) so a
   * visitor is not sent off the host mid sign-in. This view supplies no
   * default links and no copy.
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
 * Inside a `SiteFrame` (the default, with no chrome prop) it renders its
 * content only, landmark-free, under the frame's single `<main>`. With any
 * deprecated chrome prop it renders the legacy page, whose shell is
 * Designer's, in order: `SiteHeader`, then the page layout every
 * front-door view shares (see `PageLayout`) - the header block
 * (heading and description), the body block (`Card` around the form slot)
 * and the notes block (`notes`, below the card) - then the footnote,
 * `SiteFooter`. There is no `mode` prop. A step
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
  nav,
  headerAction,
  headerSecondaryAction,
  header,
  footer,
  mainId,
  ground,
  heading,
  description,
  form,
  notes,
  secondaryAction,
  footnote,
  isDisabled,
  footerSecondary,
  className,
  style,
  ...restWithStray
}: AuthViewProps) {
  // `internalNote` was removed from this view. A host still spreading it
  // would otherwise see the key land on the root element, so drop it for
  // this release.
  const { internalNote: _strayInternalNote, ...rest } = restWithStray as typeof restWithStray & { internalNote?: unknown };
  if (notes !== undefined && secondaryAction !== undefined) {
    throw new Error("AuthView takes notes or its deprecated name secondaryAction, not both.");
  }
  const notesBlock = notes ?? secondaryAction;
  const content = (
    <>
      <PageLayout title={heading} subtitle={description} notes={notesBlock}>
        {isDisabled ? (
          <fieldset disabled className="m-0 min-w-0 border-0 p-0">
            {form}
          </fieldset>
        ) : (
          form
        )}
      </PageLayout>
      {footnote ? <p className="text-center text-body-s text-ink-muted">{footnote}</p> : null}
    </>
  );

  const legacyChrome = usesLegacyChrome({ brand, surfaceLabel, nav, headerAction, headerSecondaryAction, header, footer, mainId, ground, footerSecondary });
  if (!legacyChrome) {
    assertViewContentRoot("AuthView", rest);
    return (
      <div
        {...rest}
        className={mergeUiClasses(PAGE_COLUMN_CLASSES, className)}
        style={pageColumnStyle("form", style)}
      >
        {content}
      </div>
    );
  }

  const chromeGround = ground ?? "base";
  return (
    <div {...rest} className={mergeUiClasses("flex min-h-dvh flex-col", className)} style={style}>
      {header !== undefined ? (
        header
      ) : (
        <SiteHeader
          ground={chromeGround}
          brand={brand}
          nav={nav}
          secondaryAction={headerSecondaryAction}
          actions={headerAction}
          surfaceLabel={surfaceLabel}
        />
      )}
      <main
        id={mainId || undefined}
        tabIndex={mainId ? -1 : undefined}
        className={PAGE_COLUMN_CLASSES}
        style={pageColumnStyle("form")}
      >
        {content}
      </main>
      {footer !== undefined ? footer : <SiteFooter ground={chromeGround} secondary={footerSecondary} />}
    </div>
  );
}
