"use client";

import { createContext, useContext, useRef } from "react";
import {
  GridList as AriaGridList,
  GridListItem as AriaGridListItem,
  type GridListProps as AriaGridListProps,
  type GridListItemProps as AriaGridListItemProps,
} from "react-aria-components";
import { Checkbox } from "./preview-runtime/components/checkbox/checkbox.js";
import { cx } from "./internal/cx.js";

export interface GridListProps<T extends object> extends Omit<AriaGridListProps<T>, "className" | "style" | "layout" | "selectionBehavior"> {
  /** A host-authored accessible name, or a reference to its visible heading. */
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
  /** RAC keyboard geometry and visual item layout. @default "stack" */
  layout?: "stack" | "grid";
}

export interface GridListItemProps extends Omit<AriaGridListItemProps, "className" | "style"> {
  /** Plain text identity for typeahead and host selection labels. */
  textValue: string;
  className?: string;
}

export interface GridListSelectionCheckboxProps {
  "aria-label": string;
}

const GridListActionContext = createContext<AriaGridListProps<object>["onAction"]>(undefined);

function GridListRoot<T extends object>({ className, layout = "stack", ...rest }: GridListProps<T>) {
  if (!rest["aria-label"]?.trim() && !rest["aria-labelledby"]?.trim()) {
    throw new TypeError("GridList requires aria-label or aria-labelledby.");
  }
  return <GridListActionContext.Provider value={rest.onAction}>
    <AriaGridList {...rest} layout={layout} selectionBehavior="toggle"
      className={cx("w-full min-w-0 text-sm text-foreground outline-none", layout === "grid" ? "grid grid-cols-2 gap-2" : "", className)} />
  </GridListActionContext.Provider>;
}

function GridListItem({ className, render, ...rest }: GridListItemProps) {
  const rootAction = useContext(GridListActionContext);
  const pendingEnter = useRef(false);
  return <AriaGridListItem {...rest}
    render={(domProps, state) => {
      const adaptedProps: typeof domProps = {
        ...domProps,
        onKeyDown: event => {
          if (event.key === "Enter") {
            pendingEnter.current = event.target === event.currentTarget && !event.defaultPrevented
              && !event.nativeEvent.isComposing && !state.isDisabled
              && state.selectionBehavior === "toggle" && state.id !== undefined
              && state.state.selectionManager.canSelectItem(state.id)
              && !state.state.selectionManager.isEmpty;
          }
          domProps.onKeyDown?.(event);
        },
        onKeyUp: event => {
          // The peer suppresses row actions in toggle mode once any row is selected.
          // Adapt only direct-row Enter; preserve the peer's DOM handlers and navigation.
          const activate = event.key === "Enter" && pendingEnter.current
            && event.target === event.currentTarget && !state.isDisabled
            && state.selectionBehavior === "toggle" && state.id !== undefined
            && state.state.selectionManager.canSelectItem(state.id)
            && !state.state.selectionManager.isEmpty;
          if (event.key === "Enter") pendingEnter.current = false;
          domProps.onKeyUp?.(event);
          if (activate) {
            rest.onAction?.();
            if (state.id !== undefined) rootAction?.(state.id);
          }
        },
        onBlur: event => {
          pendingEnter.current = false;
          domProps.onBlur?.(event);
        },
      };
      return render ? render(adaptedProps, state) : <div {...adaptedProps} />;
    }}
    className={({ isSelected, isFocusVisible, isDisabled }) => cx(
      "flex min-h-11 min-w-0 items-center gap-3 px-3 py-2 border-b border-s-2 border-border last:border-b-0 outline-none",
      isSelected ? "bg-accent border-s-primary" : "border-s-transparent hover:bg-muted/50",
      isSelected || isFocusVisible ? "forced-colors:outline forced-colors:outline-solid" : "",
      isFocusVisible ? "inset-ring-2 inset-ring-ring forced-colors:outline-2 forced-colors:-outline-offset-2" : "",
      isDisabled ? "opacity-50" : "",
      className,
    )} />;
}

function GridListSelectionCheckbox({ "aria-label": ariaLabel }: GridListSelectionCheckboxProps) {
  if (!ariaLabel?.trim()) throw new TypeError("GridList.SelectionCheckbox requires aria-label.");
  // The host label already names the record; suppress the peer's additional row-name reference.
  return <Checkbox slot="selection" aria-label={ariaLabel} aria-labelledby="">{null}</Checkbox>;
}

/** Draft record-list primitives with peer navigation and direct-row Enter actions during selection. */
export const GridList = Object.assign(GridListRoot, {
  Item: GridListItem,
  SelectionCheckbox: GridListSelectionCheckbox,
});
