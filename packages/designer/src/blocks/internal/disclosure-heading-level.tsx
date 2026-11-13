import * as React from "react";
import type { ReactNode } from "react";

type ClientBoundary = typeof import("./disclosure-heading-level.client.js");
const loadClient = (): Promise<ClientBoundary> => import("./disclosure-heading-level.client.js");
// Same boundary rule as componentLeaf: a react-server graph (no createContext)
// never evaluates the React Aria client module here; it keeps the deferred
// boundary, which an RSC bundler turns into its client reference.
const loaded: ClientBoundary | undefined = typeof React.createContext === "function" ? await loadClient().catch(() => undefined) : undefined;

/** Server-safe facade for the selected trigger's heading level. */
export const DisclosureHeadingLevel: React.ElementType<{ level?: 3 | 4; children: ReactNode }> = loaded?.DisclosureHeadingLevel
  ?? React.lazy(async () => ({ default: (await loadClient()).DisclosureHeadingLevel }));
