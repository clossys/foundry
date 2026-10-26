import type { UsageSummaryProps } from "../UsageSummary.js";

/** Fixed board-preview content: host-formatted quantities against plan limits. */
export const usageSummarySample: UsageSummaryProps = {
  "aria-label": "Plan usage",
  meters: [
    { id: "usage-requests", label: "API requests", used: 8420, limit: 10000, usedText: "8,420 requests", limitText: "of 10,000", periodText: "Resets 1 April", thresholds: [{ at: 0.8, tone: "warning", message: "You have used at least 80 percent of this limit." }] },
    { id: "usage-seats", label: "Seats", used: 12, limit: 25, usedText: "12 seats", limitText: "of 25", periodText: "Current plan" },
    { id: "usage-storage", label: "Storage", used: 41, limit: 100, usedText: "41 GB", limitText: "of 100 GB", periodText: "Current plan" },
  ],
  emptyState: { title: "No metered usage", description: "This plan has no usage limits." },
};
