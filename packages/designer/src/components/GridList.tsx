"use client";

import { createContext, useContext, useRef } from "react";
import type {
  GridListProps as AriaGridListProps,
  GridListItemProps as AriaGridListItemProps,
} from "react-aria-components";
import { GridList as IntentGridList, GridListItem as IntentGridListItem } from "./intent/grid-list.js";
import { cx } from "./internal/cx.js";
import { UI_ALPHA_DISABLED, UI_LAYOUT_TAP_TARGET, UI_RING_FOCUS } from "./internal/ui-vars.js";

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
  /**
   * The exact accessible name of the row's selection checkbox, which the Intent item renders
   * itself under multiple selection. Required there: the item throws without it.
   */
  selectionLabel?: string;
  className?: string;
}

const GridListActionContext = createContext<AriaGridListProps<object>["onAction"]>(undefined);

function GridListRoot<T extends object>({ className, layout = "stack", ...rest }: GridListProps<T>) {
  if (!rest["aria-label"]?.trim() && !rest["aria-labelledby"]?.trim()) {
    throw new TypeError("GridList requires aria-label or aria-labelledby.");
  }
  return <GridListActionContext.Provider value={rest.onAction}>
    <IntentGridList {...rest} layout={layout} selectionBehavior="toggle"
      className={cx("w-full min-w-0 outline-none", layout === "grid" ? "grid grid-cols-2 gap-sm divide-y-0" : "", className)} />
  </GridListActionContext.Provider>;
}

function GridListItem({ className, render, selectionLabel, ...rest }: GridListItemProps) {
  const rootAction = useContext(GridListActionContext);
  const pendingEnter = useRef(false);
  return <IntentGridListItem {...rest} selectionLabel={selectionLabel}
    render={(domProps, state) => {
      if (state.selectionMode === "multiple" && !selectionLabel?.trim()) {
        throw new TypeError("GridList.Item requires selectionLabel under multiple selection.");
      }
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

/**
 * The Intent UI grid list (`./intent/grid-list.tsx`) with two Foundry guarantees it lacks (L4, kept on
 * purpose): react-aria suppresses a row's Enter action in toggle selection once any row is selected,
 * so this adapter restores direct-row Enter activation; and a grid with no accessible name throws.
 * The Foundry focus ring, tap-target floor and disabled alpha are re-applied through `style`.
 */
export const GridList = Object.assign(GridListRoot, {
  Item: GridListItem,
});
