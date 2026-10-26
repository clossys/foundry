import type { ReactNode } from "react";
import type { PageBarHeader, FrameNavigate, PageBarDestination, PageBarCrumb, PageBarAction, PageBarPage, AccountMenuActor, AccountMenuProps, AccountMenuSection, AppNavigationProps, CommandMenuProps } from "../blocks/index.js";
import type { ThemeProviderProps, ThemeToggleProps } from "../theme/index.js";

/** Resolved host brand. The accessible label must contain the visible wordmark. */
export interface AppFrameBrand {
  markSrc: string;
  wordmark: string;
  label: string;
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

type FrameDestination = PageBarDestination;
type FrameCrumb = PageBarCrumb;
type FrameAction = PageBarAction;
type FramePage = PageBarPage;

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
  header?: PageBarHeader;
  onNavigate?: FrameNavigate;
  notices?: readonly import("./frame-notices.js").AppFrameNotice[];
  dock?: import("./FrameDock.js").AppFrameDock;
  /** Omitted retains the floating sticky bar; glass always uses fixed overlay positioning. */
  headerPosition?: "sticky" | "static";
  headerSurface?: "solid" | "transparent" | "glass";
  /** App-header slot immediately after the brand. Supply accessible, landmark-free content. */
  context?: ReactNode;
  /** Optional route metadata; when present it owns the page heading in the floating bar. */
  page?: FramePage;
  /** Supplying destinations makes the breadcrumb root a workspace menu; otherwise it is a link. */
  workspaces?: readonly FrameDestination[];
  /** @default "Breadcrumb" */
  breadcrumbLabel?: string;
  /** @default "More breadcrumb levels" */
  collapsedBreadcrumbLabel?: string;
  /** @default "Page information" */
  pageInfoLabel?: string;
  /** @default "More page actions" */
  pageActionsLabel?: string;
  /** Route content must not render another main landmark or, when page is supplied, another page header. */
  children: ReactNode;
  /** Host-owned toast viewport, mounted after the frame chrome and outside main. */
  toasts?: ReactNode;
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

export type { PageBarHeader as AppFrameHeader, PageBarHeaderNav as AppFrameHeaderNav, PageBarHeaderActions as AppFrameHeaderActions } from "../blocks/index.js";
export type { AppFrameNotice } from "./frame-notices.js";
export type { AppFrameDock } from "./FrameDock.js";
