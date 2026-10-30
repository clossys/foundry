/**
 * @clossys/designer/components — the first rung of a three-layer component
 * reusable ladder (components → blocks). An
 * component is single-purpose: it either composes no other component (`TextField`, `Badge`, `Card`, `Checkbox`, `Switch`, `Select`, `Textarea`,
 * `Avatar`, `Spinner`, `Dialog`, `Field`, `Skeleton`, `Tooltip`, `Banner`,
 * `Popover`, `DateField`, `ComboBox`, `SearchField`, `FileTrigger`,
 * `Disclosure`, `ProgressBar`, `Separator`, `Chip`, `StatusMark`,
 * `Meter`), or its parts are
 * homogeneous repeats rather than named regions (`Breadcrumb`, `Menu`,
 * `Tabs`, `RadioGroup` — a trail of interchangeable crumbs, a list of
 * interchangeable actions, a row of interchangeable tabs, a set of
 * interchangeable options — not a set of distinct slots). See this
 * package's README, "Placement rules", for the block/component test this ladder
 * is built on. Anything that owns MULTIPLE NAMED regions (a title region, a
 * description region, an actions region — each different in kind, not
 * just repeated) belongs one layer up, in `@clossys/designer/blocks`,
 * not here.
 *
 * `Table` is the one component here that composes another component of its own
 * (`Checkbox`, for its `SelectAllCheckbox`/`SelectionCheckbox`
 * sub-components) — see `Table.tsx`'s own doc comment for why that's the
 * ladder's explicitly-allowed direction (a sibling component, not a `blocks/`
 * import) rather than an exception to it. `Button` (the trailing icon of
 * its `quiet` variant) and `IconButton` (its one glyph) compose `Icon` the
 * same way.
 *
 * Thirty-six ship as of this file. See the README's "What's deliberately
 * not here" for what was left out on purpose (`Toolbar`, `Accordion`, ...).
 */

import { version as reactVersion } from "react";
import reactAriaComponentsPackageJson from "react-aria-components/package.json" with { type: "json" };
import { assertPeerVersion } from "../internal/peer-version.js";
import { REACT_ARIA_COMPONENTS_DECLARED_RANGE, REACT_DECLARED_RANGE } from "../internal/declared-peer-ranges.js";

/**
 * `react` and `react-aria-components` are two of this package's optional
 * peers (see package.json's `peerDependenciesMeta`) — optional so a
 * token-only consumer can install `@clossys/designer` and use
 * `@clossys/designer/tokens` without either. Every component in this file
 * needs both, so this barrel — loaded in full whenever a consumer imports
 * ANY component, since every named export below is eagerly re-exported from
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

export { IconButton } from "./IconButton.js";
export type { IconButtonProps } from "./IconButton.js";

export { Icon } from "./Icon.js";
export type { IconProps, IconSize, IconAccessibilityProps, IconNode } from "./Icon.js";

export { TextField } from "./TextField.js";
export type { TextFieldProps } from "./TextField.js";

export { Badge, badgeVariants } from "./preview-runtime/components/badge/badge.js";
export type { BadgeProps, BadgeVariant } from "./Badge.types.js";

export { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter } from "./preview-runtime/components/card/card.js";
export type { CardProps } from "./Card.types.js";

export { Breadcrumb } from "./Breadcrumb.js";
export type { BreadcrumbProps, BreadcrumbItemProps } from "./Breadcrumb.js";

export { Link } from "./Link.client.js";
export { buttonLinkClassName, iconButtonClassName, iconButtonLinkClassName } from "./button-classes.js";
export type { ControlGround, IconButtonClassOptions, IconButtonLinkGround, IconButtonShape, IconButtonSize } from "./button-classes.js";
export type { LinkProps, LinkVariant } from "./Link.client.js";

export { Checkbox } from "./Checkbox.js";
export type { CheckboxProps, CheckboxGroupProps } from "./Checkbox.js";

export { Switch } from "./Switch.js";
export type { SwitchProps } from "./Switch.js";

export { Slider } from "./Slider.js";
export type { SliderProps, SliderValue } from "./Slider.js";

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

export { Skeleton } from "./preview-runtime/components/skeleton/skeleton.js";
export type { SkeletonProps } from "./Skeleton.types.js";

export { Tooltip } from "./Tooltip.js";
export type { TooltipProps } from "./Tooltip.js";

export { Banner } from "./Banner.js";
export type { BannerProps, BannerVariant } from "./Banner.js";

export { RadioGroup } from "./RadioGroup.js";
export type { RadioGroupProps, RadioGroupRadioProps } from "./RadioGroup.js";

export { Popover } from "./Popover.js";
export type { PopoverProps } from "./Popover.js";

export { Calendar } from "./Calendar.js";
export type { CalendarProps, SingleCalendarProps, RangeCalendarProps } from "./Calendar.js";
export { DateField } from "./DateField.js";
export type { DateFieldProps } from "./DateField.js";

export { ComboBox } from "./ComboBox.js";
export type { ComboBoxProps, ComboBoxOption } from "./ComboBox.js";

export { SearchField } from "./SearchField.js";
export type { SearchFieldProps } from "./SearchField.js";

export { FileTrigger } from "./FileTrigger.js";
export type { FileTriggerProps } from "./FileTrigger.js";

export { Disclosure } from "./Disclosure.js";
export type { DisclosureProps, DisclosureGroupProps } from "./Disclosure.js";

export { ProgressBar } from "./ProgressBar.js";
export type { ProgressBarProps } from "./ProgressBar.js";

export { Separator } from "./preview-runtime/components/separator/separator.js";
export type { SeparatorProps } from "./Separator.types.js";

export { Chip } from "./Chip.js";
export type { ChipProps } from "./Chip.js";

export { StatusMark } from "./StatusMark.js";
export type { StatusMarkProps, StatusMarkTone } from "./StatusMark.js";

export { Meter } from "./Meter.js";
export type { MeterProps, MeterTone, MeterDirection, MeterEmphasis } from "./Meter.js";

/** Merge token-aware Tailwind class names with last-argument precedence. */
export { cx as mergeUiClasses } from "./internal/cx.js";

export { COMPONENT_GUIDANCE, COMPONENT_API_FACTS, COMPONENT_COMPARISON } from "./guidance/internal/data.js";
export { ResizeHandle } from "./ResizeHandle.js";
export type { ResizeHandleProps } from "./ResizeHandle.js";
export type {
  ComponentMedium, ComponentMediumState, ComponentScalar, ComponentEvidence, ComponentOptionGuidance,
  ComponentCondition, ComponentConstraint, ComponentWebImplementation, ComponentMediumGuidance, ComponentGuidance,
  ComponentApiFacts, ComponentComparison,
} from "./guidance/internal/data.js";

export { Logomark } from "./Logomark.js";
export type { LogomarkProps, LogomarkSize, LogomarkTone, LogomarkPlate } from "./Logomark.js";

export { GridList } from "./GridList.js";
export type { GridListProps, GridListItemProps, GridListSelectionCheckboxProps } from "./GridList.js";

export { GlyphProvider } from "./glyph-context.js";
export type { GlyphBindings, GlyphProviderProps } from "./glyph-context.js";

export { ColorPicker } from "./ColorPicker.js";
export type { ColorPickerProps } from "./ColorPicker.js";
export { NumberField } from "./NumberField.js";
export type { NumberFieldProps } from "./NumberField.js";
export { TagGroup } from "./TagGroup.js";
export type { TagGroupProps, TagGroupItemProps } from "./TagGroup.js";
export { Toolbar } from "./Toolbar.js";
export type { ToolbarProps } from "./Toolbar.js";
export { Tree } from "./Tree.js";
export type { TreeProps, TreeNodeProps } from "./Tree.js";

export { Form } from "./Form.js";
export type { FormProps } from "./Form.js";
export { NavigationTree, NavigationTreeItem, NavigationTreeItemContent, NavigationTreeSection, NavigationTreeHeader } from "./NavigationTree.js";
export type { NavigationTreeProps, NavigationTreeItemProps, NavigationTreeItemContentProps, NavigationTreeSectionProps, NavigationTreeHeaderProps } from "./NavigationTree.js";

export { ToggleGroup, ToggleGroupItem } from "./ToggleGroup.js";
export type { ToggleGroupProps, ToggleGroupItemProps } from "./ToggleGroup.js";
export { ToggleButton } from "./ToggleButton.js";
export type { ToggleButtonProps, ToggleButtonShape } from "./ToggleButton.js";

export { CanvasZoom } from "./CanvasZoom.js";
export type { CanvasZoomProps } from "./CanvasZoom.js";
export { CanvasMap } from "./CanvasMap.js";
export type { CanvasMapProps } from "./CanvasMap.js";

export { SemanticContent } from "./SemanticContent.js";
export type { SemanticContentTag, SemanticContentProps } from "./SemanticContent.js";

export { NativeAction } from "./NativeAction.js";
export type { NativeActionProps } from "./NativeAction.js";

export { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupAction, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInput, SidebarInset, SidebarMenu, SidebarMenuAction, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarProvider, SidebarRail, SidebarSeparator, SidebarTrigger, useSidebar } from "./sidebar/index.js";
export { Command, CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut, CommandSeparator } from "./command/index.js";
export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription } from "./sheet/index.js";
export { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia } from "./empty/index.js";
export { Item, ItemMedia, ItemContent, ItemActions, ItemGroup, ItemSeparator, ItemTitle, ItemDescription, ItemHeader, ItemFooter } from "./item/index.js";
export { ScrollArea } from "./scroll-area/index.js";
export { DropdownMenuTrigger, DropdownMenu, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from "./dropdown-menu/index.js";

export { RichText } from "./RichText.js";
export type { RichTextProps, RichTextValue } from "./RichText.js";

export { MediaPlayer, type MediaPlayerProps, type MediaPlayerPassage } from "./media-player/index.js";
