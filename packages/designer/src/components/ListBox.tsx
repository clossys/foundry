"use client";

import { createElement, useRef, type MouseEvent } from "react";
import {
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  ListBoxSection as AriaListBoxSection,
  Header,
  type ListBoxItemProps as AriaListBoxItemProps,
} from "react-aria-components";

/**
 * Collection primitives for Command composition, adapted from shadcn/ui's MIT aria Command.
 * Source: https://github.com/shadcn-ui/ui/blob/daaf156ee00ed91cc7e6bdd937c1b4973152d141/apps/v4/registry/bases/aria/ui/command.tsx
 * The command collection uses ListBox rather than Menu to preserve the existing listbox/option contract.
 * React Aria owns collection identity, grouping, disabled items, keyboard navigation and virtual focus.
 */
export const ListBox = AriaListBox;
export const ListBoxSection = AriaListBoxSection;
export const ListBoxHeader = Header;
export type { ListBoxProps, ListBoxSectionProps } from "react-aria-components";
export interface ListBoxItemProps<T = object> extends AriaListBoxItemProps<T> {
  /** Command suggestions expose the virtually focused option as selected. */
  selectionFollowsFocus?: boolean;
}
export function ListBoxItem<T = object>({ selectionFollowsFocus = false, render, onPressStart, ...props }: ListBoxItemProps<T>) {
  const linkClickSeen = useRef(false);
  return <AriaListBoxItem {...props} onPressStart={event => { linkClickSeen.current = false; onPressStart?.(event); }} render={(domProps, state) => {
    const merged = selectionFollowsFocus ? { ...domProps, "aria-selected": state.isFocused } : domProps;
    if ("href" in merged) {
      const linkProps = { ...merged, onClickCapture: (event: MouseEvent<HTMLAnchorElement>) => {
        // React Aria follows a pointer click with its own navigation click. Keep the
        // navigation default while exposing one click to consumers for this press.
        if (linkClickSeen.current) { event.stopPropagation(); event.nativeEvent.stopImmediatePropagation(); return; }
        linkClickSeen.current = true;
        merged.onClickCapture?.(event);
      } };
      return render ? render(linkProps, state) : createElement("a", linkProps);
    }
    if (render) return render(merged, state);
    return createElement("div", merged);
  }} />;
}
