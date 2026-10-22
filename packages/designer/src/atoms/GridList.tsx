"use client";

import { createContext, useContext, useRef } from "react";
import {
  GridList as AriaGridList,
  GridListItem as AriaGridListItem,
  type GridListProps as AriaGridListProps,
  type GridListItemProps as AriaGridListItemProps,
} from "react-aria-components";
import { Checkbox } from "./Checkbox.js";
import { cx } from "./internal/cx.js";
import { UI_ALPHA_DISABLED, UI_LAYOUT_TAP_TARGET, UI_RING_FOCUS } from "./internal/ui-vars.js";

export interface GridListProps<T extends object> extends Omit<AriaGridListProps<T>, "className" | "style" | "layout" | "selectionBehavior"> {
  /** A host-authored accessible name, or a reference to its visible heading. */
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
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

function GridListRoot<T extends object>({ className, ...rest }: GridListProps<T>) {
  if (!rest["aria-label"]?.trim() && !rest["aria-labelledby"]?.trim()) {
    throw new TypeError("GridList requires aria-label or aria-labelledby.");
  }
  return <GridListActionContext.Provider value={rest.onAction}>
    <AriaGridList {...rest} layout="stack" selectionBehavior="toggle"
      className={cx("w-full min-w-0 text-body text-ink-primary outline-none", className)} />
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
    className={({ isSelected, isFocusVisible }) => cx(
      "flex min-w-0 items-center gap-md px-md py-sm border-b border-line-base last:border-b-0 outline-none",
      isSelected ? "bg-surface-selected" : "hover:bg-surface-sunken",
      isSelected || isFocusVisible ? "forced-colors:outline forced-colors:outline-solid" : "",
      isFocusVisible ? "forced-colors:outline-2 forced-colors:-outline-offset-2" : "",
      className,
    )}
    style={({ isDisabled, isFocusVisible }) => ({
      minBlockSize: UI_LAYOUT_TAP_TARGET,
      opacity: isDisabled ? UI_ALPHA_DISABLED : undefined,
      boxShadow: isFocusVisible ? `inset ${UI_RING_FOCUS}` : undefined,
    })} />;
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
