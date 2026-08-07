import type { CSSProperties, ReactNode } from "react";
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
import { UI_ALPHA_DISABLED, UI_RING_FOCUS } from "./internal/ui-vars.js";

export interface TabsProps extends Omit<AriaTabsProps, "className" | "children"> {
  /** A `Tabs.List` plus one `Tabs.Panel` per tab, in any order. */
  children: ReactNode;
  className?: string;
}

function TabsRoot({ children, className, ...rest }: TabsProps) {
  return (
    <AriaTabs {...rest} className={cx("flex flex-col gap-md", className)}>
      {children}
    </AriaTabs>
  );
}

export interface TabsListProps extends Omit<AriaTabListProps<object>, "className" | "children"> {
  /** One or more `Tabs.Tab`s. */
  children: ReactNode;
  className?: string;
}

/**
 * The row of tabs itself. Wraps react-aria-components' `TabList`, which
 * supplies the roving-tabindex/arrow-key navigation this component doesn't
 * reimplement — see `Tabs`' own doc comment.
 */
function TabsList({ children, className, ...rest }: TabsListProps) {
  return (
    <AriaTabList
      {...rest}
      className={cx("flex gap-xs border-b border-line-base", className)}
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
  return (
    <AriaTab
      {...rest}
      className={(renderProps) =>
        cx(
          "cursor-default px-md py-sm text-body-s font-body text-ink-muted outline-none transition-colors disabled:cursor-not-allowed",
          renderProps.isSelected ? "text-ink-primary" : "",
          className,
        )
      }
      style={(renderProps) => {
        // The selected indicator is an inset `box-shadow`, not a
        // `border-b-2` utility class: `border-b-2` is a border-WIDTH
        // utility (an explicit `2`), a different Tailwind namespace than
        // the bare `border-b` SIDE utility `Tabs.List`'s own divider uses,
        // and one `token-parity.test.ts` doesn't allow-list — see `Table`'s
        // `border-collapse` comment for the same shape of collision. A raw
        // `var(--color-accent, ...)` read here is exactly the "no Tailwind
        // namespace, raw var() only" case this package's other atoms
        // already use `internal/ui-vars.ts` for, just inlined once rather
        // than promoted to a shared constant for a single call site.
        const underline = renderProps.isSelected
          ? "inset 0 -2px 0 0 var(--color-accent, oklch(0.4748 0 0))"
          : undefined;
        const ring = renderProps.isFocusVisible ? UI_RING_FOCUS : undefined;
        return {
          opacity: renderProps.isDisabled ? UI_ALPHA_DISABLED : undefined,
          boxShadow: [ring, underline].filter(Boolean).join(", ") || undefined,
          ...style,
        };
      }}
    >
      {children}
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
 * An atom, not a block, despite being composed of a list plus panels: its
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
