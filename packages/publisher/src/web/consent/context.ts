"use client";

import { createContext } from "react";
import type { ConsentStatusView } from "./ports.js";

/** What a `ConsentExperience` exposes to the hooks below it. */
export interface ConsentContextValue {
  allowed: boolean;
  status: ConsentStatusView;
}

/** `null` outside a `ConsentExperience`, which the hooks read as not allowed and no decision. */
export const ConsentContext = createContext<ConsentContextValue | null>(null);
