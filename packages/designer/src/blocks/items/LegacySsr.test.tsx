import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FeatureGrid } from "../FeatureGrid.js";
import { NavGrid } from "../NavGrid.js";
import { LinkGrid } from "../LinkGrid.js";
import { CardGrid } from "../CardGrid.js";
import { TopicList } from "../TopicList.js";
import { ContentSection } from "../ContentSection.js";
import fixtures from "./legacy-ssr.test.json";

const blocks = { FeatureGrid, NavGrid, LinkGrid, CardGrid, TopicList, ContentSection };
function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (typeof record.$tag === "string") return createElement(record.$tag, record.props as object, decode(record.children) as ReactNode);
  return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, key === "onSelect" ? () => {} : decode(child)]));
}

describe("literal SSR captured before consolidation", () => {
  it.each(fixtures)("preserves $name", ({ block, props, html, error }) => {
    const Component = blocks[block as keyof typeof blocks];
    const render = () => renderToStaticMarkup(createElement(Component as unknown as (props: object) => ReactNode, decode(props) as object));
    if (error !== undefined) expect(render).toThrow(error);
    else expect(render()).toBe(html);
  });
});
