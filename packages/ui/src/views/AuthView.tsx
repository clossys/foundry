import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Card } from "../atoms/Card.js";
import { cx } from "../atoms/internal/cx.js";

export interface AuthViewProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Slot for a product's brand mark, rendered above the card. This package
   * ships no `BrandLockup` of its own — a brand mark is per-product, the
   * same reason `Shell` ships no `SiteHeader` (see the README, "Shell" →
   * "How differing chrome is handled") — so this is a plain `ReactNode`
   * slot, not a `logo`/`logoHref` prop pair this component would have to
   * keep in sync with every product's actual mark.
   */
  brand?: ReactNode;
  /**
   * The page's own name — "Sign in", "Create your account", "Reset your
   * password". The only other required prop besides `form`. Renders as the
   * page's `<h1>`.
   */
  heading: ReactNode;
  /** A line of supporting copy under `heading`. */
  description?: ReactNode;
  /**
   * The form slot. **This component renders whatever is passed here
   * exactly as given** — no `<form>` wrapper, no submit handling, no field
   * state, no validation. Auth providers (their field set, their
   * validation rules, their submit flow) differ per product; this view's
   * whole job is to be the same shape everywhere while staying completely
   * ignorant of how sign-in actually works. See this component's own doc
   * comment below for why that boundary is one-way and non-negotiable.
   */
  form: ReactNode;
  /**
   * Slot for a secondary link below the form — "Don't have an account?
   * Sign up", "Back to sign in". Typically a `Link` atom, but any
   * `ReactNode` works, the same as every other slot here.
   */
  secondaryAction?: ReactNode;
  /**
   * Slot for legal/footnote text below the card — terms-of-service and
   * privacy-policy links, a copyright line. Rendered outside the card, the
   * same visual position a page footer occupies.
   */
  footnote?: ReactNode;
  /** Merged onto the outer element's inline style, after this component's own. */
  style?: CSSProperties;
}

/**
 * A full-page authentication shell — sign-in, sign-up, password reset,
 * email verification. A view, not a block: a page is an auth page or it
 * isn't (test 3, this package's README "Placement rules") — there is no
 * page that reasonably shows two sign-in forms side by side.
 *
 * A centered card layout with five named regions: `brand`, `heading` (+
 * optional `description`), the `form` slot, `secondaryAction`, and
 * `footnote` — composed from this package's own `Card` atom, never
 * reimplemented as a bespoke bordered `<div>`.
 *
 * **This component implements no authentication of any kind.** No
 * provider, no form state, no field validation, no submit handling — it
 * renders `form` exactly as given, the same way `Dialog` renders its
 * `trigger` and `EmptyState` renders its `action`: a slot the consumer
 * fills with their own composition, not a prop this component inspects or
 * wraps. This is deliberate and one-way: auth providers differ per
 * product (a magic link here, a password-plus-OAuth flow there, a
 * passkey flow somewhere else), and a shared UI package that tried to
 * absorb any one of them would immediately need an escape hatch for every
 * other one — the exact "variant/mode prop absorbing structural
 * differences" failure this package's README warns against, just scoped
 * to authentication instead of visual styling. Composing that shape stays
 * entirely the consumer's job; this component only supplies the page
 * chrome around it.
 *
 * Ships no `BrandLockup` — see `brand`'s own doc comment above.
 */
export function AuthView({
  brand,
  heading,
  description,
  form,
  secondaryAction,
  footnote,
  className,
  style,
  ...rest
}: AuthViewProps) {
  return (
    <div
      {...rest}
      className={cx(
        "flex min-h-dvh flex-col items-center justify-center gap-lg p-xl",
        className,
      )}
      style={style}
    >
      {brand ? <div className="flex justify-center">{brand}</div> : null}
      <Card className="flex w-full max-w-sm flex-col gap-lg">
        <div className="flex flex-col gap-xs text-center">
          <h1 className="text-h1 font-display text-ink-primary">{heading}</h1>
          {description ? (
            <p className="text-body text-ink-secondary">{description}</p>
          ) : null}
        </div>
        {form}
        {secondaryAction ? (
          <div className="text-center text-body-s text-ink-secondary">{secondaryAction}</div>
        ) : null}
      </Card>
      {footnote ? (
        <p className="text-center text-body-s text-ink-muted">{footnote}</p>
      ) : null}
    </div>
  );
}
