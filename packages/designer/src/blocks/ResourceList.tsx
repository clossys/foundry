"use client";

import { useId, useState, type HTMLAttributes, type ReactNode } from "react";
import { Button } from "../components/Button.js";
import { GridList } from "../components/GridList.js";
import { IconButton } from "../components/IconButton.js";
import { Menu } from "../components/Menu.js";
import { Skeleton } from "../components/Skeleton.js";
import { cx } from "../components/internal/cx.js";
import { UI_LAYOUT_TAP_TARGET } from "../components/internal/ui-vars.js";
import { ChevronDown } from "../icons/ChevronDown.js";
import { EmptyState, type EmptyStateProps } from "./EmptyState.js";

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
      {reasonId(action, index, slot) && <span id={reasonId(action, index, slot)} className="sr-only">{action.disabledReason}</span>}
    </Menu.Item>
  ));
  return <div className="flex shrink-0 items-center gap-sm">
    <div className="hidden items-center gap-sm tablet:flex">
      {actions.slice(0, 2).map((action, index) => <span key={action.id} className="inline-flex">
        <Button variant="quiet" size="sm" trailingIcon={null} className="border-0 bg-transparent" isDisabled={disabled(action)} onPress={action.onAction}
          aria-describedby={reasonId(action, index, "inline")}>{action.label}</Button>
        {reasonId(action, index, "inline") && <span id={reasonId(action, index, "inline")} className="sr-only">{action.disabledReason}</span>}
      </span>)}
    </div>
    <Menu trigger={<IconButton icon={ChevronDown} label={label} className="tablet:hidden" />}>
      {menuItems(actions, "compact")}
    </Menu>
    {actions.length > 2 && <Menu trigger={<IconButton icon={ChevronDown} label={label} className="hidden tablet:inline-flex" />}>
      {menuItems(actions.slice(2), "wide")}
    </Menu>}
  </div>;
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
  emptyState, error, toolbar, bulkBar, footer, className, ...rest
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
  return <section {...rest} aria-label={ariaLabel} className={cx("flex min-w-0 flex-col gap-md", className)}>
    {toolbar}
    {hasSelection ? bulkBar : null}
    {error != null && error !== false ? error : isLoading ? <div>
      <span role="status" className="sr-only">{loadingLabel}</span>
      <div aria-hidden="true">
        {Array.from({ length: loadingRowCount }, (_, index) => <div key={index} className="flex items-center px-md py-sm" style={{ minBlockSize: UI_LAYOUT_TAP_TARGET }}><Skeleton /></div>)}
      </div>
    </div> : items.length === 0 ? <EmptyState {...emptyState} /> : <GridList aria-label={ariaLabel} items={items} selectionMode={selectionMode}
      selectedKeys={selection === "all" ? "all" : new Set(selection)}
      onSelectionChange={keys => {
        const next = keys === "all" ? "all" : new Set([...keys].map(String));
        if (selectedKeys === undefined) setInternalKeys(next);
        onSelectionChange?.(next);
      }} onAction={onAction ? key => onAction(String(key)) : undefined}
      renderEmptyState={() => <EmptyState {...emptyState} />}>
      {item => <GridList.Item id={item.id} textValue={item.textValue} href={item.href} isDisabled={item.isDisabled}>
        {selectionMode === "multiple" && <GridList.SelectionCheckbox aria-label={selectRowLabel!(item.textValue)} />}
        {item.media && <div className="size-10 shrink-0">{item.media}</div>}
        <div className="min-w-0 flex-1">
          <div className="truncate text-body text-ink-primary" title={item.textValue}>{item.title}</div>
          {item.status}
          {item.description && <div className="line-clamp-2 text-body-s text-ink-muted">{item.description}</div>}
          {item.meta && <div className="text-caption text-ink-muted break-words">{item.meta}</div>}
        </div>
        {!!item.actions?.length && <ResourceListActions item={item} label={actionsLabel!(item.textValue)} />}
      </GridList.Item>}
    </GridList>}
    {footer}
  </section>;
}
