/** Shared narrow action ordering; consumers supply secondary actions before primary. */
export const ACTION_ROW_STACK_CLASSES = "flex flex-col items-stretch gap-sm";
export const ACTION_ROW_DIALOG_PAIR_CLASSES = "grid grid-cols-2 gap-sm tablet:flex tablet:items-center tablet:justify-end";
export const ACTION_ROW_DIALOG_STACK_CLASSES = "flex flex-col items-stretch gap-sm tablet:flex-row tablet:items-center tablet:justify-end";

/**
 * Form chooses its public end/stretch wide layout at the call site. Dialogs
 * use an equal two-action grid below tablet; longer rows stack primary last.
 * This mode is internal and is not part of any public component contract.
 */
export function actionRowClassName(mode: "form" | "dialog", actionCount: number): string {
  if (mode === "dialog") {
    return actionCount === 2 ? ACTION_ROW_DIALOG_PAIR_CLASSES : ACTION_ROW_DIALOG_STACK_CLASSES;
  }
  return ACTION_ROW_STACK_CLASSES;
}
