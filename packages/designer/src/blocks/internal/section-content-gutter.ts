import type { CSSProperties } from "react";

/** Shared inline content gutter for the frame's full-width sections. */
export const SECTION_CONTENT_STYLE = {
  paddingInline: "var(--spacing-lg)",
  boxSizing: "border-box",
  minInlineSize: 0,
  marginBlock: 0,
  overflowWrap: "anywhere",
} satisfies CSSProperties;
