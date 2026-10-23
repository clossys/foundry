/** Compile-time public API assertions; .check.tsx is included in the real package build. */
import { AppFrame, APP_FRAME_CONTRACT, APP_FRAME_CONFIG_SCHEMA } from "../client.js";
import type { AppFrameProps, AppFrameBrand, AppFrameAccount, AppFrameRightPanel } from "../client.js";

export const brand: AppFrameBrand = { markSrc: "/mark.svg", wordmark: "Example", label: "Example home" };
export const signedOut: AppFrameAccount = {
  signedOutLabel: "Account",
  sections: [{ id: "access", entries: [{ id: "sign-in", kind: "link", label: "Sign in", href: "/sign-in" }] }],
};
export const props: AppFrameProps = {
  brand,
  navigation: { tree: [{ id: "home", label: "Home", href: "/" }], activeId: "home" },
  account: signedOut,
  commands: { triggerLabel: "Search", heading: "Search", searchLabel: "Search commands", closeLabel: "Close search", emptyMessage: "No results", groups: [] },
  children: <h1>Home</h1>,
};
export const composed = <AppFrame {...props} />;
export const immersive = <AppFrame {...props} contentLayout="immersive" headerContent={<button>Workspace action</button>} />;
export const standard = <AppFrame {...props} contentLayout="standard" headerContent={null} />;
export const contentLayouts: readonly NonNullable<AppFrameProps["contentLayout"]>[] = APP_FRAME_CONFIG_SCHEMA.contentLayout.values;
// @ts-expect-error layout modes are finite
export const unsupportedLayout = <AppFrame {...props} contentLayout="viewport" />;
export const hostThemeControl = <AppFrame {...props} themeControl={<button>Choose theme</button>} />;
export const omittedThemeControl = <AppFrame {...props} themeControl={null} />;
export const defaultThemeControl = <AppFrame {...props} themeControl={undefined} />;
export const originalImage = <AppFrame {...props} brand={{ ...brand, markInk: "image" }} dir="rtl" theme={{ defaultPreference: "dark", storageKey: "example-theme" }} />;
export const signedIn: AppFrameAccount = { ...signedOut, actor: { name: "Example user" } };
export const panel: AppFrameRightPanel = { label: "Details", handleLabel: "Resize details", min: 200, max: 480, defaultValue: 320, children: <p>Details</p> };
export const controlled = <AppFrame {...props} account={signedIn} rightPanel={{ ...panel, value: 300, onChange: (width: number) => void width, collapsed: false, onCollapsedChange: (collapsed: boolean) => void collapsed }} />;

// Finite metadata values must remain assignable to the actual host-data props.
export const markModes: readonly NonNullable<AppFrameBrand["markInk"]>[] = APP_FRAME_CONFIG_SCHEMA["brand.markInk"].values;
export const shortcutModes: readonly NonNullable<AppFrameProps["commands"]["shortcutEnabled"]>[] = APP_FRAME_CONFIG_SCHEMA["commands.shortcutEnabled"].values;
export const navigationModes: readonly NonNullable<AppFrameProps["navigation"]["defaultCollapsed"]>[] = APP_FRAME_CONFIG_SCHEMA["navigation.defaultCollapsed"].values;
export const panelModes: readonly NonNullable<AppFrameRightPanel["defaultCollapsed"]>[] = APP_FRAME_CONFIG_SCHEMA["rightPanel.defaultCollapsed"].values;
export const themeModes: readonly NonNullable<NonNullable<AppFrameProps["theme"]>["defaultPreference"]>[] = APP_FRAME_CONFIG_SCHEMA["theme.defaultPreference"].values;
export const directions: readonly NonNullable<AppFrameProps["dir"]>[] = APP_FRAME_CONFIG_SCHEMA.dir.values;
export const browserEntry: "web/client" = APP_FRAME_CONTRACT.adapter.subpath;

// @ts-expect-error mark rendering has a finite image opt-out
export const unsupportedMarkInk: AppFrameBrand = { ...brand, markInk: "inverse" };
// @ts-expect-error the visible wordmark is resolved text, not an arbitrary node
export const wordmarkNode: AppFrameBrand = { ...brand, wordmark: <strong>Example</strong> };
// @ts-expect-error an actor must have a real host-supplied name
export const inventedActor: AppFrameAccount = { ...signedOut, actor: {} };
// @ts-expect-error account chrome is composed from data, not a replacement node
export const accountNode: AppFrameProps = { ...props, account: <aside /> };
// @ts-expect-error navigation footer belongs to AppFrame's account composition
export const replacedNavigationFooter: AppFrameProps["navigation"] = { tree: [], footer: <footer /> };
// @ts-expect-error the responsive navigation breakpoint is owned by the frame
export const navigationBreakpoint: AppFrameProps["navigation"] = { tree: [], dismissAt: "(min-width: 1px)" };
// @ts-expect-error command dialog lifecycle belongs to the frame
export const replacedCommandState: AppFrameProps["commands"] = { ...props.commands, isOpen: true };
// @ts-expect-error query lifecycle belongs to the frame
export const replacedCommandQuery: AppFrameProps["commands"] = { ...props.commands, query: "anything" };
// @ts-expect-error all portaled surfaces inherit the frame direction
export const replacedCommandDirection: AppFrameProps["commands"] = { ...props.commands, dir: "rtl" };
// @ts-expect-error a command must have exactly one destination
export const missingCommandDestination: AppFrameProps["commands"] = { ...props.commands, groups: [{ id: "pages", label: "Pages", items: [{ id: "home", label: "Home" }] }] };
// @ts-expect-error a command cannot have both destinations
export const ambiguousCommandDestination: AppFrameProps["commands"] = { ...props.commands, groups: [{ id: "pages", label: "Pages", items: [{ id: "home", label: "Home", href: "/", onAction: () => {} }] }] };
// @ts-expect-error panel bounds are mandatory host data
export const missingPanelBounds: AppFrameRightPanel = { label: "Details", handleLabel: "Resize details", children: null };
// @ts-expect-error three-state theme preference is finite
export const unsupportedTheme: AppFrameProps["theme"] = { defaultPreference: "auto" };
// @ts-expect-error frame content is mounted once inside its ThemeProvider
export const replacedThemeChildren: AppFrameProps["theme"] = { children: <p>Other content</p> };
// @ts-expect-error direction is finite
export const unsupportedDirection: AppFrameProps = { ...props, dir: "auto" };
// @ts-expect-error there is no separate presentation bag with ignored controls
export const ignoredPresentation = <AppFrame {...props} presentation={{ sticky: false }} />;
// @ts-expect-error the header is composed by AppFrame
export const replacedHeader = <AppFrame {...props} header={<header />} />;
// @ts-expect-error the skip link cannot be disabled
export const disabledSkip = <AppFrame {...props} skipLink={false} />;

// The interactive assembly is available through the existing browser entry only.
type AssertAbsent<T extends false> = T;
export type OrdinaryWebBoundary = AssertAbsent<"AppFrame" extends keyof typeof import("../index.js") ? true : false>;
export type ServerBoundary = AssertAbsent<"AppFrame" extends keyof typeof import("../server.js") ? true : false>;
export type SharedFrameBoundary = AssertAbsent<"AppFrame" extends keyof typeof import("./index.js") ? true : false>;

// New page metadata is reachable through the existing public AppFrameProps contract.
export const page: NonNullable<AppFrameProps["page"]> = {
  title: "Projects", breadcrumb: [{ id: "projects", label: "Projects", href: "/projects", siblings: [{ id: "library", label: "Library", href: "/library" }] }],
  width: "contained", status: <span>Ready</span>, description: "Current projects", updatedAt: "Today", meta: <span>Team</span>, scope: "All projects",
  actions: [{ id: "save", label: "Save", primary: true, onAction: () => {} }, { id: "export", label: "Export", href: "/export" }],
};
export const pageFrame = <AppFrame {...props} page={page} workspaces={[{ id: "workspace", label: "Workspace", href: "/" }]} width="full" onWidthChange={(width: "contained" | "full") => void width} />;
export const pageWidths: readonly NonNullable<NonNullable<AppFrameProps["page"]>["width"]>[] = APP_FRAME_CONFIG_SCHEMA["page.width"].values;
// @ts-expect-error stage width is a finite existing-frame configuration
export const invalidPageWidth: AppFrameProps["page"] = { title: "Projects", width: "fixed" };
// @ts-expect-error actions have exactly one destination mechanism
export const ambiguousPageAction: NonNullable<NonNullable<AppFrameProps["page"]>["actions"]>[number] = { id: "run", label: "Run", href: "/", onAction: () => {} };
