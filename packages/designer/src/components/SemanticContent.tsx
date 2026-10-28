import { createElement, forwardRef, type ComponentPropsWithoutRef, type ComponentPropsWithRef, type ReactElement } from "react";

const tags = ["article", "aside", "code", "dd", "div", "dl", "dt", "h1", "h2", "h3", "h4", "h5", "h6", "header", "nav", "li", "main", "p", "section", "small", "span", "strong", "time", "ul"] as const;

/** Neutral content elements; interactive controls and document roots are separate capabilities. */
export type SemanticContentTag = typeof tags[number];

/** The explicit tag determines the native attributes and ref target. No tag is implicit. */
export type SemanticContentProps<T extends SemanticContentTag = SemanticContentTag> = T extends SemanticContentTag
  ? { as: T } & Omit<ComponentPropsWithRef<T>, "as">
  : never;

type ContentWithoutRef = { [T in SemanticContentTag]: { as: T } & ComponentPropsWithoutRef<T> }[SemanticContentTag];

/** Renders one native element with caller-owned content, attributes and presentation. */
export const SemanticContent = forwardRef<HTMLElement, ContentWithoutRef>(function SemanticContent({ as, ...props }, ref) {
  if (!tags.includes(as)) throw new TypeError("SemanticContent requires a supported explicit tag");
  return createElement<Record<string, unknown>>(as, { ...props, ref });
}) as <T extends SemanticContentTag>(props: SemanticContentProps<T>) => ReactElement | null;
