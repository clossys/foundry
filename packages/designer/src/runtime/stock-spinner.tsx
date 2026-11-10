import * as React from "react";
type StockSpinner = typeof import("../components/spinner/spinner.js");
const loadStock = (): Promise<StockSpinner> => import("../components/spinner/spinner.js");
// The stock shadcn@aria Spinner draws lucide-react's Loader2Icon, a client
// module (it reads a React context). Every renderer with createContext loads it
// while this module evaluates, so markup stays synchronous and identical. A
// react-server graph never evaluates it here: it keeps a deferred boundary,
// which an RSC bundler turns into the stock module's client reference.
const loaded: StockSpinner | undefined = typeof React.createContext === "function" ? await loadStock() : undefined;

/** Server-safe path to the unmodified stock Spinner. */
export const Spinner: StockSpinner["Spinner"] = loaded?.Spinner
  ?? (React.lazy(async () => ({ default: (await loadStock()).Spinner })) as unknown as StockSpinner["Spinner"]);
