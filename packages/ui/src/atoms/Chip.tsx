import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Button as AriaButton } from "react-aria-components";
import { cx } from "./internal/cx.js";
import { UI_ALPHA_DISABLED, UI_RING_FOCUS } from "./internal/ui-vars.js";

interface ChipBaseProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children" | "style"> {
  /** The chip's label content. */
  children: ReactNode;
  /** @default false */
  isDisabled?: boolean;
  /** Merged onto the outer element's inline style. */
  style?: CSSProperties;
}

export type ChipProps = ChipBaseProps &
  (
    | {
        /** Omit entirely for a label-only chip with no remove affordance. */
        onRemove?: undefined;
        removeLabel?: string;
      }
    | {
        /** Called when the remove control is pressed. */
        onRemove: () => void;
        /**
         * Accessible name for the remove control — REQUIRED whenever
         * `onRemove` is supplied, since "Remove" alone never says WHICH
         * chip it removes to a screen reader user tabbing through several
         * at once (e.g. "Remove Engineering", not just "Remove"). Enforced
         * at the type level, not just documented: this prop is only
         * optional in the branch of `ChipProps` where `onRemove` is absent
         * too.
         */
        removeLabel: string;
      }
  );

/**
 * A removable label — distinct from `Badge`, which is purely static. Under
 * this package's own "does the variant change the SET of named regions?"
 * test (README, "Placement rules", the variant rule), `Chip` and `Badge`
 * are two different components rather than one with a `removable` prop:
 * `Badge` has exactly one region (the label); `Chip` has two — a label
 * region AND a remove-affordance region, each doing a different job — so
 * the region SET differs, the same structural difference that already
 * separates `TextField` from `Textarea` and `Checkbox` from `Switch`
 * elsewhere in this package, not a purely visual one a prop could absorb.
 *
 * Still ships as an ATOM, not a block, despite having two simultaneously-
 * visible regions: the label and the remove control are one small,
 * indivisible interactive unit (removing the chip removes the whole thing,
 * label included — there's no scenario where a consumer wants the two
 * halves independently) the same way `Checkbox`'s box + label text, or
 * `Switch`'s track + thumb + label, already stay one atom despite each
 * having multiple visually distinct parts. None of those are independently
 * composable named regions the way `PageHeader`'s title/description/
 * actions are — see "Placement rules" test 2 in the README for the
 * region-vs-repeat distinction this leans on.
 *
 * The remove control is react-aria-components' own `Button`, not this
 * package's own `Button` atom (the same "an atom composing another atom is
 * a layering violation" reasoning `Select`'s, `ComboBox`'s, and
 * `Disclosure`'s own doc comments already document) — built on it rather
 * than a plain native `<button>` (the choice `Banner`'s own dismiss control
 * makes) so the remove control gets react-aria-components' keyboard
 * (Enter/Space) and focus-visible handling for free, the same as every
 * other genuinely interactive control in this package.
 */
export function Chip({ children, onRemove, removeLabel, isDisabled = false, className, style, ...rest }: ChipProps) {
  return (
    <span
      {...rest}
      className={cx(
        "inline-flex max-w-full items-center gap-xs rounded-pill bg-surface-sunken py-xs text-caption text-ink-secondary tracking-meta",
        onRemove ? "pl-sm pr-xs" : "px-sm",
        className,
      )}
      style={{ opacity: isDisabled ? UI_ALPHA_DISABLED : undefined, ...style }}
    >
      <span className="truncate">{children}</span>
      {onRemove ? (
        <AriaButton
          onPress={onRemove}
          isDisabled={isDisabled}
          aria-label={removeLabel}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-pill text-ink-muted outline-none disabled:cursor-not-allowed"
          style={(renderProps) => ({
            boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined,
          })}
        >
          <span aria-hidden="true">×</span>
        </AriaButton>
      ) : null}
    </span>
  );
}
