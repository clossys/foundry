"use client";
import { cloneElement, useEffect, useId, useState, type ComponentType, type ReactElement, type ReactNode } from "react";
import { createToastScope, type ToastVariant } from "../shell/internal/toast-queue.js";
import { Button } from "../components/index.js";

type Specimen = ReactElement<Record<string, unknown>>;

/**
 * The vendored shadcn@aria Dialog's own `DialogContent` part, open in place in the specimen cell. It is the inner
 * react-aria-components Dialog that `Dialog` wraps in ModalOverlay and Modal, so drawing it never locks page scroll,
 * makes the rest of Studio inert or contains focus. The host is positioned so the part's close button stays in the cell.
 * A Foundry Button, labelled with the sample's trigger, opens the vendored `Dialog` itself, the real modal, controlled through its own `isOpen` and
 * `onOpenChange` props; it is mounted only while open, so the idle cell stays contained.
 */
function ContainedDialog({ Content, trigger, specimen }: { readonly Content: ComponentType<Record<string, unknown>>; readonly trigger: string; readonly specimen: Specimen }) {
  const [open, setOpen] = useState(false);
  return <div data-specimen-contained-host="dialog" className="relative">
    <Content {...specimen.props} />
    <Button variant="secondary" onPress={() => setOpen(true)}>{trigger}</Button>
    {open ? cloneElement(specimen, { isOpen: true, onOpenChange: setOpen }) : null}
  </div>;
}

export const containedDialog = (Content: ComponentType<Record<string, unknown>>, trigger: string) => (specimen: ReactNode): ReactNode =>
  <ContainedDialog Content={Content} trigger={trigger} specimen={specimen as Specimen} />;

interface ToastSample { readonly trigger: string; readonly toast: Readonly<Record<string, unknown>> }

/**
 * The shell Toaster in its `container` placement, drawing the toasts of a sonner Toaster id owned by this cell, so
 * they render in place and never reach the app-wide Toaster the page's own Toaster draws. The scoped toast function
 * comes from the shell's own toast-queue module (state plumbing, not a render primitive). The sample toast is added
 * once on mount so the idle cell shows it; a Foundry Button adds it again after it is dismissed through its own close
 * button.
 */
function ContainedToaster({ sample, specimen }: { readonly sample: ToastSample; readonly specimen: Specimen }) {
  const toasterId = `specimen-${useId()}`;
  const [scope] = useState(() => createToastScope(toasterId));
  const show = () => {
    const { title, description, variant } = sample.toast as { title: ReactNode; description?: ReactNode; variant: ToastVariant };
    const add = variant === "danger" ? scope.error : scope[variant];
    return add(title, { description, timeout: null });
  };
  useEffect(() => {
    const shown = show();
    return () => shown.dismiss();
  }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps -- the sample is fixed for the cell's lifetime
  return <div data-specimen-contained-host="toast" className="relative">
    <Button variant="secondary" onPress={show}>{sample.trigger}</Button>
    {cloneElement(specimen, { toasterId, placement: "container" })}
  </div>;
}

export const containedToaster = (sample: ToastSample) => (specimen: ReactNode): ReactNode =>
  <ContainedToaster sample={sample} specimen={specimen as Specimen} />;
