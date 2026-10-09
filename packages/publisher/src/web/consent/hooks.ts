"use client";

import { useContext } from "react";
import { ConsentContext } from "./context.js";
import { NO_DECISION_STATUS } from "./ports.js";
import type { ConsentStatusView } from "./ports.js";

/**
 * Whether analytics may run: `required`, a non-simulated lifecycle that
 * reports allowed, and no active review-seam value. `false` outside a
 * `ConsentExperience`, on the server and on the first client render.
 */
export function useAnalyticsAllowed(): boolean {
  return useContext(ConsentContext)?.allowed === true;
}

/** The current consent status, or the no-decision status outside a `ConsentExperience`. */
export function useConsentStatus(): ConsentStatusView {
  return useContext(ConsentContext)?.status ?? NO_DECISION_STATUS;
}
