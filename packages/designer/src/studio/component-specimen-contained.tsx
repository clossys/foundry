"use client";
import { cloneElement, useState, type ComponentType, type ReactElement, type ReactNode } from "react";
import { Button } from "../components/index.js";

type Specimen = ReactElement<Record<string, unknown>>;

/**
 * The vendored shadcn@aria Dialog's own `DialogContent` part, open in place in the specimen cell. It is the inner
 * react-aria-components Dialog that `Dialog` wraps in ModalOverlay and Modal, so drawing it never locks page scroll,
 * makes the rest of Studio inert or contains focus. The host is positioned so the part's close button stays in the cell.
 * A Foundry Button opens the vendored `Dialog` itself, the real modal, controlled through its own `isOpen` and
 * `onOpenChange` props; it is mounted only while open, so the idle cell stays contained.
 */
function ContainedDialog({ Content, specimen }: { readonly Content: ComponentType<Record<string, unknown>>; readonly specimen: Specimen }) {
  const [open, setOpen] = useState(false);
  return <div data-specimen-contained-host="dialog" style={{ position: "relative" }}>
    <Content {...specimen.props} />
    <Button variant="secondary" onPress={() => setOpen(true)}>Open dialog</Button>
    {open ? cloneElement(specimen, { isOpen: true, onOpenChange: setOpen }) : null}
  </div>;
}

export const containedDialog = (Content: ComponentType<Record<string, unknown>>) => (specimen: ReactNode): ReactNode =>
  <ContainedDialog Content={Content} specimen={specimen as Specimen} />;
