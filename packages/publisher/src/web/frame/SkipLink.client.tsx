"use client";

import { SkipLink } from "@clossys/designer/shell/server";

/**
 * Client island around Designer's `SkipLink`, whose click handler moves focus
 * to the target. Under React Server Components a server-rendered frame cannot
 * hand a function to a DOM element, so the handler lives here and the frame
 * passes only strings.
 */
export function SiteSkipLink({ targetId, label }: { readonly targetId: string; readonly label: string }) {
  return <SkipLink targetId={targetId}>{label}</SkipLink>;
}
