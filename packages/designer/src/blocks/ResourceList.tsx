"use client";

import { useId, useState, type HTMLAttributes, type ReactNode } from "react";

import { SECTION_CONTENT_STYLE } from "./internal/section-content-gutter.js";
import { cx } from "../components/internal/cx.js";
import { UI_LAYOUT_TAP_TARGET } from "../components/internal/ui-vars.js";
import { ChevronDown } from "../icons/ChevronDown.js";
import { EmptyState, type EmptyStateProps } from "./EmptyState.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { componentLeaf } from "../runtime/component-leaf.js";

const Button = componentLeaf<typeof import("../components/Button.js").Button>("components.button");
const GridList = componentLeaf<typeof import("../components/GridList.js").GridList>("components.grid-list");
const IconButton = componentLeaf<typeof import("../components/IconButton.js").IconButton>("components.button", "IconButton");
const Menu = componentLeaf<typeof import("../components/Menu.js").Menu>("components.menu");
const Skeleton = componentLeaf<typeof import("../components/Skeleton.js").Skeleton>("components.skeleton");
const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.resource-list", "foundry/sections.resource-list");

export interface ResourceListAction {
  id: string;
  label: string;
  onAction: () => void;
  isDestructive?: boolean;
  isDisabled?: boolean;
  disabledReason?: string;
}

export interface ResourceListItem {
  id: string;
  textValue: string;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  media?: ReactNode;
  status?: ReactNode;
  href?: string;
  actions?: readonly ResourceListAction[];
  isDisabled?: boolean;
}

export interface ResourceListProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "onSelect"> {
  "aria-label": string;
  items: readonly ResourceListItem[];
  selectionMode?: "none" | "multiple";
  selectedKeys?: "all" | ReadonlySet<string>;
  onSelectionChange?: (keys: "all" | Set<string>) => void;
  selectRowLabel?: (textValue: string) => string;
  onAction?: (id: string) => void;
  actionsLabel?: (textValue: string) => string;
  isLoading?: boolean;
  loadingLabel?: string;
  loadingRowCount?: number;
  emptyState: EmptyStateProps;
  error?: ReactNode;
  toolbar?: ReactNode;
  bulkBar?: ReactNode;
  footer?: ReactNode;
}

function ResourceListActions({ item, label }: { item: ResourceListItem; label: string }) {
  const prefix = useId();
  const actions = item.actions ?? [];
  const disabled = (action: ResourceListAction) => !!(item.isDisabled || action.isDisabled);
  const reasonId = (action: ResourceListAction, index: number, slot: string) =>
    disabled(action) && action.disabledReason ? `${prefix}-${slot}-${index}` : undefined;
  const menuItems = (entries: readonly ResourceListAction[], slot: string) => entries.map((action, index) => (
    <Menu.Item key={action.id} id={action.id} textValue={action.label} aria-label={action.label}
      isDisabled={disabled(action)} isDestructive={action.isDestructive} onAction={action.onAction}
      aria-describedby={reasonId(action, index, slot)}>
      {action.label}
      {reasonId(action, index, slot) && <SemanticContent as="span" id={reasonId(action, index, slot)} className="sr-only">{action.disabledReason}</SemanticContent>}
    </Menu.Item>
  ));
  return <SemanticContent as="div" className="flex shrink-0 items-center gap-sm">
    <SemanticContent as="div" className="flex flex-wrap items-center gap-sm">
      {actions.slice(0, 2).map((action, index) => <SemanticContent as="span" key={action.id} className="inline-flex">
        <Button variant="quiet" size="sm" trailingIcon={null} className="border-0 bg-transparent" isDisabled={disabled(action)} onPress={action.onAction}
          aria-describedby={reasonId(action, index, "inline")}>{action.label}</Button>
        {reasonId(action, index, "inline") && <SemanticContent as="span" id={reasonId(action, index, "inline")} className="sr-only">{action.disabledReason}</SemanticContent>}
      </SemanticContent>)}
    </SemanticContent>
    {actions.length > 2 && <Menu trigger={<IconButton icon={ChevronDown} label={label} />}>
      {menuItems(actions.slice(2), "wide")}
    </Menu>}
  </SemanticContent>;
}

/**
 * Draft selectable records with host-owned loading, recovery, bulk and footer copy.
 * Enter activates onAction during selection. Href rows follow peer toggle semantics:
 * Enter/press route while selection is empty; during active selection, row presses
 * toggle selection without navigating.
 */
export function ResourceList({
  "aria-label": ariaLabel, items, selectionMode = "none", selectedKeys, onSelectionChange,
  selectRowLabel, onAction, actionsLabel, isLoading = false, loadingLabel, loadingRowCount = 5,
  emptyState, error, toolbar, bulkBar, footer, className, style, ...rest
}: ResourceListProps) {
  const [internalKeys, setInternalKeys] = useState<"all" | Set<string>>(new Set());
  if (!ariaLabel?.trim()) {
    throw new TypeError("ResourceList requires aria-label.");
  }
  if (selectionMode === "multiple" && !selectRowLabel) {
    throw new TypeError("ResourceList requires selectRowLabel for multiple selection.");
  }
  if (items.some(item => item.actions?.length) && !actionsLabel) {
    throw new TypeError("ResourceList requires actionsLabel when items have actions.");
  }
  if (isLoading && !loadingLabel?.trim()) {
    throw new TypeError("ResourceList requires loadingLabel while loading.");
  }
  const selection = selectedKeys ?? internalKeys;
  const hasSelection = selectionMode === "multiple" && items.some(item =>
    !item.isDisabled && (selection === "all" || selection.has(item.id)));
  return <SemanticContent as="section" {...SECTION_STAMP} {...rest} aria-label={ariaLabel} className={cx("flex min-w-0 flex-col gap-md", className)} style={{ ...SECTION_CONTENT_STYLE, ...style }}>
    {toolbar}
    {hasSelection ? bulkBar : null}
    {error != null && error !== false ? error : isLoading ? <SemanticContent as="div">
      <SemanticContent as="span" role="status" className="sr-only">{loadingLabel}</SemanticContent>
      <SemanticContent as="div" aria-hidden="true">
        {Array.from({ length: loadingRowCount }, (_, index) => <SemanticContent as="div" key={index} className="flex items-center px-0 py-sm" style={{ minBlockSize: UI_LAYOUT_TAP_TARGET }}><Skeleton /></SemanticContent>)}
      </SemanticContent>
    </SemanticContent> : items.length === 0 ? <EmptyState {...emptyState} /> : <GridList aria-label={ariaLabel} items={items} selectionMode={selectionMode}
      selectedKeys={selection === "all" ? "all" : new Set(selection)}
      onSelectionChange={keys => {
        const next = keys === "all" ? "all" : new Set([...keys].map(String));
        if (selectedKeys === undefined) setInternalKeys(next);
        onSelectionChange?.(next);
      }} onAction={onAction ? key => onAction(String(key)) : undefined}
      renderEmptyState={() => <EmptyState {...emptyState} />}>
      {item => <GridList.Item className="px-0" id={item.id} textValue={item.textValue} href={item.href} isDisabled={item.isDisabled}>
        {selectionMode === "multiple" && <GridList.SelectionCheckbox aria-label={selectRowLabel!(item.textValue)} />}
        {item.media && <SemanticContent as="div" className="size-10 shrink-0">{item.media}</SemanticContent>}
        <SemanticContent as="div" className="min-w-0 flex-1">
          <SemanticContent as="div" className="truncate text-body text-ink-primary" title={item.textValue}>{item.title}</SemanticContent>
          {item.status}
          {item.description && <SemanticContent as="div" className="line-clamp-2 text-body-s text-ink-muted">{item.description}</SemanticContent>}
          {item.meta && <SemanticContent as="div" className="text-caption text-ink-muted break-words">{item.meta}</SemanticContent>}
        </SemanticContent>
        {!!item.actions?.length && <ResourceListActions item={item} label={actionsLabel!(item.textValue)} />}
      </GridList.Item>}
    </GridList>}
    {footer}
  </SemanticContent>;
}
