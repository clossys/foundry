import { TAILWIND_BREAKPOINTS } from "@clossys/designer/catalog";
import { createRoot } from "react-dom/client";
import { PublisherCompositionsView } from "../PublisherCompositionsView.js";
import type { CompositionsConsumerLibrary } from "../PublisherCompositionsView.js";

/** Deliberately empty: offers remain visible without inventing consumer adoption. */
export const emptyLibrary: CompositionsConsumerLibrary = { id: "example", role: "consumer", instances: [], resolveFill: () => undefined };
createRoot(document.getElementById("root")!).render(<PublisherCompositionsView library={emptyLibrary} designerHref="#designer"
  breakpointValues={TAILWIND_BREAKPOINTS} />);
