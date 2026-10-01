import { useId, type CSSProperties, type ReactNode } from "react";
import { Button } from "../atoms/Button.js";
import { cx } from "../atoms/internal/cx.js";

export interface ConsentBannerProps {
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
  /** Slot rendered after the body, typically a `Link` atom to a policy page. */
  privacyLink?: ReactNode;
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
 * flow, so the page stays usable around it. The root carries
 * `data-consent-banner` so a consumer can pass it as an overlay selector
 * (`overlayIntersectingFold`) when positioning it over the page.
 */
export function ConsentBanner({
  title,
  body,
  acceptLabel,
  rejectLabel,
  onAccept,
  onReject,
  privacyLink,
  className,
  style,
}: ConsentBannerProps) {
  const titleId = useId();
  return (
    <section
      data-consent-banner=""
      aria-labelledby={titleId}
      style={style}
      className={cx(
        "flex flex-col gap-md rounded-control border border-overlay-border bg-overlay-surface p-lg text-body text-ink-primary tablet:flex-row tablet:items-center tablet:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-xs tablet-lg:max-w-display wide:max-w-display">
        <h2 id={titleId} className="text-h3 font-display text-ink-primary">
          {title}
        </h2>
        <div className="text-body-s text-ink-secondary">{body}</div>
        {privacyLink != null && privacyLink !== false ? <div className="text-body-s">{privacyLink}</div> : null}
      </div>
      <div className="flex flex-col gap-sm tablet:shrink-0 tablet:flex-row">
        <Button variant="secondary" size="md" className="w-full tablet:w-auto" onPress={() => onAccept()}>
          {acceptLabel}
        </Button>
        <Button variant="secondary" size="md" className="w-full tablet:w-auto" onPress={() => onReject()}>
          {rejectLabel}
        </Button>
      </div>
    </section>
  );
}
