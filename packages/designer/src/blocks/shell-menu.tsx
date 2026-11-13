"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import type { MenuProps } from "react-aria-components";

import { componentLeaf } from "../runtime/component-leaf.js";

/**
 * Stock shadcn@aria anatomy for the shell's account menus, resolved through the consumer's
 * selected component leaves. Every leaf is typed by the stock export the ambient selection
 * binds, so a Foundry-only prop (trigger, controls, popoverClassName, isDestructive, Section
 * headings) is a type error here rather than a silently dropped control.
 */
type StockMenu = typeof import("../components/preview-runtime/components/menu/dropdown-menu.js");
type StockDialog = typeof import("../components/preview-runtime/components/dialog/dialog.js");
type StockPopover = typeof import("../components/preview-runtime/components/popover/popover.js");
type StockAvatar = typeof import("../components/preview-runtime/components/avatar/avatar.js");

export const MenuTrigger = componentLeaf<StockMenu["DropdownMenuTrigger"]>("components.menu", "DropdownMenuTrigger");
export const PopupMenu = componentLeaf<StockMenu["DropdownMenu"]>("components.menu");
/** The selected menu's inline presentation (propMap presentation.inline), used inside a controls popover. */
export const InlineMenu = componentLeaf<(props: MenuProps<object> & { readonly presentation: "inline" }) => ReactElement>("components.menu");
export const MenuGroup = componentLeaf<StockMenu["DropdownMenuGroup"]>("components.menu", "MenuGroup");
export const MenuItem = componentLeaf<StockMenu["DropdownMenuItem"]>("components.menu", "MenuItem");
export const MenuLabel = componentLeaf<StockMenu["DropdownMenuLabel"]>("components.menu", "MenuLabel");
export const MenuSeparator = componentLeaf<StockMenu["DropdownMenuSeparator"]>("components.menu", "MenuSeparator");
export const Avatar = componentLeaf<StockAvatar["Avatar"]>("components.avatar");
export const AvatarImage = componentLeaf<StockAvatar["AvatarImage"]>("components.avatar", "AvatarImage");
export const AvatarFallback = componentLeaf<StockAvatar["AvatarFallback"]>("components.avatar", "AvatarFallback");
/** The selected dialog trigger and popover: a stock Popover has no trigger prop, DialogTrigger wires it. */
export const DialogTrigger = componentLeaf<StockDialog["DialogTrigger"]>("components.dialog", "DialogTrigger");
export const Popover = componentLeaf<StockPopover["Popover"]>("components.popover");

export interface ShellMenuProps {
  /** One pressable element; the stock trigger wires its press, expansion and focus return. */
  readonly trigger: ReactElement;
  /** Accessible name of the controls popover and its inline menu. */
  readonly label: string;
  /** Non-menu controls revealed with the menu (the frame's theme control). */
  readonly controls?: ReactNode;
  readonly onOpenChange?: (isOpen: boolean) => void;
  readonly children: ReactNode;
}

/**
 * Without controls: DropdownMenuTrigger + DropdownMenu. With controls: the menu's own inline
 * presentation beside the controls in the selected Popover, opened by the selected DialogTrigger,
 * because a menu popup may contain only menu items.
 */
export function ShellMenu({ trigger, label, controls, onOpenChange, children }: ShellMenuProps) {
  const [isOpen, setOpen] = useState(false);
  const change = (next: boolean) => { setOpen(next); onOpenChange?.(next); };
  if (controls == null) {
    return <MenuTrigger isOpen={isOpen} onOpenChange={change}>{trigger}<PopupMenu>{children}</PopupMenu></MenuTrigger>;
  }
  if (!label.trim()) throw new TypeError("ShellMenu: controls require a non-empty label.");
  return <DialogTrigger isOpen={isOpen} onOpenChange={change}>
    {trigger}
    <Popover aria-label={label} placement="bottom start">
      <InlineMenu presentation="inline" aria-label={label} autoFocus="first" onClose={() => change(false)}>{children}</InlineMenu>
      {controls}
    </Popover>
  </DialogTrigger>;
}
