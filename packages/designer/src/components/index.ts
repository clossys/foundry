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
 * A component may compose a sibling component (never a `blocks/` import):
 * `Button` (the trailing icon of its `quiet` variant) and `IconButton` (its
 * one glyph) compose `Icon` this way.
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

export { Button } from "./preview-runtime/components/button/button.js";
export type ButtonProps = import("react").ComponentProps<typeof import("./preview-runtime/components/button/button.js").Button>;
export type { ButtonSize, ButtonVariant } from "./button-classes.js";

export { IconButton } from "./IconButton.js";
export type { IconButtonProps } from "./IconButton.js";

export { Icon } from "./preview-runtime/components/icon/icon.js";
export type { IconProps, IconNode } from "./preview-runtime/components/icon/icon.js";
export type { IconSize } from "../catalog/types.js";

export { TextField, Textarea } from "./preview-runtime/components/text-field/text-field.js";
export type TextFieldProps = import("react").ComponentProps<typeof import("./preview-runtime/components/text-field/text-field.js").TextField>;
export type TextareaProps = import("react").ComponentProps<typeof import("./preview-runtime/components/text-field/text-field.js").Textarea>;

export { Badge } from "./preview-runtime/components/badge/badge.js";
export type BadgeProps = import("react").ComponentProps<typeof import("./preview-runtime/components/badge/badge.js").Badge>;
export { BADGE_TONE, ALERT_TONE, CARD_SURFACE, SKELETON_SHAPE } from "./surface-tones.js";
export type { BadgeTone, BadgeToneProps, AlertTone, AlertToneProps, CardSurface, SkeletonShape } from "./surface-tones.js";

export { Card } from "./preview-runtime/components/card/card.js";
export type CardProps = import("react").ComponentProps<typeof import("./preview-runtime/components/card/card.js").Card>;

export { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbEllipsis } from "./preview-runtime/components/breadcrumbs/breadcrumb.js";
export type BreadcrumbProps = import("react").ComponentProps<typeof import("./preview-runtime/components/breadcrumbs/breadcrumb.js").Breadcrumb>;
export type BreadcrumbItemProps = import("react").ComponentProps<typeof import("./preview-runtime/components/breadcrumbs/breadcrumb.js").BreadcrumbItem>;

export { LinkButton } from "./preview-runtime/components/button/button.js";
export { buttonLinkClassName, iconButtonClassName, iconButtonLinkClassName, INVERSE_CONTROL_INK } from "./button-classes.js";
export type { ControlGround, IconButtonClassOptions, IconButtonLinkGround, IconButtonShape, IconButtonSize } from "./button-classes.js";

export { Checkbox } from "./preview-runtime/components/checkbox/checkbox.js";
export type CheckboxProps = import("react").ComponentProps<typeof import("./preview-runtime/components/checkbox/checkbox.js").Checkbox>;

export { Switch } from "./preview-runtime/components/switch/switch.js";
export type SwitchProps = import("react").ComponentProps<typeof import("./preview-runtime/components/switch/switch.js").Switch>;

export { Slider } from "./preview-runtime/components/slider/slider.js";
export type SliderProps = import("react").ComponentProps<typeof import("./preview-runtime/components/slider/slider.js").Slider>;

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./preview-runtime/components/select/select.js";
export type SelectProps = import("react").ComponentProps<typeof import("./preview-runtime/components/select/select.js").Select>;

export { Avatar, AvatarImage, AvatarFallback } from "./preview-runtime/components/avatar/avatar.js";
export type AvatarProps = import("react").ComponentProps<typeof import("./preview-runtime/components/avatar/avatar.js").Avatar>;

export { Spinner } from "./Spinner.js";
export type { SpinnerProps, SpinnerSize } from "./Spinner.js";

export { DropdownMenu as Menu, InlineMenu } from "./preview-runtime/components/menu/dropdown-menu.js";
export type MenuProps = import("react").ComponentProps<typeof import("./preview-runtime/components/menu/dropdown-menu.js").DropdownMenu>;

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "./preview-runtime/components/dialog/dialog.js";
export type DialogProps = import("react").ComponentProps<typeof import("./preview-runtime/components/dialog/dialog.js").Dialog>;

export { Tabs } from "./Tabs.js";
export type { TabsProps, TabsListProps, TabsTabProps, TabsPanelProps } from "./Tabs.js";

export { Table, TableHeader, TableHead, TableBody, TableRow, TableCell, TableFooter, TableCaption } from "./preview-runtime/components/table/table.js";
export type TableProps = import("react").ComponentProps<typeof import("./preview-runtime/components/table/table.js").Table>;

export { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet, FieldTitle } from "./preview-runtime/components/field/field.js";
export type FieldProps = import("react").ComponentProps<typeof import("./preview-runtime/components/field/field.js").Field>;

export { Skeleton } from "./preview-runtime/components/skeleton/skeleton.js";
export type SkeletonProps = import("react").ComponentProps<typeof import("./preview-runtime/components/skeleton/skeleton.js").Skeleton>;

export { Tooltip, TooltipTrigger } from "./preview-runtime/components/tooltip/tooltip.js";
export type TooltipProps = import("react").ComponentProps<typeof import("./preview-runtime/components/tooltip/tooltip.js").Tooltip>;

export { Alert, AlertTitle, AlertDescription, AlertAction } from "./preview-runtime/components/banner/alert.js";
export type AlertProps = import("react").ComponentProps<typeof import("./preview-runtime/components/banner/alert.js").Alert>;

export { RadioGroup, RadioGroupItem } from "./preview-runtime/components/radio-group/radio-group.js";
export type RadioGroupProps = import("react").ComponentProps<typeof import("./preview-runtime/components/radio-group/radio-group.js").RadioGroup>;
export type RadioGroupItemProps = import("react").ComponentProps<typeof import("./preview-runtime/components/radio-group/radio-group.js").RadioGroupItem>;

export { Popover, PopoverTrigger, PopoverHeader, PopoverTitle, PopoverDescription } from "./preview-runtime/components/popover/popover.js";
export type PopoverProps = import("react").ComponentProps<typeof import("./preview-runtime/components/popover/popover.js").Popover>;

export { Calendar, RangeCalendar } from "./preview-runtime/components/calendar/calendar.js";
export type CalendarProps = import("react").ComponentProps<typeof import("./preview-runtime/components/calendar/calendar.js").Calendar>;
export type RangeCalendarProps = import("react").ComponentProps<typeof import("./preview-runtime/components/calendar/calendar.js").RangeCalendar>;
export { DateField } from "./DateField.js";
export type { DateFieldProps } from "./DateField.js";

export { Combobox as ComboBox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem } from "./preview-runtime/components/combo-box/combobox.js";
export type ComboBoxProps = import("react").ComponentProps<typeof import("./preview-runtime/components/combo-box/combobox.js").Combobox>;

export { SearchField } from "./SearchField.js";
export type { SearchFieldProps } from "./SearchField.js";

export { FileTrigger } from "./preview-runtime/components/file-trigger/file-trigger.js";
export type { FileTriggerProps } from "./preview-runtime/components/file-trigger/file-trigger.js";

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "./preview-runtime/components/disclosure/accordion.js";
export type AccordionProps = import("react").ComponentProps<typeof import("./preview-runtime/components/disclosure/accordion.js").Accordion>;

export { ProgressBar } from "./ProgressBar.js";
export type { ProgressBarProps } from "./ProgressBar.js";

export { Separator } from "./preview-runtime/components/separator/separator.js";
export type SeparatorProps = import("react").ComponentProps<typeof import("./preview-runtime/components/separator/separator.js").Separator>;

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
export { Toggle } from "./preview-runtime/components/toggle-button/toggle.js";

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

// Registered components.specimen-* leaves (DESIGNER-READOPT): the visual unit of each Studio specimen section.
export { SpecimenSwatch, SpecimenLadder, SpecimenPlayer, SpecimenGrid, SpecimenMatrix, SpecimenViewport, SpecimenPassage, SpecimenCopyInContext } from "./specimen/index.js";
export type { SpecimenLeafComponentProps, SpecimenSwatchVariant, SpecimenLadderVariant, SpecimenGridVariant, SpecimenViewportVariant } from "./specimen/index.js";
