"use client";
import type { ComponentType, ReactElement, ReactNode } from "react";

/**
 * The vendored shadcn@aria Dialog's own `DialogContent` part, open in place in the specimen cell. It is the inner
 * react-aria-components Dialog that `Dialog` wraps in ModalOverlay and Modal, so drawing it never locks page scroll,
 * makes the rest of Studio inert or contains focus. The host is positioned so the part's close button stays in the cell.
 */
export const containedDialog = (Content: ComponentType<Record<string, unknown>>) => (specimen: ReactNode): ReactNode =>
  <div data-specimen-contained-host="dialog" style={{ position: "relative" }}><Content {...(specimen as ReactElement<Record<string, unknown>>).props} /></div>;
