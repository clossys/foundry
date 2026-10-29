import type { ReactNode } from "react";

/** Bare media keeps the caller's existing box and its intrinsic geometry. */
export function ChromeBare({ children }: { children: ReactNode }) {
  return children;
}
