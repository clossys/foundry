"use client";

import { useEffect, useState } from "react";
import { TOKENS } from "../tokens/tokens.js";

export type StudioLayout = "wide" | "medium" | "narrow";

const query = (token: "--breakpoint-tablet-lg" | "--breakpoint-desktop"): string => `(width >= ${TOKENS[token]!.value})`;

/** Wide from the desktop breakpoint, medium from tablet-lg, narrow below. Wide when the browser cannot match media. */
export function useStudioLayout(): StudioLayout {
  const [layout, setLayout] = useState<StudioLayout>("wide");
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const desktop = window.matchMedia(query("--breakpoint-desktop"));
    const tablet = window.matchMedia(query("--breakpoint-tablet-lg"));
    const update = (): void => setLayout(desktop.matches ? "wide" : tablet.matches ? "medium" : "narrow");
    update();
    desktop.addEventListener("change", update);
    tablet.addEventListener("change", update);
    return () => { desktop.removeEventListener("change", update); tablet.removeEventListener("change", update); };
  }, []);
  return layout;
}
