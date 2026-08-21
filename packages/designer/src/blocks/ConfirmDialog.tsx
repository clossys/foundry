import type { ReactNode } from "react";
import { Button } from "../atoms/Button.js";
import { Dialog, type DialogProps } from "../atoms/Dialog.js";

export type ConfirmDialogTone = "neutral" | "destructive";

export interface ConfirmDialogProps extends Omit<DialogProps, "children" | "size"> {
  /** The dialog's title — rendered via `Dialog.Heading`, the same accessible-name wiring `Dialog` itself documents. */
  heading: ReactNode;
  /** The confirmation question/message body. */
  message: ReactNode;
  /**
   * The confirm button's own label. For `tone="destructive"`, name the
   * actual action ("Delete", "Remove member", "Delete account") rather than
   * leaving the generic default — see the component doc comment for why
   * this label, not the button's color, is what has to carry that meaning.
   * @default "Confirm"
   */
  confirmLabel?: ReactNode;
  /** The cancel button's own label. @default "Cancel" */
  cancelLabel?: ReactNode;
  /**
   * `"destructive"` renders the confirm action with this package's `danger`
   * `Button` variant AND moves default focus to Cancel instead of Confirm
   * — see the component doc comment for the focus reasoning. Colour is
   * never the only signal a destructive confirmation carries: the
   * confirm button's own TEXT (`confirmLabel`) is what actually names the
   * irreversible action for a colorblind reader or a screen reader, with
   * the danger color as a secondary, sighted-only reinforcement.
   * @default "neutral"
   */
  tone?: ConfirmDialogTone;
  /** Fires when Confirm is activated. The dialog closes immediately after. */
  onConfirm: () => void;
  /** Fires when Cancel is activated (not when the dialog is dismissed via Escape/outside click — see the component doc comment). The dialog closes immediately after. */
  onCancel?: () => void;
}

/**
 * A confirmation prompt built on the `Dialog` atom: a heading region, a
 * message region, and an actions region (Cancel/Confirm) — three regions
 * that always render together and differ in kind, which is what makes this
 * a block rather than an atom (see the README's "Placement rules", test 2).
 * `Dialog` itself deliberately stops short of this fixed shape — see its
 * own doc comment for exactly where its scope ends and this block's begins.
 *
 * Composable the same way `Dialog` is: a `trigger` slot (inherited from
 * `DialogProps`), open/close either uncontrolled or controlled via
 * `isOpen`/`onOpenChange` (also inherited). **No imperative `confirm()`
 * API of any kind** — that would give this a portal-independent queue and
 * an imperative call outside the render tree, which is exactly what this
 * package's README calls a runtime service (placement test 4), not a
 * layout component. A consumer renders `<ConfirmDialog trigger={...} .../>`
 * in place, the same as any other block.
 *
 * **Destructive confirmations never rely on colour alone.** `tone`
 * controls the confirm button's `danger` styling, but the ACTION label
 * (`confirmLabel`) is what actually names the irreversible action — a
 * generic "Confirm" reddened by `variant="danger"` tells a colorblind user,
 * a screen reader, or anyone on a greyscale screen nothing a sighted user
 * with color vision doesn't already get for free from the red fill alone.
 * Naming the action in `confirmLabel` ("Delete", "Remove") is what carries
 * the same meaning through every one of those channels — the same
 * reasoning `Stat`'s trend glyph/screen-reader text pairing already
 * documents for colour-coded direction, applied here to a button's label
 * instead of an icon.
 *
 * **Default focus lands on Cancel for a destructive confirmation, on
 * Confirm otherwise.** Actions render in a fixed Cancel-then-Confirm order,
 * and each `Button` requests initial dialog focus via react-aria's own
 * documented mechanism for it (`autoFocus`, which `FocusScope` honors over
 * its own default of focusing the first tabbable element) rather than
 * either button's mere DOM position. For `tone="destructive"`, an errant
 * Enter press the instant the dialog opens — a real risk for a keyboard
 * user who fired the trigger with Enter/Space and has residual "activate"
 * momentum — must land on the SAFER action, so Cancel gets it; the cost of
 * one extra keypress to actually delete something is far lower than the
 * cost of an accidental irreversible action. For the default `"neutral"`
 * tone, that risk doesn't apply (nothing is lost by confirming), so Confirm
 * gets initial focus instead — the same "Enter activates the primary
 * action" expectation an ordinary OK/Cancel dialog already sets.
 */
export function ConfirmDialog({
  trigger,
  heading,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "neutral",
  onConfirm,
  onCancel,
  className,
  style,
  ...rest
}: ConfirmDialogProps) {
  const isDestructive = tone === "destructive";

  return (
    <Dialog {...rest} trigger={trigger} size="sm" className={className} style={style}>
      {({ close }) => (
        <>
          <Dialog.Heading>{heading}</Dialog.Heading>
          <p className="text-body text-ink-secondary">{message}</p>
          <div className="flex items-center justify-end gap-sm">
            <Button
              variant="secondary"
              autoFocus={isDestructive}
              onPress={() => {
                onCancel?.();
                close();
              }}
            >
              {cancelLabel}
            </Button>
            <Button
              variant={isDestructive ? "danger" : "primary"}
              autoFocus={!isDestructive}
              onPress={() => {
                onConfirm();
                close();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
