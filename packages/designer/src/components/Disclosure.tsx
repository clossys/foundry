import { Icon } from "./Icon.js";
import { useGlyph } from "./glyph-context.js";
import type { ReactNode } from "react";
import {
  Button as AriaButton,
  Disclosure as AriaDisclosure,
  DisclosureGroup as AriaDisclosureGroup,
  DisclosurePanel as AriaDisclosurePanel,
  type DisclosureGroupProps as AriaDisclosureGroupProps,
  type DisclosureProps as AriaDisclosureProps,
} from "react-aria-components";
import { cx } from "./internal/cx.js";

export interface DisclosureProps extends Omit<AriaDisclosureProps, "children"> {
  /** The always-visible trigger text, next to a direction-indicating chevron. */
  title: ReactNode;
  /** The section's own content, present in the DOM but hidden until expanded. */
  children: ReactNode;
  /** Merged onto the outer wrapper. */
  className?: string;
  /** Merged onto the trigger; blocks use this to select a semantic ground's foreground. */
  triggerClassName?: string;
  /** Merged onto the panel; blocks use this to select a semantic ground's foreground. */
  panelClassName?: string;
}

/**
 * An expandable/collapsible section of content — a single disclosure; an
 * accordion of several coordinated ones is `Disclosure.Group`, below. Built on react-aria-components' `Disclosure` +
 * `DisclosurePanel`, installed at `1.20.0` in this package — both ship in
 * that version, so no `<details>` fallback was needed. Between them these
 * primitives supply: `aria-expanded` on the trigger and `aria-controls`
 * pointing at the panel's generated id (plus `aria-labelledby` the other
 * direction, on the panel); toggling on Enter/Space when the trigger is
 * focused, in addition to a click; and keeping the panel's content in the
 * DOM at all times (toggling its `hidden` attribute, rather than mounting/
 * unmounting), which is what lets browser find-in-page and fragment
 * navigation reach collapsed content — none of it reimplemented here.
 *
 * The trigger is react-aria-components' own `Button`, given `slot="trigger"`
 * — NOT this package's own `Button` component, the same "an component composing
 * another component is a layering violation" reasoning `Select`'s and
 * `ComboBox`'s own doc comments document. `Disclosure` wires its generated
 * `buttonProps` onto exactly that slot via context; a `Button` with no slot
 * at all is a different, unwired one (react-aria-components' own
 * `DisclosurePanel` resets the slot for anything rendered inside it, so a
 * `Button` in `children` never accidentally inherits the trigger's own
 * behavior).
 */
function DisclosureRoot({ title, children, className, triggerClassName, panelClassName, ...rest }: DisclosureProps) {
  const expandGlyph = useGlyph("assets.icon-chevron-right");
  return (
    <AriaDisclosure {...rest} className={cx("flex flex-col", className)}>
      {(renderProps) => (
        <>
          <AriaButton
            slot="trigger"
            className={cx(
              "flex w-full items-center gap-sm rounded-default py-sm text-start text-body",
              triggerClassName ?? "text-ink-primary",
              "outline-none disabled:cursor-not-allowed",
            )}
          >
            <span
              aria-hidden="true"
              className={cx(
                "inline-block transition-transform motion-reduce:transition-none",
                renderProps.isExpanded ? "rotate-90" : "",
              )}
            >
              <Icon glyph={expandGlyph} decorative size="sm" />
            </span>
            {title}
          </AriaButton>
          <AriaDisclosurePanel className={cx("ps-lg text-body-s", panelClassName ?? "text-ink-secondary")}>
            {children}
          </AriaDisclosurePanel>
        </>
      )}
    </AriaDisclosure>
  );
}

export interface DisclosureGroupProps extends Omit<AriaDisclosureGroupProps, "children" | "className"> {
  /** Two or more `Disclosure`s, each with its own `id`. */
  children: ReactNode;
  /** Merged onto the group root. */
  className?: string;
}

/**
 * Several coordinated disclosures (an accordion): the group scope of
 * `Disclosure`. Built on react-aria-components' `DisclosureGroup`, which
 * owns the expanded-key set: by default expanding one section collapses the
 * others, `allowsMultipleExpanded` lets several stay open, and
 * `expandedKeys`/`defaultExpandedKeys`/`onExpandedChange` address sections
 * by each member's `id`. `isDisabled` reaches every member through context.
 * Each section keeps its own trigger in the Tab sequence and toggles on
 * Enter/Space, as a lone `Disclosure` does. Sections are separated by the
 * base line token, so a stacked accordion reads as one unit.
 */
function DisclosureGroup({ children, className, ...rest }: DisclosureGroupProps) {
  return (
    <AriaDisclosureGroup
      {...rest}
      data-part="disclosure-group"
      className={cx("flex flex-col divide-y divide-line-base", className)}
    >
      {children}
    </AriaDisclosureGroup>
  );
}

export const Disclosure = Object.assign(DisclosureRoot, { Group: DisclosureGroup });
