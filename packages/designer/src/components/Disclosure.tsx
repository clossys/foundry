import { Icon } from "./Icon.js";
import { useGlyph } from "./glyph-context.js";
import type { CSSProperties, ReactNode } from "react";
import { ChevronDown } from "../icons/ChevronDown.js";
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

export interface DisclosureRowProps extends Omit<AriaDisclosureProps, "children" | "className" | "style"> {
  /** The always-visible trigger text; the chevron trails it. */
  title: ReactNode;
  /** The panel content, kept in the DOM and hidden until expanded. */
  children: ReactNode;
  /** Wraps the trigger in a heading of this level (FAQ outlines); omitted renders the bare trigger. */
  headingLevel?: 3 | 4;
  className?: string;
  style?: CSSProperties;
  /** Recipe classes for the trigger, the trailing chevron (closed/open) and the panel. */
  triggerClassName?: string;
  chevronClassName?: string;
  chevronOpenClassName?: string;
  panelClassName?: string;
}

/**
 * A full-width disclosure row with a trailing chevron: the FAQ / reveal shape.
 * Same primitives and semantics as `Disclosure` (`aria-expanded`/`aria-controls`
 * on the trigger, Enter/Space toggling, panel kept in the DOM); the row's
 * look comes entirely from the caller's recipe classes, so blocks render a
 * styled Foundry component rather than raw react-aria primitives.
 */
function DisclosureRow({ title, children, headingLevel, className, style, triggerClassName, chevronClassName, chevronOpenClassName, panelClassName, ...rest }: DisclosureRowProps) {
  const Heading = headingLevel === 4 ? "h4" : "h3";
  return (
    <AriaDisclosure {...rest} className={className} style={style}>
      {({ isExpanded }) => {
        const trigger = (
          <AriaButton slot="trigger" className={triggerClassName}>
            {title}
            <Icon glyph={ChevronDown} decorative size="md" className={cx(chevronClassName, isExpanded ? chevronOpenClassName : undefined)} />
          </AriaButton>
        );
        return (
          <>
            {headingLevel === undefined ? trigger : <Heading className="m-0">{trigger}</Heading>}
            <AriaDisclosurePanel className={panelClassName}>{children}</AriaDisclosurePanel>
          </>
        );
      }}
    </AriaDisclosure>
  );
}

export const Disclosure = Object.assign(DisclosureRoot, { Group: DisclosureGroup, Row: DisclosureRow });
