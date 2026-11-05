"use client";
import { cloneElement, useState, type ComponentType, type ReactElement, type ReactNode } from "react";
import { createToastQueue } from "../shell/internal/toast-queue.js";
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
 * The shell Toaster in its `container` placement, drawing a queue owned by this cell, so its toasts render in
 * place and never reach the app-wide queue the page's own Toaster draws. The queue comes from the shell's own
 * toast-queue module (state plumbing, not a render primitive). The sample toast is queued once on mount so the idle
 * cell shows it; a Foundry Button queues it again after it is dismissed through its own close button.
 */
function ContainedToaster({ sample, specimen }: { readonly sample: ToastSample; readonly specimen: Specimen }) {
  const [queue] = useState(() => {
    const cellQueue = createToastQueue<Readonly<Record<string, unknown>>>(1);
    cellQueue.add({ ...sample.toast });
    return cellQueue;
  });
  return <div data-specimen-contained-host="toast">
    <Button variant="secondary" onPress={() => queue.add({ ...sample.toast })}>{sample.trigger}</Button>
    {cloneElement(specimen, { queue, placement: "container" })}
  </div>;
}

export const containedToaster = (sample: ToastSample) => (specimen: ReactNode): ReactNode =>
  <ContainedToaster sample={sample} specimen={specimen as Specimen} />;
