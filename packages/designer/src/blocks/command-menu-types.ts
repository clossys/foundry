import type { ReactNode } from "react";
import type { IconNode } from "../icons/types.js";

/** Item IDs must be unique across the menu's groups. Exactly one destination is required. */
export type CommandMenuItem = {
  id: string;
  label: string;
  description?: string;
  shortcutHint?: string;
  icon?: IconNode;
  disabled?: boolean;
} & ({ href: string; onAction?: never } | { href?: never; onAction: () => void });

export interface CommandMenuGroup {
  id: string;
  label: string;
  items: readonly CommandMenuItem[];
}

export interface CommandMenuProps {
  heading: string;
  searchLabel: string;
  closeLabel: string;
  emptyMessage: ReactNode;
  groups: readonly CommandMenuGroup[];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** Defaults to case-insensitive label matching. */
  filter?: (item: CommandMenuItem, query: string) => boolean;
  /** Polite announcement of the visible result count. @default `${count} results` */
  resultCountMessage?: (count: number) => string;
  dir?: "ltr" | "rtl";
}

export interface CommandMenuShortcutOptions {
  onOpen: () => void;
  enabled?: boolean;
}
