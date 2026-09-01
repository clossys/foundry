import { cx } from "../atoms/internal/cx.js";
import type { FaqHeadingLevel, FaqProps } from "./Faq.js";
import { SECTION_GROUND_CLASSES } from "./section-ground.js";

/**
 * The React-server-safe FAQ implementation. Native `details`/`summary`
 * preserves independent, keyboard-operable disclosure behavior without
 * reaching the client-only React Aria graph. The ordinary blocks barrel keeps
 * exporting the React Aria implementation from `Faq.tsx`; only
 * `@clossys/designer/blocks/server` selects this implementation.
 */
export function Faq({
  eyebrow,
  heading,
  description,
  items,
  headingLevel = 2,
  ground = "base",
  className,
  style,
  ...rest
}: FaqProps) {
  const HeadingTag = `h${headingLevel}` as `h${FaqHeadingLevel}`;
  const colors = SECTION_GROUND_CLASSES[ground];
  const hasHeadingRegion = eyebrow !== undefined || heading !== undefined || description !== undefined;

  return (
    <div {...rest} className={cx("flex flex-col gap-lg", colors.surface, className)} style={style}>
      {hasHeadingRegion ? (
        <div className="flex flex-col gap-xs">
          {eyebrow ? <p className={cx("text-caption uppercase tracking-label", colors.muted)}>{eyebrow}</p> : null}
          {heading ? (
            <HeadingTag className={cx("text-h2 font-display", colors.primary)}>{heading}</HeadingTag>
          ) : null}
          {description ? <p className={cx("text-body", colors.secondary)}>{description}</p> : null}
        </div>
      ) : null}
      <div className="flex flex-col">
        {items.map((item, index) => (
          <details
            key={item.id}
            className={cx("flex flex-col", index > 0 ? cx("border-t pt-xs", colors.border) : undefined)}
          >
            <summary className={cx("w-full cursor-pointer rounded-default py-sm text-left text-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent", colors.primary)}>
              {item.question}
            </summary>
            <div className={cx("pl-lg text-body-s", colors.secondary)}>{item.answer}</div>
          </details>
        ))}
      </div>
    </div>
  );
}
