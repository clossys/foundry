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

type FrameWidth = "contained" | "full";
interface FrameDestination { id: string; label: string; href: string }
interface FrameCrumb {
  id: string;
  label: string;
  href?: string;
  /** Alternatives at this level, rendered with the existing Menu atom. */
  siblings?: readonly FrameDestination[];
}
type FrameAction = { id: string; label: string; primary?: boolean; isDisabled?: boolean } & (
  | { href: string; onAction?: never }
  | { href?: never; onAction: () => void }
);
interface FramePage {
  /** The frame renders this as the one page h1; route content supplies no page header. */
  title: string;
  /** Ancestors after the brand; an optional last entry matching title supplies current-page siblings. */
  breadcrumb?: readonly FrameCrumb[];
  status?: ReactNode;
  description?: ReactNode;
  updatedAt?: ReactNode;
  meta?: ReactNode;
  /** Only the first primary request receives primary styling. */
  actions?: readonly FrameAction[];
  scope?: ReactNode;
  /** Default until the user chooses a width; the frame never persists that choice. @default "contained" */
  width?: FrameWidth;
}

export interface AppFrameProps {
  brand: AppFrameBrand;
  /** AppNavigation owns its single responsive navigation drawer. */
  navigation: Omit<AppNavigationProps, "header" | "footer" | "trigger" | "dismissAt">;
  account: AppFrameAccount;
  commands: Omit<CommandMenuProps, "isOpen" | "onOpenChange" | "query" | "onQueryChange" | "dir"> & {
    triggerLabel: string;
    /** @default true */
    shortcutEnabled?: boolean;
  };
  /** Optional route metadata; when present it owns the page heading in the floating bar. */
  page?: FramePage;
  /** Supplying destinations makes the breadcrumb root a workspace menu; otherwise it is a link. */
  workspaces?: readonly FrameDestination[];
  /** Controlled stage width, overriding both the page default and in-memory choice. */
  width?: FrameWidth;
  onWidthChange?: (width: FrameWidth) => void;
  /** @default "Breadcrumb" */
  breadcrumbLabel?: string;
  /** @default "More breadcrumb levels" */
  collapsedBreadcrumbLabel?: string;
  /** @default "Page information" */
  pageInfoLabel?: string;
  /** @default "Use full width" */
  fullWidthLabel?: string;
  /** @default "Use contained width" */
  containedWidthLabel?: string;
  /** @default "More page actions" */
  pageActionsLabel?: string;
  /** Route content must not render another main landmark or, when page is supplied, another page header. */
  children: ReactNode;
  rightPanel?: AppFrameRightPanel;
  theme?: Omit<ThemeProviderProps, "children"> & Pick<ThemeToggleProps, "preferenceLabels" | "toggleLabel" | "preferenceAnnouncement">;
  /** Navigation-footer theme control; undefined uses ThemeToggle, null omits the slot. */
  themeControl?: ReactNode;
  dir?: "ltr" | "rtl";
  /** @default "Skip to content" */
  skipLabel?: string;
  /** Generated per instance when omitted. */
  mainId?: string;
}
