import type { ReactNode } from "react";
import type { AccountMenuActor, AccountMenuProps, AccountMenuSection, AppNavigationProps, CommandMenuProps } from "@clossys/designer/blocks";
import type { ThemeProviderProps, ThemeToggleProps } from "@clossys/designer/theme";

/** Resolved host brand. The accessible label must contain the visible wordmark. */
export interface AppFrameBrand {
  markSrc: string;
  wordmark: string;
  label: string;
  /** Accent mask by default; image preserves the source artwork's colors. */
  markInk?: "accent" | "image";
  /** Optional host destination; otherwise the brand is not interactive. */
  href?: string;
}

export interface AppFrameAccount {
  actor?: AccountMenuActor;
  sections: readonly AccountMenuSection[];
  /** Visible trigger when actor is absent; never treated as an actor name. */
  signedOutLabel: string;
  contextLabel?: string;
  triggerLabel?: string;
  onRoute?: AccountMenuProps["onRoute"];
}

export interface AppFrameRightPanel {
  children: ReactNode;
  label: string;
  handleLabel: string;
  min: number;
  max: number;
  defaultValue: number;
  /** Controlled width; omitted means AppFrame retains the current width. */
  value?: number;
  onChange?: (value: number) => void;
  step?: number;
  /** @default false */
  defaultCollapsed?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** @default "Open panel" */
  openLabel?: string;
  /** @default "Close panel" */
  closeLabel?: string;
}

export interface AppFrameProps {
  brand: AppFrameBrand;
  /** AppNavigation owns its single responsive navigation drawer. */
  navigation: Omit<AppNavigationProps, "footer" | "dismissAt">;
  account: AppFrameAccount;
  commands: Omit<CommandMenuProps, "isOpen" | "onOpenChange" | "query" | "onQueryChange" | "dir"> & {
    triggerLabel: string;
    /** @default true */
    shortcutEnabled?: boolean;
  };
  /** Route content must not render another main landmark. */
  children: ReactNode;
  rightPanel?: AppFrameRightPanel;
  theme?: Omit<ThemeProviderProps, "children"> & Pick<ThemeToggleProps, "preferenceLabels" | "toggleLabel" | "preferenceAnnouncement">;
  dir?: "ltr" | "rtl";
  /** @default "Skip to content" */
  skipLabel?: string;
  /** Generated per instance when omitted. */
  mainId?: string;
}
