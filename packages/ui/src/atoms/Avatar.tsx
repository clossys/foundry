import { useState } from "react";
import type { HTMLAttributes } from "react";
import { cx } from "./internal/cx.js";

export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /**
   * Required. The person or thing this avatar represents, in words — used
   * as the rendered `<img>`'s `alt` text, and to derive the initials shown
   * when there's no image (or the image fails to load). There is no
   * `children` slot: unlike `Badge`/`Card`, an avatar's content is always
   * exactly one of "this image" or "these initials," never arbitrary
   * markup, so there's nothing a slot would let a consumer do that `src`
   * plus this required name doesn't already cover.
   */
  alt: string;
  /** Image URL. Omit to always show the initials fallback. */
  src?: string;
  /** @default "md" */
  size?: AvatarSize;
}

// No dimension token exists for a control's own affordance size (the
// circle itself, as opposed to spacing around it) — see Checkbox and
// Switch for the same reasoning. These are Tailwind's own built-in scale,
// not this package's token scale, used only for this reason.
const SIZE_CLASSES: Record<AvatarSize, { box: string; text: string }> = {
  sm: { box: "h-6 w-6", text: "text-caption" },
  md: { box: "h-8 w-8", text: "text-body-s" },
  lg: { box: "h-10 w-10", text: "text-body" },
};

function initialsFrom(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * A person's (or thing's) picture, with an initials fallback when there's
 * no image, no `src` was given, or the image fails to load. Not interactive
 * and does not compose another atom — plain markup, no react-aria-components
 * primitive needed, unlike `Button` and `TextField` (see this package's
 * README) — the same reasoning as `Badge` and `Card`.
 *
 * When an image renders, it alone carries the accessible name (a real
 * `<img alt="...">`). When the initials fallback renders instead, the
 * initials text is decorative (`aria-hidden`) and the outer element carries
 * `role="img"` + `aria-label` instead — the same accessible name either way,
 * on whichever element is actually presenting it, rather than announcing
 * both at once.
 */
export function Avatar({ alt, src, size = "md", className, ...rest }: AvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(src) && !imageFailed;
  const { box, text } = SIZE_CLASSES[size];

  return (
    <span
      {...rest}
      role={showImage ? undefined : "img"}
      aria-label={showImage ? undefined : alt}
      className={cx(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-pill bg-surface-sunken text-ink-secondary font-body",
        box,
        text,
        className,
      )}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt}
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{initialsFrom(alt)}</span>
      )}
    </span>
  );
}
