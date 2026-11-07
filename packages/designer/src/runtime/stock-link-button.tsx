import * as React from "react";
type StockButton = typeof import("../components/preview-runtime/components/button/button.js");
const loadStock = (): Promise<StockButton> => import("../components/preview-runtime/components/button/button.js");
// The stock shadcn@aria LinkButton is a client module (react-aria Link). Every
// renderer with createContext loads it while this module evaluates, so markup
// stays synchronous and identical. A react-server graph never evaluates it here:
// it keeps a deferred boundary, which an RSC bundler turns into the stock
// module's client reference, so importing a server frame stays safe.
const loaded: StockButton | undefined = typeof React.createContext === "function" ? await loadStock() : undefined;

/** Server-safe path to the unmodified stock LinkButton. */
export const LinkButton: StockButton["LinkButton"] = loaded?.LinkButton
  ?? (React.lazy(async () => ({ default: (await loadStock()).LinkButton })) as unknown as StockButton["LinkButton"]);
