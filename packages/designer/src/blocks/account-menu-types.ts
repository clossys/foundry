import type { ReactNode } from "react";

/** Display data supplied by the host; initials use Avatar's name fallback. */
export interface AccountMenuActor {
  name: string;
  secondaryText?: string;
  image?: string;
}

interface Entry {
  /** Unique within its section. */
  id: string;
  label: string;
  isDisabled?: boolean;
}

export interface AccountMenuLink extends Entry {
  kind: "link";
  href: string;
}

export interface AccountMenuAction extends Entry {
  kind: "action" | "destructive";
  onAction: () => void;
}

export interface AccountMenuPreference extends Entry {
  kind: "preference";
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export type AccountMenuCommand = AccountMenuLink | AccountMenuAction;
export type AccountMenuEntry = AccountMenuCommand | AccountMenuPreference;

/** Separate preference groups preserve checkbox roles without relabelling commands. */
export type AccountMenuSection =
  | { id: string; label?: string; kind?: "commands"; entries: readonly AccountMenuCommand[] }
  | { id: string; label: string; kind: "preferences"; entries: readonly AccountMenuPreference[] };

export interface AccountMenuProps {
  actor: AccountMenuActor;
  /** Section IDs must be unique within this menu. */
  sections: readonly AccountMenuSection[];
  contextLabel?: string;
  /** Additional host-composed Menu.Section or Menu.Item content. */
  menuContent?: ReactNode;
  /** Host-owned controls beside the menu inside the account popup. */
  controls?: ReactNode;
  /** Collapsed trigger name and tooltip only; non-empty overrides actor.name. Expanded labels retain the visible name. */
  triggerLabel?: string;
  /** @default false */
  collapsed?: boolean;
  /** Called when an open menu closes. A drawer host can move focus and remove navigation. */
  onClose?: () => void;
  /** Observes a link action; the host owns routing, drawer lifecycle and destination focus. */
  onRoute?: (entry: AccountMenuLink) => void;
}
