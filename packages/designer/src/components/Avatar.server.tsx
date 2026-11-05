import { cx } from "./internal/cx.js";
import type { AvatarProps, AvatarSize } from "./Avatar.js";

/**
 * Shared by both `Avatar` implementations (this file and the client
 * `Avatar.tsx`), so the server and client avatars look the same. Kept
 * here, not under `internal/`, so the compiled-CSS class scan sees every
 * literal.
 *
 * No dimension token exists for a control's own affordance size (the
 * circle itself, as opposed to spacing around it) — see Checkbox and
 * Switch for the same reasoning. These are Tailwind's own built-in scale,
 * not this package's token scale, used only for this reason.
 */
export const AVATAR_SIZE_CLASSES: Record<AvatarSize, { box: string; text: string }> = {
  sm: { box: "h-6 w-6", text: "text-caption" },
  md: { box: "h-8 w-8", text: "text-body-s" },
  lg: { box: "h-10 w-10", text: "text-body" },
};

export const AVATAR_BASE_CLASSES =
  "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-pill bg-surface-sunken text-ink-secondary font-body";

export const AVATAR_IMAGE_CLASSES = "h-full w-full object-cover";

/** One or two initials from a name: first word, plus last word when there is more than one. */
export function avatarInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * The server-safe `Avatar`, re-exported as `Avatar` from
 * `@clossys/designer/components/server`. Same props, markup and accessible name
 * as the client `Avatar`, without its one hook: the client version swaps
 * to initials when the image fails to load, which needs state. Here, the
 * image renders when `src` is given and the initials render otherwise.
 * Use the client `Avatar` when an image URL may be broken.
 */
export function Avatar({ alt, src, size = "md", className, ...rest }: AvatarProps) {
  const showImage = Boolean(src);
  const { box, text } = AVATAR_SIZE_CLASSES[size];

  return (
    <span
      {...rest}
      role={showImage ? undefined : "img"}
      aria-label={showImage ? undefined : alt}
      className={cx(AVATAR_BASE_CLASSES, box, text, className)}
    >
      {showImage ? (
        <img src={src} alt={alt} className={AVATAR_IMAGE_CLASSES} />
      ) : (
        <span aria-hidden="true">{avatarInitials(alt)}</span>
      )}
    </span>
  );
}
