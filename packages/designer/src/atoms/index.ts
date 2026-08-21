/**
 * @vespeneventures/designer/atoms — the first rung of a three-layer component
 * reusable ladder (atoms → blocks). An
 * atom is single-purpose: it either composes no other atom (`Button`,
 * `TextField`, `Badge`, `Card`, `Checkbox`, `Switch`, `Select`, `Textarea`,
 * `Avatar`, `Spinner`, `Dialog`, `Field`, `Skeleton`, `Tooltip`, `Banner`,
 * `Popover`, `DateField`, `ComboBox`, `SearchField`, `FileTrigger`,
 * `Disclosure`, `ProgressBar`, `Separator`, `Chip`), or its parts are
 * homogeneous repeats rather than named regions (`Breadcrumb`, `Menu`,
 * `Tabs`, `RadioGroup` — a trail of interchangeable crumbs, a list of
 * interchangeable actions, a row of interchangeable tabs, a set of
 * interchangeable options — not a set of distinct slots). See this
 * package's README, "Placement rules", for the block/atom test this ladder
 * is built on. Anything that owns MULTIPLE NAMED regions (a title region, a
 * description region, an actions region — each different in kind, not
 * just repeated) belongs one layer up, in `@vespeneventures/designer/blocks`,
 * not here.
 *
 * `Table` is the one atom here that composes another atom of its own
 * (`Checkbox`, for its `SelectAllCheckbox`/`SelectionCheckbox`
 * sub-components) — see `Table.tsx`'s own doc comment for why that's the
 * ladder's explicitly-allowed direction (a sibling atom, not a `blocks/`
 * import) rather than an exception to it.
 *
 * Thirty ship as of this file. This is the FINAL rung of the atoms layer —
 * see the README's "What's deliberately not here" for what was left out on
 * purpose (`Slider`, `Calendar`, `NumberField`, `Toolbar`, `Accordion`, ...).
 */

import { version as reactVersion } from "react";
import reactAriaComponentsPackageJson from "react-aria-components/package.json" with { type: "json" };
import { assertPeerVersion } from "../internal/peer-version.js";
import { REACT_ARIA_COMPONENTS_DECLARED_RANGE, REACT_DECLARED_RANGE } from "../internal/declared-peer-ranges.js";

/**
 * `react` and `react-aria-components` are two of this package's optional
 * peers (see package.json's `peerDependenciesMeta`) — optional so a
 * token-only consumer can install `@vespeneventures/designer` and use
 * `@vespeneventures/designer/tokens` without either. Every atom in this file
 * needs both, so this barrel — loaded in full whenever a consumer imports
 * ANY atom, since every named export below is eagerly re-exported from
 * this one module — is where #182's guard for them is wired in. An
 * ABSENT or OUT-OF-RANGE version of either previously produced no signal
 * until some component crashed deep inside its own render, with nothing
 * naming a version range as the cause.
 *
 * `react`'s version is read from its own exported `version` (a plain
 * string constant, safe to import from anywhere, including a browser
 * bundle). `react-aria-components` has no such export, but its own
 * `exports` map DOES declare `"./package.json"` (unlike `tailwind-merge`
 * and `@internationalized/date` — see `internal/peer-version.ts`'s own
 * header), so its version is read the same way, via a static JSON import
 * — confirmed empirically safe for a browser-platform bundle (esbuild
 * `--platform=browser` bundles a JSON import cleanly; it is not a
 * `node:*` built-in). Neither of these reads touches `node:fs`.
 */
assertPeerVersion({ peer: "react", declaredRange: REACT_DECLARED_RANGE, foundVersion: reactVersion });
assertPeerVersion({
  peer: "react-aria-components",
  declaredRange: REACT_ARIA_COMPONENTS_DECLARED_RANGE,
  foundVersion: reactAriaComponentsPackageJson.version,
});

export { Button } from "./Button.js";
export type { ButtonProps, ButtonSize, ButtonVariant } from "./Button.js";

export { Icon } from "./Icon.js";
export type { IconProps, IconSize, IconAccessibilityProps, IconNode } from "./Icon.js";

export { TextField } from "./TextField.js";
export type { TextFieldProps } from "./TextField.js";

export { Badge } from "./Badge.js";
export type { BadgeProps, BadgeVariant } from "./Badge.js";

export { Card } from "./Card.js";
export type { CardProps } from "./Card.js";

export { Breadcrumb } from "./Breadcrumb.js";
export type { BreadcrumbProps, BreadcrumbItemProps } from "./Breadcrumb.js";

export { Link } from "./Link.js";
export type { LinkProps, LinkVariant } from "./Link.js";

export { Checkbox } from "./Checkbox.js";
export type { CheckboxProps } from "./Checkbox.js";

export { Switch } from "./Switch.js";
export type { SwitchProps } from "./Switch.js";

export { Select } from "./Select.js";
export type { SelectProps, SelectOption } from "./Select.js";

export { Textarea } from "./Textarea.js";
export type { TextareaProps } from "./Textarea.js";

export { Avatar } from "./Avatar.js";
export type { AvatarProps, AvatarSize } from "./Avatar.js";

export { Spinner } from "./Spinner.js";
export type { SpinnerProps, SpinnerSize } from "./Spinner.js";

export { Menu } from "./Menu.js";
export type { MenuProps, MenuItemProps, MenuSeparatorProps } from "./Menu.js";

export { Dialog } from "./Dialog.js";
export type { DialogProps, DialogSize, DialogHeadingProps } from "./Dialog.js";

export { Tabs } from "./Tabs.js";
export type { TabsProps, TabsListProps, TabsTabProps, TabsPanelProps } from "./Tabs.js";

export { Table } from "./Table.js";
export type {
  TableProps,
  TableHeaderProps,
  TableColumnProps,
  TableBodyProps,
  TableRowProps,
  TableCellProps,
  TableSelectAllCheckboxProps,
  TableSelectionCheckboxProps,
} from "./Table.js";

export { Field } from "./Field.js";
export type { FieldProps, FieldRenderProps } from "./Field.js";

export { Skeleton } from "./Skeleton.js";
export type { SkeletonProps, SkeletonShape } from "./Skeleton.js";

export { Tooltip } from "./Tooltip.js";
export type { TooltipProps } from "./Tooltip.js";

export { Banner } from "./Banner.js";
export type { BannerProps, BannerVariant } from "./Banner.js";

export { RadioGroup } from "./RadioGroup.js";
export type { RadioGroupProps, RadioGroupRadioProps } from "./RadioGroup.js";

export { Popover } from "./Popover.js";
export type { PopoverProps } from "./Popover.js";

export { DateField } from "./DateField.js";
export type { DateFieldProps } from "./DateField.js";

export { ComboBox } from "./ComboBox.js";
export type { ComboBoxProps, ComboBoxOption } from "./ComboBox.js";

export { SearchField } from "./SearchField.js";
export type { SearchFieldProps } from "./SearchField.js";

export { FileTrigger } from "./FileTrigger.js";
export type { FileTriggerProps } from "./FileTrigger.js";

export { Disclosure } from "./Disclosure.js";
export type { DisclosureProps } from "./Disclosure.js";

export { ProgressBar } from "./ProgressBar.js";
export type { ProgressBarProps } from "./ProgressBar.js";

export { Separator } from "./Separator.js";
export type { SeparatorProps } from "./Separator.js";

export { Chip } from "./Chip.js";
export type { ChipProps } from "./Chip.js";

/** Merge token-aware Tailwind class names with last-argument precedence. */
export { cx as mergeUiClasses } from "./internal/cx.js";
