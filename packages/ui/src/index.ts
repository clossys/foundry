/**
 * This file is NOT a public entry point — `package.json` deliberately
 * declares no `"."` export. Import from `@vespeneventures/ui/atoms` or
 * `@vespeneventures/ui/blocks` instead; see the README for why the ladder
 * (atoms → blocks → views) is kept explicit at the import site rather than
 * flattened through a root barrel. This barrel exists only so the same
 * names are reachable from one place for internal tooling (see
 * `scripts/check-readme-parity.mjs` in the repository root, which reads
 * `src/index.ts` as every package's canonical export list); it re-exports
 * exactly what `./atoms/index.js` and `./blocks/index.js` export, nothing
 * more.
 */
export {
  Button,
  TextField,
  Badge,
  Card,
  Breadcrumb,
  Link,
  Checkbox,
  Switch,
  Select,
  Textarea,
  Avatar,
  Spinner,
  Menu,
  Dialog,
  Tabs,
  Table,
} from "./atoms/index.js";
export type {
  ButtonProps,
  ButtonSize,
  ButtonVariant,
  TextFieldProps,
  BadgeProps,
  BadgeVariant,
  CardProps,
  BreadcrumbProps,
  BreadcrumbItemProps,
  LinkProps,
  LinkVariant,
  CheckboxProps,
  SwitchProps,
  SelectProps,
  SelectOption,
  TextareaProps,
  AvatarProps,
  AvatarSize,
  SpinnerProps,
  SpinnerSize,
  MenuProps,
  MenuItemProps,
  MenuSeparatorProps,
  DialogProps,
  DialogSize,
  DialogHeadingProps,
  TabsProps,
  TabsListProps,
  TabsTabProps,
  TabsPanelProps,
  TableProps,
  TableHeaderProps,
  TableColumnProps,
  TableBodyProps,
  TableRowProps,
  TableCellProps,
  TableSelectAllCheckboxProps,
  TableSelectionCheckboxProps,
} from "./atoms/index.js";

export { PageHeader, EmptyState } from "./blocks/index.js";
export type { PageHeaderProps, EmptyStateProps } from "./blocks/index.js";

export { Shell, Toaster, toast } from "./shell/index.js";
export type {
  ShellProps,
  ShellHeaderProps,
  ShellSideNavProps,
  ShellMainProps,
  ShellRailProps,
  ShellFooterProps,
  ToasterProps,
  ToastFunction,
  ToastHandle,
  ToastOptions,
  ToastRecord,
  ToastVariant,
} from "./shell/index.js";
