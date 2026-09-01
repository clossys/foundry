import type { ReactNode } from "react";
import {
  Button as AriaButton,
  Disclosure as AriaDisclosure,
  DisclosurePanel as AriaDisclosurePanel,
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
 * An expandable/collapsible section of content — a single disclosure, not
 * an accordion of several coordinated ones (react-aria-components' own
 * `DisclosureGroup` covers that case; this package exposes the single-
 * section primitive, the same way `Table`'s primitives ship ahead of a
 * finished `DataTable`). Built on react-aria-components' `Disclosure` +
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
 * — NOT this package's own `Button` atom, the same "an atom composing
 * another atom is a layering violation" reasoning `Select`'s and
 * `ComboBox`'s own doc comments document. `Disclosure` wires its generated
 * `buttonProps` onto exactly that slot via context; a `Button` with no slot
 * at all is a different, unwired one (react-aria-components' own
 * `DisclosurePanel` resets the slot for anything rendered inside it, so a
 * `Button` in `children` never accidentally inherits the trigger's own
 * behavior).
 */
export function Disclosure({ title, children, className, triggerClassName, panelClassName, ...rest }: DisclosureProps) {
  return (
    <AriaDisclosure {...rest} className={cx("flex flex-col", className)}>
      {(renderProps) => (
        <>
          <AriaButton
            slot="trigger"
            className={cx(
              "flex w-full items-center gap-sm rounded-default py-sm text-left text-body outline-none disabled:cursor-not-allowed",
              triggerClassName ?? "text-ink-primary",
            )}
          >
            <span
              aria-hidden="true"
              className={cx(
                "inline-block transition-transform motion-reduce:transition-none",
                renderProps.isExpanded ? "rotate-90" : "",
              )}
            >
              ▸
            </span>
            {title}
          </AriaButton>
          <AriaDisclosurePanel className={cx("pl-lg text-body-s", panelClassName ?? "text-ink-secondary")}>
            {children}
          </AriaDisclosurePanel>
        </>
      )}
    </AriaDisclosure>
  );
}
