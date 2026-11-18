import * as React from "react";
import type { InteractiveBackdrop as InteractiveBackdropComponent } from "./InteractiveBackdrop.js";
type ClientBoundary = typeof import("./InteractiveBackdrop.js");
const loadClient = (): Promise<ClientBoundary> => import("./InteractiveBackdrop.js");
// Server-safe facade for the shipped interactive backdrops (foundry-build-0048 A4).
// They animate with client hooks, so the server graph (Hero via blocks/server.js)
// must never evaluate them. A renderer with createContext loads the client module
// while this module evaluates and renders it synchronously; a react-server graph
// keeps a deferred boundary that an RSC bundler turns into its client reference.
const loaded: ClientBoundary | undefined = typeof React.createContext === "function" ? await loadClient().catch(() => undefined) : undefined;
export const InteractiveBackdrop: typeof InteractiveBackdropComponent = loaded?.InteractiveBackdrop
  ?? (React.lazy(async () => ({ default: (await loadClient()).InteractiveBackdrop })) as unknown as typeof InteractiveBackdropComponent);
