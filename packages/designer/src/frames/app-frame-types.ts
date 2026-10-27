import type { ReactNode } from "react";
import type { FrameNavigate, PageBarDestination, PageBarCrumb, PageBarAction, PageBarPage, AccountMenuActor, AccountMenuProps, AccountMenuSection, AppNavigationProps, CommandMenuProps } from "../blocks/index.js";
import type { ThemeProviderProps, ThemeToggleProps } from "../theme/index.js";

/** Host mark beside its visible name at the top of the navigation, above command search. */
export interface AppFrameBrandNavigationMark {
  /** Visible brand name; it truncates to the navigation width. */
  label: string;
}

/** Host mark. By default it appears only as the profile Avatar image; the header bar never carries brand text or a link. */
export interface AppFrameBrand {
  markSrc: string;
  /** Also renders the mark with this name at the navigation top. Omitted: no navigation brand row. */
  navigationMark?: AppFrameBrandNavigationMark;
}

/** Profile Avatar content: the host mark, or the signed-in actor's initials. A signed-out row always keeps the mark. */
export type AppFrameAccountAvatar = "mark" | "initials";

/** Shell arrangement: the standard docked chrome, or an immersive shell whose header floats over the stage. */
export type AppFrameLayout = "standard" | "immersive";
/** Main stage inset: contained (padded) or full (edge to edge). */
export type AppFrameStage = "contained" | "full";

/** Navigation footer arrangement: one row (account beside the theme control), or the theme control on its own row above a full-width account row. */
export type AppFrameFooterLayout = "inline" | "stacked";

export interface AppFrameAccount {
  actor?: AccountMenuActor;
  sections: readonly AccountMenuSection[];
  /** Visible trigger when actor is absent; never treated as an actor name. */
  signedOutLabel: string;
  contextLabel?: string;
  triggerLabel?: string;
  onRoute?: AccountMenuProps["onRoute"];
  /** @default "mark" */
  avatar?: AppFrameAccountAvatar;
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
  onNavigate?: FrameNavigate;
  /** `immersive` floats a glass header over the stage and opens with the navigation collapsed. @default "standard" */
  layout?: AppFrameLayout;
  /** `full` runs the stage edge to edge with no main padding. @default "contained" */
  stage?: AppFrameStage;
  notices?: readonly import("./frame-notices.js").AppFrameNotice[];
  dock?: import("./FrameDock.js").AppFrameDock;
  /** Omitted retains the floating sticky bar; glass always uses fixed overlay positioning. */
  headerPosition?: "sticky" | "static";
  headerSurface?: "solid" | "transparent" | "glass";
  /** App-header slot at the start of the bar, before the page trail. Supply accessible, landmark-free content. */
  context?: ReactNode;
  /** Optional host breadcrumb root for the page trail; never derived from brand. Omitted: the trail starts at page.breadcrumb. */
  root?: { label: string; href?: string };
  /** Optional route metadata; when present it owns the page heading in the floating bar. */
  page?: FramePage;
  /** With root, supplying destinations makes the breadcrumb root a workspace menu; otherwise root is a link. */
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
  /** @default "inline" */
  footerLayout?: AppFrameFooterLayout;
  /**
   * `host` (default) fills a definite-height host element. `viewport` sizes the frame to the
   * dynamic viewport itself, so a host root needs no full-height wrapper.
   * @default "host"
   */
  fill?: "host" | "viewport";
  dir?: "ltr" | "rtl";
  /** @default "Skip to content" */
  skipLabel?: string;
  /** Generated per instance when omitted. */
  mainId?: string;
}

export type { AppFrameNotice } from "./frame-notices.js";
export type { AppFrameDock } from "./FrameDock.js";
