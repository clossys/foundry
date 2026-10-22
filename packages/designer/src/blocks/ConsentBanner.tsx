import { useId, type CSSProperties, type ReactNode } from "react";
import { Icon } from "../atoms/Icon.js";
import { Check } from "../icons/Check.js";
import { Button } from "../atoms/Button.js";
import { cx } from "../atoms/internal/cx.js";

/** Card choices: full-width cells of a two-column grid, current-colour edge, no fill; labels may wrap. */
const CARD_CHOICE_CLASS = "w-full min-w-0 border border-current bg-transparent font-medium text-center whitespace-normal";

export interface ConsentBannerProps {
  /** `card` pins a compact notice; the default `banner` retains the in-flow rendering. */
  presentation?: "banner" | "card";
  /** Presentational feedback from the host's current choice; it changes no state. Card only. */
  selectedChoice?: "granted" | "denied";
  /** Heading that names the region. Rendered as an `<h2>`; the region takes its accessible name from it. */
  title: ReactNode;
  /** Supporting copy under the title. */
  body: ReactNode;
  /** Label of the accept button. */
  acceptLabel: ReactNode;
  /** Label of the reject button. Same variant and size as accept, so the two choices carry equal prominence. */
  rejectLabel: ReactNode;
  /** Called with no arguments when the accept button is pressed. */
  onAccept: () => void;
  /** Called with no arguments when the reject button is pressed. */
  onReject: () => void;
  /** Policy-link slot: after the body in a banner, inline with the body in a card. */
  privacyLink?: ReactNode;
  /**
   * Optional status line rendered inside an always-mounted polite live region
   * (`role="status"`) after the body and before the actions. The region is
   * present, and empty, whenever this is absent, so a status passed later is
   * announced. Presentation only: it never disables either action.
   */
  status?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * A presentational consent notice: a region landmark with a title, body,
 * an optional policy-link slot, and two equal-prominence buttons. It owns
 * no consent state, storage or network call — the consumer decides what
 * accepting and rejecting do, and where the banner sits.
 *
 * Not a dialog: no `role="dialog"`, no modal wiring, no autofocus, no
 * focus trap, no Escape handling, no portal and no timer. It renders in
 * flow by default; the opt-in card pins it to the viewport edge. A polite live region
 * (`role="status"`) is always mounted after the body and before the
 * actions; it is empty until a `status` is passed, and neither button is
 * ever disabled by it. The root carries
 * `data-consent-banner` so a consumer can pass it as an overlay selector
 * (`overlayIntersectingFold`) when positioning it over the page.
 */
export function ConsentBanner({
  presentation = "banner",
  selectedChoice,
  title,
  body,
  acceptLabel,
  rejectLabel,
  onAccept,
  onReject,
  privacyLink,
  status,
  className,
  style,
}: ConsentBannerProps) {
  const titleId = useId();
  const card = presentation === "card";
  return (
    <section
      data-consent-banner=""
      data-consent-presentation={card ? "card" : undefined}
      aria-labelledby={titleId}
      style={style}
      className={cx(
        card
          ? "consent-card flex flex-col gap-md rounded-control p-md tablet:p-lg text-body text-ink-primary"
          : "flex flex-col gap-md rounded-control border border-overlay-border bg-overlay-surface p-lg text-body text-ink-primary tablet:flex-row tablet:items-center tablet:justify-between",
        className,
      )}
    >
      <div className={card ? "flex min-w-0 flex-col gap-xs" : "flex min-w-0 flex-col gap-xs tablet-lg:max-w-display wide:max-w-display"}>
        <h2 id={titleId} className={card ? "sr-only" : "text-h3 font-display text-ink-primary"}>
          {title}
        </h2>
        <div className="text-body-s text-ink-secondary">
          {body}{card && privacyLink != null && privacyLink !== false ? <> {privacyLink}</> : null}
        </div>
        {!card && privacyLink != null && privacyLink !== false ? <div className="text-body-s">{privacyLink}</div> : null}
        <div role="status" aria-live="polite">
          {status != null && status !== false && status !== true ? (
            <div className="text-body-s text-ink-secondary">{status}</div>
          ) : null}
        </div>
      </div>
      <div className={card ? "grid grid-cols-2 gap-sm" : "flex flex-col gap-sm tablet:shrink-0 tablet:flex-row"}>
        <Button
          variant="secondary"
          size="md"
          className={card ? CARD_CHOICE_CLASS : "w-full tablet:w-auto"}
          aria-pressed={card ? selectedChoice === "granted" : undefined}
          onPress={() => onAccept()}
        >
          {card && selectedChoice === "granted" ? (
            <span data-consent-selected="" aria-hidden="true"><Icon glyph={Check} decorative size="sm" /></span>
          ) : null}
          {acceptLabel}
        </Button>
        <Button
          variant="secondary"
          size="md"
          className={card ? CARD_CHOICE_CLASS : "w-full tablet:w-auto"}
          aria-pressed={card ? selectedChoice === "denied" : undefined}
          onPress={() => onReject()}
        >
          {card && selectedChoice === "denied" ? (
            <span data-consent-selected="" aria-hidden="true"><Icon glyph={Check} decorative size="sm" /></span>
          ) : null}
          {rejectLabel}
        </Button>
      </div>
    </section>
  );
}
