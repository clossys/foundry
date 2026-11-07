import { useContext, type CSSProperties, type ReactNode } from "react";
import { DialogContext, ModalContext, PopoverContext, useLocale, type DialogProps, type DialogTriggerProps } from "react-aria-components";

/** A block's trigger-owned overlay props: the stock DialogTrigger state plus the surface hooks a block keeps. */
export interface OverlayTriggerProps extends Omit<DialogTriggerProps, "children"> {
  /** The element that opens the overlay; DialogTrigger wires press, aria-expanded and focus return onto it. */
  trigger?: ReactNode;
  /** `"alertdialog"` announces an interruption that needs a response and ignores a scrim press. @default "dialog" */
  role?: "dialog" | "alertdialog";
  className?: string;
  style?: CSSProperties;
}

/** The locale and reading direction the engine resolves for this subtree, for a frame that stamps them on its root. */
export function useOverlayLocale(): { readonly locale: string; readonly direction: "ltr" | "rtl" } {
  return useLocale();
}

/**
 * Hands a frame's reading direction to every modal and popover it opens: overlays
 * portal outside the frame root, so they would otherwise miss the root's `dir`.
 */
export function OverlayDirection({ dir, children }: { readonly dir: "ltr" | "rtl"; readonly children: ReactNode }) {
  return <ModalContext.Provider value={{ style: { direction: dir } }}><PopoverContext.Provider value={{ style: { direction: dir } }}>{children}</PopoverContext.Provider></ModalContext.Provider>;
}

/**
 * Names the next dialog and gives its modal the page direction and language: a
 * disclosure that controls a sheet points `aria-controls` at this id before the
 * sheet mounts.
 */
export function DialogTarget({ id, dir, lang, children }: { readonly id: string; readonly dir: "ltr" | "rtl"; readonly lang: string; readonly children: ReactNode }) {
  return <ModalContext.Provider value={{ dir, lang }}><DialogContext.Provider value={{ id }}>{children}</DialogContext.Provider></ModalContext.Provider>;
}

/**
 * Gives the stock dialog or sheet below the role its trigger cannot express. The
 * trigger's own context (overlay id, aria-labelledby) is kept; only `role` is added.
 */
export function DialogRole({ role, children }: { readonly role: "dialog" | "alertdialog"; readonly children: ReactNode }) {
  const context = useContext(DialogContext) as DialogProps | null | undefined;
  if (role === "dialog") return <>{children}</>;
  return <DialogContext.Provider value={{ ...context, role }}>{children}</DialogContext.Provider>;
}
