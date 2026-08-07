import type { HTMLAttributes } from "react";
import { cx } from "./internal/cx.js";

export type SkeletonShape = "text" | "block" | "circle";

export interface SkeletonProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "role"> {
  /**
   * `text` — one line of text-height placeholder (the default: a single
   * loading title, a label). `block` — fills its container's own width and
   * height (a card, an image, a chart), sized entirely by the consumer's own
   * `className`/`style`. `circle` — an `Avatar`-shaped placeholder, square
   * via `aspect-square` so a single sizing class (a `className` `h-10 w-10`,
   * say) keeps it round instead of oval.
   * @default "text"
   */
  shape?: SkeletonShape;
  /**
   * Accessible label for this ONE placeholder. Provide it only when a single
   * `Skeleton` is itself the entire signal that some region is loading (a
   * lone placeholder standing in for one value) — it then renders
   * `role="status"` and `aria-busy="true"` with this as its accessible name,
   * the same "am I the only signal" test `Spinner`'s own `label` prop uses.
   * Omit it — the default — for every OTHER `Skeleton` in a group of several
   * standing in for one loading unit (a card's title line AND its body
   * lines AND its thumbnail): each of those renders `aria-hidden="true"`
   * instead, so a screen reader isn't told about the same loading region
   * once per placeholder shape. A multi-piece loading region's OWN
   * `aria-label`/`aria-busy` announcement belongs on a wrapping element the
   * consumer already renders around the group — outside this atom's own
   * scope, the same way `PageHeader`'s `title` is a single region rather
   * than this component trying to own a whole page's loading state.
   */
  "aria-label"?: string;
}

const SHAPE_CLASSES: Record<SkeletonShape, string> = {
  text: "h-4 w-full rounded-default",
  block: "h-full w-full rounded-control",
  circle: "aspect-square rounded-pill",
};

/**
 * A loading placeholder. Plain markup — not interactive and composes no
 * other atom, the same reasoning as `Badge`/`Card`/`Avatar` (see this
 * package's README) — styled with `--color-skeleton-fill`, the token named
 * specifically for this purpose rather than a reused surface color, so a
 * brand can tune "how visible should a loading placeholder be" independent
 * of every other surface tone.
 *
 * `animate-pulse` (Tailwind's own built-in keyframe, not a token — there is
 * no motion-CURVE token family for a symmetric fade in/out the way
 * `--ease-*` covers directional enter/exit transitions) is applied
 * unconditionally: a completely static placeholder reads as inert content
 * rather than "still loading", which is the entire reason this component
 * exists instead of a plain `Card`-colored `<div>`.
 */
export function Skeleton({
  shape = "text",
  className,
  "aria-label": ariaLabel,
  ...rest
}: SkeletonProps) {
  return (
    <div
      {...rest}
      role={ariaLabel ? "status" : undefined}
      aria-label={ariaLabel}
      aria-busy={ariaLabel ? true : undefined}
      aria-hidden={ariaLabel ? undefined : true}
      className={cx("animate-pulse bg-skeleton-fill", SHAPE_CLASSES[shape], className)}
    />
  );
}
