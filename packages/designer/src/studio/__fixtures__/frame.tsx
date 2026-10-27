import type { ReactNode } from "react";
import { render as renderView, waitFor } from "@testing-library/react";
import { FrameSlotProvider, FrameSlotOutlet } from "../../shell/FrameSlots.js";
import { FrameNoticeProvider } from "../../frames/frame-notices.js";

/** Real frame registration and portal hosts, without testing frame geometry here. */
function TestFrame({ children }: { children: ReactNode }) {
  return <FrameSlotProvider><FrameNoticeProvider>{children}</FrameNoticeProvider><FrameSlotOutlet slot="dock-tab" /><FrameSlotOutlet slot="dock-strip" /><FrameSlotOutlet slot="right-panel" /></FrameSlotProvider>;
}
export function render(children: ReactNode) { return renderView(children, { wrapper: TestFrame }); }
/**
 * DESIGNER-RO: the removed save status ("saved") used to be the loaded signal. A value canvas mounts its candidate
 * style sheet, and a contract canvas its library boards, only once the library has loaded, so either marks the same
 * moment without any save state.
 */
export const studioReady = (timeout = 15_000) => waitFor(() => { if (!document.querySelector("style[data-studio-candidates], section[data-library-board]")) throw new Error("Studio library not loaded"); }, { timeout });
