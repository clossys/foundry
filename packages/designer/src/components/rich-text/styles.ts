/** shadcn prose hierarchy expressed with the consumer's compiled token utilities. */
export const RICH_TEXT_CLASSES = "font-body text-body text-ink-primary";
export const RICH_TEXT_HEADINGS: Readonly<Record<number, string>> = {
  1: "mt-xl mb-md font-display text-h1 font-bold leading-heading",
  2: "mt-xl mb-md font-display text-h2 font-semibold leading-heading",
  3: "mt-lg mb-sm font-display text-h3 font-semibold leading-heading",
  4: "mt-lg mb-sm font-display text-h3 font-semibold leading-heading",
  5: "mt-lg mb-sm font-display text-h3 font-semibold leading-heading",
  6: "mt-lg mb-sm font-display text-h3 font-semibold leading-heading",
};
export const RICH_TEXT_PARAGRAPH = "my-md";
export const RICH_TEXT_BULLETS = "my-md list-disc ps-xl";
export const RICH_TEXT_ORDERED = "my-md list-decimal ps-xl";
export const RICH_TEXT_ITEM = "my-xs";
export const RICH_TEXT_QUOTE = "my-lg border-line-base ps-lg italic";
export const RICH_TEXT_PRE = "my-lg overflow-x-auto rounded-control bg-surface-sunken p-md font-mono text-code-block";
export const RICH_TEXT_CODE = "font-mono text-code-block text-ink-primary rounded-control bg-surface-sunken";
export const RICH_TEXT_CALLOUT = "my-lg border-line-base bg-surface-sunken px-lg py-md";
export const RICH_TEXT_RULE = "my-xl border-line-base";
export const RICH_TEXT_QUOTE_STYLE = { borderInlineStartWidth: "var(--ui-border-hairline)", borderInlineStartStyle: "solid" } as const;
export const RICH_TEXT_RULE_STYLE = { borderBlockStartWidth: "var(--ui-border-hairline)", borderBlockStartStyle: "solid" } as const;
