import { cx } from "../atoms/internal/cx.js";
import type { FaqHeadingLevel, FaqProps } from "./Faq.js";

/**
 * The React-server-safe FAQ implementation. Native `details`/`summary`
 * preserves independent, keyboard-operable disclosure behavior without
 * reaching the client-only React Aria graph. The ordinary blocks barrel keeps
 * exporting the React Aria implementation from `Faq.tsx`; only
 * `@clossys/designer/blocks/server` selects this implementation.
 */
export function Faq({
  heading,
  description,
  items,
  headingLevel = 2,
  className,
  style,
  ...rest
}: FaqProps) {
  const HeadingTag = `h${headingLevel}` as `h${FaqHeadingLevel}`;
  const hasHeadingRegion = heading !== undefined || description !== undefined;

  return (
    <div {...rest} className={cx("flex flex-col gap-lg", className)} style={style}>
      {hasHeadingRegion ? (
        <div className="flex flex-col gap-xs">
          {heading ? (
            <HeadingTag className="text-h2 font-display text-ink-primary">{heading}</HeadingTag>
          ) : null}
          {description ? <p className="text-body text-ink-secondary">{description}</p> : null}
        </div>
      ) : null}
      <div className="flex flex-col">
        {items.map((item, index) => (
          <details
            key={item.id}
            className={cx("flex flex-col", index > 0 ? "border-t border-line-base pt-xs" : undefined)}
          >
            <summary className="flex w-full cursor-pointer items-center gap-sm rounded-default py-sm text-left text-body text-ink-primary outline-none">
              {item.question}
            </summary>
            <div className="pl-lg text-body-s text-ink-secondary">{item.answer}</div>
          </details>
        ))}
      </div>
    </div>
  );
}
