import { createRoot } from "react-dom/client";
import { PublisherCompositionsView } from "../PublisherCompositionsView.js";
import type { CompositionsConsumerLibrary } from "../PublisherCompositionsView.js";

/** Deliberately empty: offers remain visible without inventing consumer adoption. */
export const emptyLibrary: CompositionsConsumerLibrary = { id: "example", role: "consumer", instances: [], resolveFill: () => undefined };
createRoot(document.getElementById("root")!).render(<PublisherCompositionsView library={emptyLibrary} designerHref="#designer"
  breakpointValues={{ "tokens.breakpoint.mobile": 375, "tokens.breakpoint.mobile-lg": 480, "tokens.breakpoint.tablet": 768, "tokens.breakpoint.tablet-lg": 1024, "tokens.breakpoint.desktop": 1280, "tokens.breakpoint.wide": 1440 }} />);
