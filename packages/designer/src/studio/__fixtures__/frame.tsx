import type { ReactNode } from "react";
import { render as renderView } from "@testing-library/react";
import { FrameSlotProvider, FrameSlotOutlet } from "../../shell/FrameSlots.js";
import { FrameNoticeProvider } from "../../frames/frame-notices.js";

/** Real frame registration and portal hosts, without testing frame geometry here. */
function TestFrame({ children }: { children: ReactNode }) {
  return <FrameSlotProvider><FrameNoticeProvider>{children}</FrameNoticeProvider><FrameSlotOutlet slot="dock-tab" /><FrameSlotOutlet slot="dock-strip" /><FrameSlotOutlet slot="right-panel" /></FrameSlotProvider>;
}
export function render(children: ReactNode) { return renderView(children, { wrapper: TestFrame }); }
