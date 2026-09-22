/**
 * Compiles a consumer `defineWebTemplate` `blocks` declaration into the
 * internal `build` function `renderWebDocument` already expects. Shipped
 * views keep hand-authored `build` functions in `webTemplates.ts`; only
 * consumer templates go through this path.
 */

import type { ReactNode } from "react";
import { createElement } from "react";
import { Card } from "@clossys/designer/atoms/server";
import { MarketingChapter, PageHeader, Stat } from "@clossys/designer/blocks/server";
import type { ResolvedWebGroupItem, WebTemplateBlockSpec } from "../types.js";

function firstResolvedValue(item: ResolvedWebGroupItem): ReactNode | undefined {
  if (item.text !== undefined) return item.text;
  if (item.element !== undefined) return item.element;
  if (item.node !== undefined) return item.node as ReactNode;
  return undefined;
}

function renderBlock(
  block: WebTemplateBlockSpec,
  content: Record<string, ReactNode>,
  groups: Record<string, ResolvedWebGroupItem[]>,
): ReactNode {
  switch (block.kind) {
    case "page-header":
      return createElement(PageHeader, {
        title: content[block.title],
        ...(block.description === undefined ? {} : { description: content[block.description] }),
      });
    case "marketing-chapter":
      return createElement(
        MarketingChapter,
        {
          title: content[block.title],
          ...(block.description === undefined ? {} : { description: content[block.description] }),
        },
        block.body === undefined ? null : content[block.body],
      );
    case "node-chapter":
      return createElement(
        MarketingChapter,
        {
          title: block.title === undefined ? createElement("span", { className: "sr-only" }, "Widget") : content[block.title],
          ...(block.description === undefined ? {} : { description: content[block.description] }),
        },
        createElement(Card, { className: "p-lg" }, content[block.node]),
      );
    case "stat-grid":
      return createElement(
        "div",
        { className: "grid gap-lg tablet:grid-cols-2" },
        (groups[block.repeating] ?? []).map((item) =>
          createElement(Stat, {
            key: item.index,
            label: createElement("span", { className: "sr-only" }, `Stat ${item.index + 1}`),
            value: firstResolvedValue(item),
          }),
        ),
      );
    case "copy-footer":
      return content[block.copy] === undefined
        ? null
        : createElement("footer", { className: "text-body-s text-ink-secondary" }, content[block.copy]);
    default:
      return null;
  }
}

export function compileConsumerTemplateBlocks(blocks: readonly WebTemplateBlockSpec[]): (
  content: Record<string, ReactNode>,
  groups: Record<string, ResolvedWebGroupItem[]>,
) => ReactNode {
  const frozen = [...blocks];
  return (content, groups) =>
    createElement("main", { className: "mx-auto flex w-full flex-col gap-xl px-lg py-2xl" }, ...frozen.map((block) => renderBlock(block, content, groups)));
}
