import type { CSSProperties, ReactNode } from "react";
import {
  Dialog as AriaDialog,
  DialogTrigger,
  Heading as AriaHeading,
  Modal,
  ModalOverlay,
  type DialogRenderProps,
  type DialogTriggerProps as AriaDialogTriggerProps,
  type HeadingProps as AriaHeadingProps,
} from "react-aria-components";
import { cx } from "./internal/cx.js";
import { UI_ELEVATION_FLOATING, UI_Z_MODAL } from "./internal/ui-vars.js";

export type DialogSize = "sm" | "md" | "lg";

// Tailwind's own built-in max-width scale, not this package's token scale
// — the same choice `Select` already made for its popover (`min-w-40`,
// `max-h-64`): there's no token for "how wide should an overlay surface
// be", and a plain built-in class here doesn't confuse token-parity.test.ts
// (its `PREFIX_CANDIDATE_FAMILIES` doesn't include `max-w`).
const SIZE_CLASSES: Record<DialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
};

export interface DialogProps extends Omit<AriaDialogTriggerProps, "children"> {
  /**
   * The element that opens the dialog when pressed — typically a plain
   * react-aria-components `Button` (or this package's own `Button` atom;
   * see `Menu`'s own note on the same pattern). Rendered exactly as
   * given, with open/close behavior wired onto it by react-aria-components'
   * `DialogTrigger` via context.
   */
  trigger: ReactNode;
  /**
   * The dialog's own content. Include a `Dialog.Heading` somewhere inside
   * for the dialog's accessible name — see that component's own doc
   * comment for why this component doesn't take a `title` prop instead.
   * A function may be provided to reach an imperative `close()`, the same
   * shape react-aria-components' own `Dialog` children accept — useful for
   * a footer button that closes the dialog without threading `isOpen`
   * state back out to the trigger's own render site.
   */
  children: ReactNode | ((opts: DialogRenderProps) => ReactNode);
  /**
   * How wide the dialog surface is. The region set (the dialog surface,
   * its scrim) is identical at every size — only the width changes — so
   * this is a legitimate prop under this package's variant rule, not a
   * reason for `Dialog`/`DialogSmall`/`DialogLarge` to be separate
   * components.
   * @default "md"
   */
  size?: DialogSize;
  /**
   * Whether clicking outside the dialog (on the scrim) closes it. Escape
   * always closes the dialog regardless of this prop — react-aria-components'
   * own `ModalOverlay` only gates the keyboard dismiss behind a SEPARATE
   * `isKeyboardDismissDisabled` prop (not exposed here, so Escape can never
   * be silently disabled), not behind this one.
   * @default true
   */
  isDismissable?: boolean;
  /** Merged onto the dialog surface element itself. */
  className?: string;
  /** Merged onto the dialog surface element's inline style. */
  style?: CSSProperties;
  /** Merged onto the scrim/backdrop element. */
  overlayClassName?: string;
}

/**
 * A modal dialog, opened from a `trigger` element. Built on
 * react-aria-components' `DialogTrigger` + `ModalOverlay` + `Modal` +
 * `Dialog` — the overlay behavior that is easy to get subtly wrong by
 * hand: react-aria's `useModalOverlay` (underneath `Modal`/`ModalOverlay`)
 * supplies a focus trap (a `FocusScope` that `contain`s Tab/Shift+Tab
 * inside the dialog for as long as it's open), focus restoration to the
 * trigger when the dialog closes, Escape to dismiss, and a page-level
 * scroll lock (`usePreventScroll`) — none of it reimplemented here. This
 * component only supplies the token-derived visual styling on top, plus
 * `size` and the `isDismissable` passthrough.
 *
 * Composable the same way `Menu` is: a `trigger` slot plus `children` for
 * the dialog's own content, rather than a fixed `title`/`description`/
 * `actions` prop shape. That's a deliberate ceiling on this component's
 * scope — `ConfirmDialog` (a `title` + a message + Confirm/Cancel buttons)
 * is a `Dialog` composed with this package's own `Button` atom and some
 * copy, which makes IT a block (multiple named regions: a heading region,
 * a message region, an actions region — see the README's "Placement
 * rules"), not something this atom should pre-assemble. Building it is
 * deliberately left for that follow-up.
 */
function DialogRoot({
  trigger,
  children,
  size = "md",
  isDismissable = true,
  className,
  style,
  overlayClassName,
  ...rest
}: DialogProps) {
  return (
    <DialogTrigger {...rest}>
      {trigger}
      <ModalOverlay
        isDismissable={isDismissable}
        className={cx(
          "fixed inset-0 flex items-center justify-center bg-overlay-scrim p-lg",
          overlayClassName,
        )}
        style={{ zIndex: UI_Z_MODAL }}
      >
        <Modal className={cx("flex w-full", SIZE_CLASSES[size])}>
          <AriaDialog
            className={cx(
              "flex max-h-[85vh] w-full flex-col gap-md overflow-auto rounded-control border border-overlay-border bg-overlay-surface p-lg text-body text-ink-primary outline-none",
              className,
            )}
            style={{ boxShadow: UI_ELEVATION_FLOATING, ...style }}
          >
            {children}
          </AriaDialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

export interface DialogHeadingProps extends Omit<AriaHeadingProps, "className"> {
  children: ReactNode;
  className?: string;
}

/**
 * The dialog's title, and its accessible name. Wraps
 * react-aria-components' own `Heading`, rendered into the `"title"` slot
 * `Dialog` provides — react-aria's `useDialog` hook generates an id for
 * that slot and puts the SAME id on the dialog element's own
 * `aria-labelledby`, which is what actually links the two; this component
 * exists so a consumer never has to pass `slot="title"` by hand or know
 * that mechanism is there at all. This is the same reason `Menu` has no
 * `aria-label` prop of its own: the correct accessible-name path is
 * automatic here as long as `Dialog.Heading` (not a plain `Heading`) is
 * rendered somewhere inside `Dialog`'s children, and there's nothing for a
 * separate prop on `Dialog` itself to add. Omitting `Dialog.Heading`
 * entirely leaves the dialog labelled by its TRIGGER's own accessible
 * text instead — react-aria-components' documented fallback for a
 * title-less dialog, and a real fallback rather than a broken state, but
 * one that's usually wrong (it announces the button that opened the
 * dialog, not what the dialog itself is) — so every dialog with real
 * title text should render it as this component rather than lean on that
 * fallback.
 */
function DialogHeading({ children, className, level = 2, ...rest }: DialogHeadingProps) {
  return (
    <AriaHeading
      {...rest}
      // `slot="title"` (a plain native HTML `slot` attribute, not a
      // consumer-facing prop of this component) is what makes the
      // aria-labelledby wiring described above actually happen:
      // react-aria-components' `Dialog` provides `titleProps` (carrying
      // the generated id `useDialog` also puts on the dialog's own
      // `aria-labelledby`) ONLY to a `Heading` rendered with this exact
      // slot name — an unslotted `Heading` inside a `Dialog` gets no id
      // from context and is invisible to the labelling. Without it, the
      // dialog would silently fall back to labelling itself from the
      // TRIGGER's own accessible text instead (react-aria-components'
      // documented fallback for a title-less dialog) — visually
      // indistinguishable, but wrong: a screen reader would announce the
      // trigger's label ("Open settings") as the dialog's name instead of
      // this heading's own text ("Settings").
      slot="title"
      level={level}
      className={cx("text-h2 font-display text-ink-primary", className)}
    >
      {children}
    </AriaHeading>
  );
}

export const Dialog = Object.assign(DialogRoot, { Heading: DialogHeading });
