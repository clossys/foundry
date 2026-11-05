"use client";
import { createContext, useContext, type ReactNode } from "react";
import { resolveShellCopy, type ShellCopyRef, type ShellCopyResolver } from "./Banner.copy.js";

const ShellCopyContext = createContext<ShellCopyResolver | undefined>(undefined);
/** Wrap the shell and its runtime renderers; the host supplies the configured Writer resolver. */
export function ShellCopyProvider({ resolver, children }: { resolver?: ShellCopyResolver; children: ReactNode }) {
  const inherited = useContext(ShellCopyContext);
  return <ShellCopyContext.Provider value={resolver ?? inherited}>{children}</ShellCopyContext.Provider>;
}
export function useShellCopy(explicit?: ShellCopyResolver): (ref: ShellCopyRef, values?: ShellCopyRef["values"]) => string {
  const inherited = useContext(ShellCopyContext), resolver = explicit ?? inherited;
  return (ref, values) => resolveShellCopy(resolver, ref, values);
}
