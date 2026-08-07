/**
 * @vespeneventures/ui/atoms — the first rung of a three-layer component
 * ladder (atoms → blocks → views; atoms and blocks both ship so far). An
 * atom is single-purpose: it either composes no other atom (`Button`,
 * `TextField`, `Badge`, `Card`, `Checkbox`, `Switch`, `Select`, `Textarea`,
 * `Avatar`, `Spinner`, `Dialog`), or its parts are homogeneous repeats
 * rather than named regions (`Breadcrumb`, `Menu`, `Tabs` — a trail of
 * interchangeable crumbs, a list of interchangeable actions, a row of
 * interchangeable tabs — not a set of distinct slots). See this package's
 * README, "Placement rules", for the block/atom test this ladder is built
 * on. Anything that owns MULTIPLE NAMED regions (a title region, a
 * description region, an actions region — each different in kind, not
 * just repeated) belongs one layer up, in `@vespeneventures/ui/blocks`,
 * not here.
 *
 * `Table` is the one atom here that composes another atom of its own
 * (`Checkbox`, for its `SelectAllCheckbox`/`SelectionCheckbox`
 * sub-components) — see `Table.tsx`'s own doc comment for why that's the
 * ladder's explicitly-allowed direction (a sibling atom, not a `blocks/`
 * import) rather than an exception to it.
 */

export { Button } from "./Button.js";
export type { ButtonProps, ButtonSize, ButtonVariant } from "./Button.js";

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
