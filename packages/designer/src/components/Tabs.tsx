import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import {
  Tab as AriaTab,
  TabList as AriaTabList,
  TabPanel as AriaTabPanel,
  Tabs as AriaTabs,
  type TabListProps as AriaTabListProps,
  type TabPanelProps as AriaTabPanelProps,
  type TabProps as AriaTabProps,
  type TabsProps as AriaTabsProps,
} from "react-aria-components";
import { cx } from "./internal/cx.js";
import { controlSizeStyle, controlStateStyle } from "./button-classes.js";

export type TabsSize = "sm" | "md" | "lg";

export interface TabsProps extends Omit<AriaTabsProps, "className" | "children"> {
  /** A `Tabs.List` plus one `Tabs.Panel` per tab, in any order. */
  children: ReactNode;
  className?: string;
  /** Padding and type step of every `Tabs.Tab`. Defaults to `md`. */
  size?: TabsSize;
}

// Tab children are collected before AriaTabs provides its own context.
const TabsOrientationContext = createContext<"horizontal" | "vertical">("horizontal");
const TabsSizeContext = createContext<TabsSize>("md");

// One spacing and type step per size; md is the long-standing default.
const TAB_SIZE_CLASSES: Record<TabsSize, string> = {
  sm: "px-sm py-xs text-caption",
  md: "px-md py-sm text-body-s",
  lg: "px-lg py-md text-body",
};

function TabsRoot({ children, className, size = "md", ...rest }: TabsProps) {
  return (
    <AriaTabs {...rest}
      className={({ orientation }) => {
        const vertical = orientation === "vertical";
        return cx(vertical ? "flex flex-row gap-md" : "flex flex-col gap-md", className);
      }}
    >
      {({ orientation }) => (
        <TabsOrientationContext.Provider value={orientation}>
          <TabsSizeContext.Provider value={size}>{children}</TabsSizeContext.Provider>
        </TabsOrientationContext.Provider>
      )}
    </AriaTabs>
  );
}

export interface TabsListProps extends Omit<AriaTabListProps<object>, "className" | "children"> {
  /** One or more `Tabs.Tab`s. */
  children: ReactNode;
  className?: string;
}

/**
 * The oriented list of tabs. Wraps react-aria-components' `TabList`, which
 * supplies the roving-tabindex/arrow-key navigation this component doesn't
 * reimplement — see `Tabs`' own doc comment.
 */
function TabsList({ children, className, ...rest }: TabsListProps) {
  return (
    <AriaTabList
      {...rest}
      className={({ orientation }) => {
        const vertical = orientation === "vertical";
        return cx(
          vertical
            ? "flex flex-col gap-xs border-s border-line-base"
            : "flex gap-xs border-b border-line-base",
          className,
        );
      }}
    >
      {children}
    </AriaTabList>
  );
}

export interface TabsTabProps extends Omit<AriaTabProps, "className" | "style"> {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * One tab within a `Tabs.List`. Its `id` must match the `id` of the
 * `Tabs.Panel` it controls — react-aria-components' `Tab`/`TabPanel` pair
 * derive `aria-controls`/`aria-labelledby` from that shared id
 * automatically, rather than either side spelling out the other's
 * generated DOM id by hand.
 */
function TabsTab({ children, className, style, ...rest }: TabsTabProps) {
  const vertical = useContext(TabsOrientationContext) === "vertical";
  const size = useContext(TabsSizeContext);
  return (
    <AriaTab
      {...rest}
      className={(renderProps) =>
        cx(
          "relative cursor-default",
          TAB_SIZE_CLASSES[size],
          "font-body text-ink-muted outline-none transition-colors motion-reduce:transition-none disabled:cursor-not-allowed",
          renderProps.isSelected ? "text-ink-primary" : "",
          className,
        )
      }
      style={(renderProps) => ({
        ...controlSizeStyle(size),
        ...controlStateStyle(renderProps),
        ...style,
      })}
    >
      {({ isSelected }) => <>
        {children}
        {isSelected ? <span data-tab-indicator="" aria-hidden="true" className="absolute bg-accent"
          style={vertical
            ? { insetInlineStart: 0, insetBlock: 0, inlineSize: "var(--ui-border-rule)" }
            : { insetInline: 0, insetBlockEnd: 0, blockSize: "var(--ui-border-rule)" }} /> : null}
      </>}
    </AriaTab>
  );
}

export interface TabsPanelProps extends Omit<AriaTabPanelProps, "className"> {
  children: ReactNode;
  className?: string;
}

/**
 * The content shown for one tab. Only the panel whose `id` matches the
 * currently-selected `Tabs.Tab` is rendered as interactive/visible —
 * react-aria-components' own `TabPanel` handles that, including the
 * `aria-labelledby` pairing back to the controlling tab.
 */
function TabsPanel({ children, className, ...rest }: TabsPanelProps) {
  return (
    <AriaTabPanel {...rest} className={cx("text-body text-ink-primary outline-none", className)}>
      {children}
    </AriaTabPanel>
  );
}

/**
 * Tabbed navigation between panels of content. Built on
 * react-aria-components' `Tabs` + `TabList` + `Tab` + `TabPanel` —
 * roving-tabindex focus management, Left/Right (or Up/Down, following
 * `orientation`) arrow-key navigation with wraparound, Home/End jumping to
 * the first/last enabled tab, disabled tabs skipped entirely during arrow
 * navigation (never just visually dimmed), and the
 * `role="tablist"`/`role="tab"`/`role="tabpanel"`/`aria-selected`/
 * `aria-controls`/`aria-labelledby` wiring a screen reader needs — none of
 * it reimplemented here.
 *
 * An component, not a block, despite being composed of a list plus panels: its
 * `Tabs.Tab` children are a homogeneous repeat (any tab plays the same
 * role as any other — a label that selects a panel), the same shape as
 * `Breadcrumb`'s crumbs, not a set of regions that differ in kind. See the
 * README's "Placement rules", test 2.
 *
 * `Tabs.List` needs its own accessible name (`aria-label` or
 * `aria-labelledby`) when there's more than one tab list on a page, the
 * same way `Breadcrumb`'s `<nav>` does — there's no sensible default to
 * fall back to here, since "Tabs" describes every tab list equally badly.
 */
export const Tabs = Object.assign(TabsRoot, {
  List: TabsList,
  Tab: TabsTab,
  Panel: TabsPanel,
});
