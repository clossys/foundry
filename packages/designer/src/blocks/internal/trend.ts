/** Shared semantic trend ink; each caller supplies its own authored direction text. */
export const TREND_TEXT_CLASSES: Record<"up" | "down" | "neutral", string> = {
  up: "text-status-success-text",
  down: "text-status-danger-text",
  neutral: "text-ink-secondary",
};
