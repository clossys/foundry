"use client";

import type { ReactNode } from "react";
import { HeadingContext } from "react-aria-components";

/** Sets the selected trigger's React Aria Heading level through React Aria's own context; the stock part stays unmodified. */
export function DisclosureHeadingLevel({ level = 3, children }: { level?: 3 | 4; children: ReactNode }) {
  return <HeadingContext.Provider value={{ level }}>{children}</HeadingContext.Provider>;
}
